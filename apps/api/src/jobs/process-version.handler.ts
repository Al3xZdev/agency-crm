import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { rollupStatus } from '@agency-crm/shared';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import { StorageService } from '../storage/storage.module';
import { execFileAsync } from './exec.util';

const MAGIC_SNIFF_SIZE = 4100;

@Injectable()
export class ProcessVersionHandler {
  private readonly logger = new Logger(ProcessVersionHandler.name);

  constructor(
    @Inject(SYSTEM_PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
  ) {}

  async handle(job: { data: { versionId: string } }): Promise<void> {
    const { versionId } = job.data;
    this.logger.log(`Processing version ${versionId}`);

    const version = await this.prisma.creativeVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        agencyId: true,
        creativeId: true,
        assetId: true,
        asset: { select: { id: true, storageKey: true, mime: true, sha256: true } },
      },
    });

    if (!version || !version.asset) {
      await this.fail(versionId, 'VERSION_OR_ASSET_MISSING');
      return;
    }

    const stream = this.storage.driver.openRead(version.asset.storageKey);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      totalBytes += buf.length;
      if (totalBytes >= MAGIC_SNIFF_SIZE) break;
    }
    const head = Buffer.concat(chunks).subarray(0, MAGIC_SNIFF_SIZE);

    const sniffed = await this.sniffType(head);

    if (!sniffed || sniffed.mime !== version.asset.mime) {
      await this.fail(versionId, `TYPE_MISMATCH claimed=${version.asset.mime} sniffed=${sniffed?.mime ?? 'unknown'}`);
      return;
    }

    try {
      if (version.asset.mime.startsWith('video/')) {
        await this.processVideo(versionId, version.asset.storageKey, version.agencyId, version.creativeId);
      } else {
        await this.finishImage(versionId, version.creativeId);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Version ${versionId} failed: ${reason}`);
      await this.fail(versionId, reason);
    }
  }

  protected async sniffType(buffer: Buffer): Promise<{ ext: string; mime: string } | undefined> {
    const { fileTypeFromBuffer } = await import('file-type');
    return fileTypeFromBuffer(buffer);
  }

  private async finishImage(versionId: string, creativeId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.creativeVersion.update({
        where: { id: versionId },
        data: { state: 'READY', reviewStartedAt: new Date() },
      });
      const latest = await tx.creativeVersion.findFirst({
        where: { creativeId },
        orderBy: { versionNo: 'desc' },
        select: { state: true, reviewStatus: true },
      });
      await tx.creative.update({
        where: { id: creativeId },
        data: { status: rollupStatus(latest) },
      });
    });
    this.logger.log(`Version ${versionId} READY (image)`);
  }

  private async processVideo(
    versionId: string,
    storageKey: string,
    agencyId: string,
    creativeId: string,
  ): Promise<void> {
    const { mkdirSync, readFileSync, unlinkSync, rmdirSync } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { createWriteStream } = await import('node:fs');
    const { Readable } = await import('node:stream');

    const tmpDir = `/tmp/worker-${versionId}`;
    const inputPath = `${tmpDir}/input`;
    const posterPath = `${tmpDir}/poster.jpg`;

    mkdirSync(tmpDir, { recursive: true });

    try {
      const fullStream = this.storage.driver.openRead(storageKey);
      await pipeline(fullStream, createWriteStream(inputPath));

      const ffprobeResult = await execFileAsync('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_format', inputPath,
      ]);
      const probe = JSON.parse(ffprobeResult.stdout.toString());
      const durationMs = Math.round(parseFloat(probe.format.duration) * 1000);

      await execFileAsync('ffmpeg', [
        '-y', '-i', inputPath, '-ss', '00:00:01', '-frames:v', '1', '-q:v', '2', posterPath,
      ]);

      const posterBytes = readFileSync(posterPath);
      const posterStream = Readable.from(posterBytes);
      const posterResult = await this.storage.driver.admit(posterStream, posterBytes.length);

      // Content-addressed dedup for the derived poster: identical source
      // bytes produce an identical poster, so reuse the existing row instead
      // of hitting the unique sha256 constraint (mirrors uploads.service).
      const existingPoster = await this.prisma.asset.findFirst({
        where: { sha256: posterResult.sha256, agencyId },
        select: { id: true },
      });

      let posterAsset: { id: string };
      if (existingPoster) {
        await this.prisma.asset.updateMany({
          where: { id: existingPoster.id, agencyId },
          data: { refCount: { increment: 1 } },
        });
        posterAsset = existingPoster;
      } else {
        posterAsset = await this.prisma.asset.create({
          data: {
            agencyId,
            sha256: posterResult.sha256,
            mime: 'image/jpeg',
            byteSize: BigInt(posterBytes.length),
            storageKey: posterResult.storageKey,
            refCount: 1,
          },
          select: { id: true },
        });
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.creativeVersion.update({
          where: { id: versionId },
          data: {
            state: 'READY',
            reviewStartedAt: new Date(),
            durationMs,
            posterAssetId: posterAsset.id,
          },
        });
        const latest = await tx.creativeVersion.findFirst({
          where: { creativeId },
          orderBy: { versionNo: 'desc' },
          select: { state: true, reviewStatus: true },
        });
        await tx.creative.update({
          where: { id: creativeId },
          data: { status: rollupStatus(latest) },
        });
      });
      this.logger.log(`Version ${versionId} READY (video, ${durationMs}ms)`);
    } finally {
      try { unlinkSync(inputPath); } catch {}
      try { unlinkSync(posterPath); } catch {}
      try { rmdirSync(tmpDir); } catch {}
    }
  }

  private async fail(versionId: string, reason: string): Promise<void> {
    const version = await this.prisma.creativeVersion.findUnique({
      where: { id: versionId },
      select: { creativeId: true },
    });

    if (!version) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.creativeVersion.update({
        where: { id: versionId },
        data: { state: 'FAILED', failReason: reason },
      });
      const latest = await tx.creativeVersion.findFirst({
        where: { creativeId: version.creativeId },
        orderBy: { versionNo: 'desc' },
        select: { state: true, reviewStatus: true },
      });
      await tx.creative.update({
        where: { id: version.creativeId },
        data: { status: rollupStatus(latest) },
      });
    });
    this.logger.warn(`Version ${versionId} FAILED: ${reason}`);
  }
}
