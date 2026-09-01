import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { Inject } from '@nestjs/common';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import { StorageService } from '../storage/storage.module';
import { currentPrincipal } from '../tenancy/request-context.als';

@Injectable()
export class MediaService {
  constructor(
    @Inject(SYSTEM_PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
  ) {}

  async stream(key: string, req: Request, res: Response): Promise<void> {
    // The web serves media from `asset.storageKey` (`assets/<sha256>`); the
    // single-segment `<sha256>` form is kept for compatibility.
    const asset = key.includes('/')
      ? await this.prisma.asset.findFirst({
          where: { storageKey: key },
          select: {
            id: true,
            mime: true,
            sha256: true,
            byteSize: true,
            storageKey: true,
            versions: { select: { agencyId: true, clientId: true } },
            posters: { select: { agencyId: true, clientId: true } },
          },
        })
      : await this.prisma.asset.findUnique({
          where: { sha256: key },
          select: {
            id: true,
            mime: true,
            sha256: true,
            byteSize: true,
            storageKey: true,
            versions: { select: { agencyId: true, clientId: true } },
            posters: { select: { agencyId: true, clientId: true } },
          },
        });

    if (!asset) throw new NotFoundException();

    const principal = currentPrincipal();
    if (!principal) throw new ForbiddenException();

    // The asset is content-addressed and MAY be shared across many versions
    // (and clients) that dedupe to the same sha256. Authorizing against a
    // single arbitrary `versions[0]` is wrong: a shared asset would randomly
    // 403/200 depending on which row Prisma returns. Instead require only
    // that the caller can reach at least ONE version/poster owner.
    const owners = [...asset.versions, ...asset.posters];
    if (owners.length === 0) throw new NotFoundException();

    const inAgency = owners.some((o) => o.agencyId === principal.agencyId);
    if (!inAgency) throw new ForbiddenException();

    if ('clientId' in principal && principal.clientId) {
      const ownClient = owners.some(
        (o) => o.agencyId === principal.agencyId && o.clientId === principal.clientId,
      );
      if (!ownClient) throw new ForbiddenException();
    }

    res.setHeader('Content-Type', asset.mime);
    res.setHeader('ETag', `"${asset.sha256}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.headers['if-none-match'] === `"${asset.sha256}"`) {
      res.status(304).end();
      return;
    }

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const startStr = parts[0];
      const endStr = parts[1];
      if (!startStr) {
        res.status(416).end();
        return;
      }
      const start = parseInt(startStr, 10);
      if (!Number.isFinite(start) || start < 0) {
        res.status(416).end();
        return;
      }
      const end = endStr ? parseInt(endStr, 10) : undefined;
      if (end !== undefined && (!Number.isFinite(end) || end < start)) {
        res.status(416).end();
        return;
      }
      const total = Number(asset.byteSize);
      const chunkEnd = end ?? total - 1;
      const chunkSize = chunkEnd - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${chunkEnd}/${total}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = this.storage.driver.openRead(asset.storageKey);
      let skipped = 0;
      let written = 0;
      stream.on('data', function onData(chunk: Buffer | string) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (skipped <= start) {
          skipped += buf.length;
          if (skipped > start) {
            const offset = buf.length - (skipped - start);
            const slice = buf.subarray(offset);
            const remaining = chunkSize - written;
            if (slice.length > remaining) {
              res.write(slice.subarray(0, remaining));
              res.end();
              stream.destroy();
              return;
            }
            res.write(slice);
            written += slice.length;
          }
        } else {
          const remaining = chunkSize - written;
          if (buf.length > remaining) {
            res.write(buf.subarray(0, remaining));
            res.end();
            stream.destroy();
            return;
          }
          res.write(buf);
          written += buf.length;
        }
      });
      stream.on('end', () => res.end());
      stream.on('error', () => res.destroy());
    } else {
      const stream = this.storage.driver.openRead(asset.storageKey);
      res.setHeader('Content-Length', asset.byteSize.toString());
      stream.pipe(res);
    }
  }
}
