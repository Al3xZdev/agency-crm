import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { rollupStatus } from '@agency-crm/shared';
import type { Request } from 'express';
import Busboy from 'busboy';

import { currentPrincipal } from '../tenancy/request-context.als';
import { TenancyService } from '../tenancy/tenancy.service';
import { StorageService } from '../storage/storage.module';
import { VERSION_QUEUE } from '../jobs/jobs.module';
import type { VersionQueue } from '../jobs/version-queue.port';
import { MAX_UPLOAD_BYTES, validateAdmission } from './admission.validator';

export interface CreatedVersion {
  id: string;
  versionNo: number;
  state: 'PROCESSING' | 'READY';
}

/**
 * Upload pipeline (tasks 5b.2â€“5b.6). Admission runs in the contractual
 * order BEFORE Busboy starts; the create-version transaction derives
 * versionNo under the @@unique([creativeId, versionNo]) constraint with a
 * single retry, links/creates the content-addressed Asset (refcount), and
 * recomputes Creative.status via the shared rollup INSIDE the same tx.
 *
 * Design note (documented deviation): the design sketched SELECTâ€¦FOR UPDATE
 * on the parent row; raw SQL is ESLint-banned in src, and the unique
 * constraint plus retry-once provides equivalent serialization guarantees.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly storage: StorageService,
    @Inject(VERSION_QUEUE) private readonly queue: VersionQueue,
  ) {}

  /** Multipart admission + admit-to-storage; tx after the bytes are durable. */
  async uploadVersion(creativeId: string, req: Request): Promise<CreatedVersion> {
    // (1) target creative must exist inside the principal's scope â€” before
    // ANY body byte is read. Only binary kinds accept file uploads.
    const db = this.tenancy.scoped();
    const creative = await db.creative.findFirst({
      where: { id: creativeId },
      select: { id: true, clientId: true, kind: true },
    });
    if (!creative) throw new NotFoundException();
    if (creative.kind === 'TEXT') throw new ConflictException('TEXT_USES_PASTE');

    // (2)+(3) ordered declaration checks on the request envelope â€” still no
    // body consumption.
    const failure = validateAdmission({
      contentLengthHeader: req.headers['content-length'],
      declaredMime: req.headers['content-type']?.split(';')[0],
    });
    if (failure && failure.code !== 'UNSUPPORTED_MEDIA_TYPE') {
      // The request-level Content-Type for multipart carries a boundary and
      // is not itself an allowlist member; extension/MIME checks run at the
      // PART level below where the true declared type lives.
      throw this.httpFailure(failure);
    }

    const admitted = await this.admitMultipart(req);

    return this.createVersionTx({
      creative,
      sha256: admitted.sha256,
      byteSize: admitted.byteSize,
      storageKey: admitted.storageKey,
      mime: admitted.mime,
    });
  }

  /** TEXT paste path: no Asset, no job â€” READY immediately (task 5b.6). */
  async pasteTextVersion(creativeId: string, body: unknown): Promise<CreatedVersion> {
    const textBody = extractTextBody(body);
    if (textBody === null) throw new BadRequestException('INVALID_TEXT_BODY');

    const db = this.tenancy.scoped();
    const creative = await db.creative.findFirst({
      where: { id: creativeId },
      select: { id: true, clientId: true, kind: true },
    });
    if (!creative) throw new NotFoundException();
    if (creative.kind !== 'TEXT') throw new ConflictException('TEXT_KIND_MISMATCH');

    const principal = currentPrincipal()!;
    const created = await db.$transaction(async (tx) => {
      const latest = await tx.creativeVersion.findFirst({
        where: { creativeId: creative.id },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const versionNo = (latest?.versionNo ?? 0) + 1;
      const version = await tx.creativeVersion.create({
        data: {
          agencyId: principal.agencyId,
          clientId: creative.clientId,
          creativeId: creative.id,
          versionNo,
          state: 'READY',
          reviewStatus: 'NONE',
          textBody,
        },
        select: { id: true, versionNo: true, state: true },
      });
      await tx.creative.update({
        where: { id: creative.id },
        data: { status: rollupStatus({ state: 'READY', reviewStatus: 'NONE' }) },
      });
      return version;
    });

    return { id: created.id, versionNo: created.versionNo, state: 'READY' };
  }

  private admitMultipart(
    req: Request,
  ): Promise<{ sha256: string; byteSize: number; storageKey: string; mime: string }> {
    return new Promise((resolve, reject) => {
      let busboy: Busboy.Busboy;
      try {
        busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD_BYTES } });
      } catch {
        reject(new UnsupportedMediaTypeException('MULTIPART_REQUIRED'));
        return;
      }
      let sawFile = false;

      busboy.on('file', (_field, fileStream, info) => {
        sawFile = true;
        const filename = info.filename ?? undefined;
        // Order rules (3)+(4) evaluated against the PART's declared type.
        const failure = validateAdmission({
          contentLengthHeader: req.headers['content-length'],
          declaredMime: info.mimeType,
          filename,
        });
        if (failure) {
          fileStream.resume(); // drain, never store
          reject(this.httpFailure(failure));
          return;
        }
        this.storage.driver
          .admit(fileStream)
          .then((result) =>
            resolve({
              ...result,
              mime: info.mimeType.split(';')[0]?.trim().toLowerCase() ?? info.mimeType,
            }),
          )
          .catch(reject);
      });
      busboy.on('error', () => reject(new UnsupportedMediaTypeException('MALFORMED_MULTIPART')));
      busboy.on('finish', () => {
        if (!sawFile) reject(new UnsupportedMediaTypeException('FILE_PART_REQUIRED'));
      });

      req.pipe(busboy);
    });
  }

  private async createVersionTx(input: {
    creative: { id: string; clientId: string };
    sha256: string;
    byteSize: number;
    storageKey: string;
    mime: string;
  }): Promise<CreatedVersion> {
    const db = this.tenancy.scoped();
    const principal = currentPrincipal()!;

    const attempt = async (): Promise<CreatedVersion> =>
      db.$transaction(async (tx) => {
        const latest = await tx.creativeVersion.findFirst({
          where: { creativeId: input.creative.id },
          orderBy: { versionNo: 'desc' },
          select: { versionNo: true },
        });
        const versionNo = (latest?.versionNo ?? 0) + 1;

        // Content-addressed dedup: same bytes â‡’ one Asset row, refcount++.
        let assetId: string;
        const existingAsset = await tx.asset.findUnique({
          where: { sha256: input.sha256 },
          select: { id: true },
        });
        if (existingAsset) {
          assetId = existingAsset.id;
          await tx.asset.update({
            where: { id: existingAsset.id },
            data: { refCount: { increment: 1 } },
          });
        } else {
          const createdAsset = await tx.asset.create({
            data: {
              agencyId: principal.agencyId,
              sha256: input.sha256,
              mime: input.mime,
              byteSize: BigInt(input.byteSize),
              storageKey: input.storageKey,
              refCount: 1,
            },
            select: { id: true },
          });
          assetId = createdAsset.id;
        }

        const version = await tx.creativeVersion.create({
          data: {
            agencyId: principal.agencyId,
            clientId: input.creative.clientId,
            creativeId: input.creative.id,
            versionNo,
            state: 'PROCESSING',
            reviewStatus: 'NONE',
            assetId,
          },
          select: { id: true, versionNo: true, state: true },
        });

        // Rollup lives in the SAME tx (spec Cap 4 precise rule).
        await tx.creative.update({
          where: { id: input.creative.id },
          data: { status: rollupStatus({ state: 'PROCESSING', reviewStatus: 'NONE' }) },
        });

        return { id: version.id, versionNo: version.versionNo, state: 'PROCESSING' };
      });

    // Unique-constraint serialization: retry once on P2002, then 409.
    try {
      const result = await attempt();
      await this.queue.enqueueProcessVersion({ versionId: result.id }); // ONLY after commit
      return result;
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      try {
        const result = await attempt();
        await this.queue.enqueueProcessVersion({ versionId: result.id });
        return result;
      } catch (retryErr) {
        if ((retryErr as { code?: string }).code === 'P2002') {
          throw new ConflictException('VERSION_CONFLICT');
        }
        throw retryErr;
      }
    }
  }

  private httpFailure(failure: { code: string }): HttpException {
    switch (failure.code) {
      case 'PAYLOAD_TOO_LARGE':
        return new PayloadTooLargeException('PAYLOAD_TOO_LARGE');
      case 'UNSUPPORTED_MEDIA_TYPE':
        return new UnsupportedMediaTypeException('UNSUPPORTED_MEDIA_TYPE');
      default:
        return new ConflictException(failure.code);
    }
  }
}

function extractTextBody(body: unknown): string | null {
  const candidate = (body as { textBody?: unknown } | null)?.textBody;
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > 200_000) return null;
  return trimmed;
}
