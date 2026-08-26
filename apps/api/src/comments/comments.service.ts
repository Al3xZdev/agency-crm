import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { type Principal } from '../tenancy/request-context.als';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateCommentDto } from '@agency-crm/shared';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(versionId: string, dto: CreateCommentDto, principal: Principal) {
    const db = this.tenancy.scoped();

    const version = await db.creativeVersion.findFirst({
      where: { id: versionId },
      select: { id: true, clientId: true },
    });
    if (!version) throw new NotFoundException();

    let authorLabel: string;
    if (principal.kind === 'STAFF') {
      const user = await db.user.findUnique({
        where: { id: principal.userId! },
        select: { displayName: true },
      });
      authorLabel = user?.displayName ?? 'Unknown';
    } else {
      const client = await this.prisma.client.findUnique({
        where: { id: principal.clientId! },
        select: { name: true },
      });
      authorLabel = client?.name ?? 'Unknown';
    }

    const comment = await db.comment.create({
      data: {
        versionId,
        agencyId: principal.agencyId,
        clientId: version.clientId,
        authorType: principal.kind,
        authorUserId: principal.userId ?? null,
        authorLabel,
        anchor: dto.anchor,
        posX: dto.posX ?? null,
        posY: dto.posY ?? null,
        startMs: dto.startMs ?? null,
        endMs: dto.endMs ?? null,
        body: dto.body,
      },
    });

    // Fire-and-forget COMMENT_NEW notification.
    this.fireCommentNew(versionId, version.clientId, authorLabel, principal.kind, dto.body).catch(
      (err) => this.logger.error(`COMMENT_NEW notification failed: ${err}`),
    );

    return comment;
  }

  async listByVersion(versionId: string) {
    const db = this.tenancy.scoped();
    const version = await db.creativeVersion.findFirst({
      where: { id: versionId },
      select: { id: true },
    });
    if (!version) throw new NotFoundException();

    return db.comment.findMany({
      where: { versionId },
      select: {
        id: true,
        anchor: true,
        posX: true,
        posY: true,
        startMs: true,
        endMs: true,
        body: true,
        authorType: true,
        authorLabel: true,
        createdAt: true,
        authorUser: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Fire-and-forget COMMENT_NEW notification to the opposite party. */
  private async fireCommentNew(
    versionId: string,
    clientId: string,
    authorLabel: string,
    authorType: 'STAFF' | 'CLIENT',
    body: string,
  ) {
    // Use unscoped prisma (not tenancy.scoped()) because this runs async
    // outside the request ALS context. Queries use explicit IDs — safe unscoped.
    const version = await this.prisma.creativeVersion.findUnique({
      where: { id: versionId },
      select: { versionNo: true, creativeId: true },
    });
    if (!version) return;

    const creative = await this.prisma.creative.findUnique({
      where: { id: version.creativeId },
      select: { title: true, agencyId: true },
    });

    await this.notifications.queueCommentNew({
      agencyId: creative?.agencyId ?? '',
      clientId,
      creativeTitle: creative?.title ?? 'Untitled',
      versionId,
      versionNo: version.versionNo,
      authorLabel,
      authorType,
      commentBody: body,
    });
  }
}
