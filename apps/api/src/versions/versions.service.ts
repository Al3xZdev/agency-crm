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
      where: { creativeId, removedAt: null },
      select: {
        id: true,
        versionNo: true,
        state: true,
        reviewStatus: true,
        textBody: true,
        createdAt: true,
        poster: { select: { storageKey: true } },
        asset: { select: { storageKey: true, mime: true } },
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
      videoUrl: v.asset && v.asset.mime.startsWith('video') ? v.asset.storageKey : null,
    }));
  }

  async getDetail(versionId: string) {
    const db = this.tenancy.scoped();
    const version = await db.creativeVersion.findFirst({
      where: { id: versionId, removedAt: null },
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
        _count: { select: { comments: { where: { removedAt: null } } } },
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
      // Asset byteSize is a BigInt column; JSON cannot serialize it raw, so
      // map it to a string before exposing it through the API.
      asset: rest.asset ? { ...rest.asset, byteSize: rest.asset.byteSize.toString() } : null,
      poster: rest.poster ? { ...rest.poster, byteSize: rest.poster.byteSize.toString() } : null,
      posterUrl: rest.poster?.storageKey ?? rest.asset?.storageKey ?? null,
      commentsCount: _count.comments,
      reviewEvent: reviewEvents[0] ?? null,
    };
  }

  /**
   * Staff-only comment removal (cleanup capability). Soft-deletes the comment
   * to respect the append-only audit invariant (DB triggers forbid physical
   * DELETE/UPDATE on Comment rows).
   */
  async removeComment(versionId: string, commentId: string): Promise<{ ok: true }> {
    const db = this.tenancy.scoped();
    const updated = await db.comment.updateMany({
      where: { id: commentId, versionId },
      data: { removedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException();
    return { ok: true };
  }

  /**
   * Staff-only version removal: soft-deletes the version by setting removedAt.
   * Child Comment and ReviewEvent rows are never touched — the append-only
   * audit invariant (DB triggers) is preserved. Media assets are
   * content-addressed and shared, so they are intentionally NOT removed here.
   */
  async remove(versionId: string): Promise<{ ok: true }> {
    const db = this.tenancy.scoped();
    const version = await db.creativeVersion.findFirst({
      where: { id: versionId },
      select: { id: true },
    });
    if (!version) throw new NotFoundException();
    await db.creativeVersion.updateMany({
      where: { id: versionId },
      data: { removedAt: new Date() },
    });
    return { ok: true };
  }
}
