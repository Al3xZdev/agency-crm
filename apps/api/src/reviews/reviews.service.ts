import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Principal } from '../tenancy/request-context.als';
import { TenancyService } from '../tenancy/tenancy.service';
import { PrismaService } from '../prisma/prisma.service';
import { rollupStatus, type CastDecisionDto } from '@agency-crm/shared';
import { NotificationsService } from '../notifications/notifications.service';

const DECISION_TO_REVIEW_STATUS: Record<string, string> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async castDecision(versionId: string, dto: CastDecisionDto, principal: Principal) {
    const db = this.tenancy.scoped();

    const version = await db.creativeVersion.findFirst({
      where: { id: versionId },
      select: { id: true, creativeId: true, clientId: true, versionNo: true },
    });
    if (!version) throw new NotFoundException();

    try {
      const result = await db.$transaction(async (tx) => {
        const event = await tx.reviewEvent.create({
          data: {
            versionId,
            agencyId: principal.agencyId,
            clientId: version.clientId,
            decision: dto.decision,
            actorType: principal.kind,
            actorUserId: principal.userId ?? null,
            actorLabel: principal.kind === 'STAFF' ? 'Staff' : 'Client',
          },
          select: {
            id: true,
            decision: true,
            actorType: true,
            actorLabel: true,
            occurredAt: true,
          },
        });

        const reviewStatus = DECISION_TO_REVIEW_STATUS[dto.decision];

        const versionUpdated = await tx.creativeVersion.updateMany({
          where: { id: versionId },
          data: { reviewStatus: reviewStatus as never },
        });
        if (versionUpdated.count === 0) throw new NotFoundException();
        const latest = await tx.creativeVersion.findFirst({
          where: { creativeId: version.creativeId },
          orderBy: { versionNo: 'desc' },
          select: { state: true, reviewStatus: true },
        });

        const newStatus = rollupStatus(latest);
        const creativeUpdated = await tx.creative.updateMany({
          where: { id: version.creativeId },
          data: { status: newStatus },
        });
        if (creativeUpdated.count === 0) throw new NotFoundException();

        return event;
      });

      // Fire-and-forget DECISION_CAST notification.
      this.fireDecisionCast(version, principal, dto.decision).catch((err) =>
        this.logger.error(`DECISION_CAST notification failed: ${err}`),
      );

      return result;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw new ConflictException('DECISION_ALREADY_CAST');
      }
      throw err;
    }
  }

  /** Fire-and-forget DECISION_CAST notification to the opposite party. */
  private async fireDecisionCast(
    version: { id: string; creativeId: string; clientId: string; versionNo: number },
    principal: Principal,
    decision: string,
  ) {
    // Use unscoped prisma (not tenancy.scoped()) because this runs async
    // outside the request ALS context. Queries use explicit IDs — safe unscoped.
    const creative = await this.prisma.creative.findUnique({
      where: { id: version.creativeId },
      select: { title: true, agencyId: true },
    });

    await this.notifications.queueDecisionCast({
      agencyId: creative?.agencyId ?? principal.agencyId,
      clientId: version.clientId,
      creativeTitle: creative?.title ?? 'Untitled',
      versionId: version.id,
      versionNo: version.versionNo,
      decision,
      actorLabel: principal.kind === 'STAFF' ? 'Staff' : 'Client',
      actorType: principal.kind,
    });
  }
}
