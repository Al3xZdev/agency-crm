import { Injectable, NotFoundException } from '@nestjs/common';

import { type Principal } from '../tenancy/request-context.als';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateCommentDto } from '@agency-crm/shared';

@Injectable()
export class CommentsService {
  constructor(private readonly tenancy: TenancyService) {}

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
      const client = await db.client.findUnique({
        where: { id: principal.clientId! },
        select: { name: true },
      });
      authorLabel = client?.name ?? 'Unknown';
    }

    return db.comment.create({
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
}
