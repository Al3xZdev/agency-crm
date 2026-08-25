import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../tenancy/request-context.als';
import { TenancyService } from '../tenancy/tenancy.service';
import { rollupStatus, type CastDecisionDto } from '@agency-crm/shared';

const DECISION_TO_REVIEW_STATUS: Record<string, string> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

@Injectable()
export class ReviewsService {
  constructor(private readonly tenancy: TenancyService) {}

  async castDecision(versionId: string, dto: CastDecisionDto, principal: Principal) {
    const db = this.tenancy.scoped();

    const version = await db.creativeVersion.findFirst({
      where: { id: versionId },
      select: { id: true, creativeId: true, clientId: true },
    });
    if (!version) throw new NotFoundException();

    try {
      return await db.$transaction(async (tx) => {
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

        await tx.creativeVersion.update({
          where: { id: versionId },
          data: { reviewStatus: reviewStatus as never },
        });

        const latest = await tx.creativeVersion.findFirst({
          where: { creativeId: version.creativeId },
          orderBy: { versionNo: 'desc' },
          select: { state: true, reviewStatus: true },
        });

        const newStatus = rollupStatus(latest);
        await tx.creative.update({
          where: { id: version.creativeId },
          data: { status: newStatus },
        });

        return event;
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw new ConflictException('DECISION_ALREADY_CAST');
      }
      throw err;
    }
  }
}
