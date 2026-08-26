import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

@Injectable()
export class ClientService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
  ) {}

  async getClientInfo(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, agencyId: true },
    });
    if (!client) throw new NotFoundException();
    return { clientId: client.id, agencyId: client.agencyId, clientName: client.name };
  }

  async listCreatives() {
    const db = this.tenancy.scoped();
    const creatives = await db.creative.findMany({
      where: { status: { not: 'UPLOAD_FAILED' } },
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        campaignId: true,
        createdAt: true,
        versions: {
          where: { state: 'READY' },
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: {
            id: true,
            versionNo: true,
            state: true,
            reviewStatus: true,
            createdAt: true,
            poster: { select: { storageKey: true } },
            asset: { select: { storageKey: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return creatives.map((c) => {
      const latest = c.versions[0] ?? null;
      return {
        id: c.id,
        title: c.title,
        kind: c.kind,
        status: c.status,
        campaignId: c.campaignId,
        createdAt: c.createdAt,
        latestVersionId: latest?.id ?? null,
        latestVersionNo: latest?.versionNo ?? null,
        reviewStatus: latest?.reviewStatus ?? null,
        posterUrl: latest ? (latest.poster?.storageKey ?? latest.asset?.storageKey ?? null) : null,
      };
    });
  }

  async getVersionDetail(versionId: string, clientId: string) {
    const db = this.tenancy.scoped();
    const version = await db.creativeVersion.findFirst({
      where: { id: versionId },
      select: {
        id: true,
        clientId: true,
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
        comments: {
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
        },
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
        creative: {
          select: { title: true },
        },
      },
    });
    if (!version) throw new NotFoundException();
    if (version.clientId !== clientId) throw new ForbiddenException();

    const { reviewEvents, comments, creative, ...rest } = version;
    return {
      ...rest,
      creativeTitle: creative?.title ?? 'Untitled',
      posterUrl: rest.poster?.storageKey ?? rest.asset?.storageKey ?? null,
      comments,
      commentsCount: comments.length,
      reviewEvent: reviewEvents[0] ?? null,
    };
  }
}
