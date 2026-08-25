import { Injectable, NotFoundException } from '@nestjs/common';

import { TenancyService } from '../tenancy/tenancy.service';

@Injectable()
export class VersionsService {
  constructor(private readonly tenancy: TenancyService) {}

  async listByCreative(creativeId: string) {
    const db = this.tenancy.scoped();
    const creative = await db.creative.findFirst({
      where: { id: creativeId },
      select: { id: true },
    });
    if (!creative) throw new NotFoundException();

    const versions = await db.creativeVersion.findMany({
      where: { creativeId },
      select: {
        id: true,
        versionNo: true,
        state: true,
        reviewStatus: true,
        textBody: true,
        createdAt: true,
        poster: { select: { storageKey: true } },
        asset: { select: { storageKey: true } },
      },
      orderBy: { versionNo: 'desc' },
    });

    return versions.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      state: v.state,
      reviewStatus: v.reviewStatus,
      textBody: v.textBody,
      createdAt: v.createdAt,
      posterUrl: v.poster?.storageKey ?? v.asset?.storageKey ?? null,
    }));
  }

  async getDetail(versionId: string) {
    const db = this.tenancy.scoped();
    const version = await db.creativeVersion.findFirst({
      where: { id: versionId },
      select: {
        id: true,
        creativeId: true,
        versionNo: true,
        state: true,
        reviewStatus: true,
        textBody: true,
        failReason: true,
        durationMs: true,
        createdAt: true,
        asset: {
          select: { sha256: true, mime: true, byteSize: true, storageKey: true },
        },
        poster: {
          select: { sha256: true, mime: true, byteSize: true, storageKey: true },
        },
        _count: { select: { comments: true } },
        reviewEvents: {
          take: 1,
          select: {
            id: true,
            decision: true,
            actorType: true,
            actorLabel: true,
            occurredAt: true,
          },
        },
      },
    });
    if (!version) throw new NotFoundException();

    const { reviewEvents, _count, ...rest } = version;
    return {
      ...rest,
      posterUrl: rest.poster?.storageKey ?? rest.asset?.storageKey ?? null,
      commentsCount: _count.comments,
      reviewEvent: reviewEvents[0] ?? null,
    };
  }
}
