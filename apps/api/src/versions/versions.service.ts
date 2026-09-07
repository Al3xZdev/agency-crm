import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { UpdateCommentDto } from '@agency-crm/shared';
import type { Principal } from '../tenancy/request-context.als';
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
   * DELETE/UPDATE on Comment rows). STAFF callers may only remove their OWN
   * STAFF-authored comments; client-authored messages are immutable.
   */
  async removeComment(versionId: string, commentId: string, principal: Principal): Promise<{ ok: true }> {
    if (principal.kind !== 'STAFF' || principal.userId == null) throw new ForbiddenException();
    const db = this.tenancy.scoped();

    const existing = await db.comment.findFirst({
      where: { id: commentId, versionId, removedAt: null },
      select: { id: true, authorType: true, authorUserId: true },
    });
    if (!existing) throw new NotFoundException();
    if (existing.authorType !== 'STAFF' || existing.authorUserId !== principal.userId) {
      throw new ForbiddenException();
    }

    const updated = await db.comment.updateMany({
      where: { id: commentId, versionId },
      data: { removedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException();
    return { ok: true };
  }

  /**
   * Staff-only comment edit: the owning staff user rewrites the `body` of
   * their own comment (anchor payload stays immutable; `editedAt` records the
   * rewrite). The append-only DB trigger only permits body/editedAt/removedAt
   * mutations, so this is the only data path that can change a comment.
   */
  async updateComment(versionId: string, commentId: string, dto: UpdateCommentDto, principal: Principal) {
    if (principal.kind !== 'STAFF' || principal.userId == null) throw new ForbiddenException();
    const db = this.tenancy.scoped();

    const existing = await db.comment.findFirst({
      where: { id: commentId, versionId, removedAt: null },
      select: { id: true, authorType: true, authorUserId: true },
    });
    if (!existing) throw new NotFoundException();
    if (existing.authorType !== 'STAFF' || existing.authorUserId !== principal.userId) {
      throw new ForbiddenException();
    }

    await db.comment.updateMany({
      where: { id: commentId, versionId },
      data: { body: dto.body, editedAt: new Date() },
    });

    const updated = await db.comment.findFirst({
      where: { id: commentId, versionId },
      select: {
        id: true,
        anchor: true,
        posX: true,
        posY: true,
        startMs: true,
        endMs: true,
        strokes: true,
        body: true,
        authorType: true,
        authorUserId: true,
        authorLabel: true,
        editedAt: true,
        createdAt: true,
      },
    });
    if (!updated) throw new NotFoundException();
    return {
      ...updated,
      strokes: updated.strokes ?? [],
      canDelete: true,
      canEdit: true,
    };
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
