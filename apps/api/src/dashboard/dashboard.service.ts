import { Injectable } from '@nestjs/common';

import { TenancyService } from '../tenancy/tenancy.service';

/** Monday 00:00:00.000 UTC of the week containing `now`. */
function startOfCurrentWeek(now = new Date()): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export interface ActivityItem {
  id: string;
  creativeName: string;
  clientName: string;
  versionNumber: number;
  status: string;
  updatedAt: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

@Injectable()
export class DashboardService {
  constructor(private readonly tenancy: TenancyService) {}

  async getStats() {
    const db = this.tenancy.scoped();

    const pendingReview = await db.creativeVersion.count({
      where: { state: 'READY', reviewStatus: 'NONE' },
    });

    const approvedThisWeek = await db.reviewEvent.count({
      where: { decision: 'APPROVED', occurredAt: { gte: startOfCurrentWeek() } },
    });

    const activeClients = await db.creative.findMany({
      distinct: ['clientId'],
      select: { clientId: true },
    });

    const unresolvedComments = await db.comment.count({
      where: { resolved: false },
    });

    return {
      pendingReview,
      approvedThisWeek,
      activeClients: activeClients.length,
      unresolvedComments,
    };
  }

  async getActivity(limitParam?: number, cursor?: string): Promise<ActivityPage> {
    const limit = Math.min(Math.max(Math.trunc(limitParam ?? 20) || 20, 1), 50);
    const db = this.tenancy.scoped();

    const cursorDate = cursor ? new Date(cursor) : null;
    const take = limit + 1;

    const rows = await db.creativeVersion.findMany({
      where: cursorDate ? { createdAt: { lt: cursorDate } } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        versionNo: true,
        state: true,
        createdAt: true,
        creative: {
          select: {
            title: true,
            campaign: { select: { client: { select: { name: true } } } },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items: ActivityItem[] = rows.slice(0, limit).map((v) => ({
      id: v.id,
      creativeName: v.creative?.title ?? 'Untitled creative',
      clientName: v.creative?.campaign?.client?.name ?? 'Unknown client',
      versionNumber: v.versionNo,
      status: v.state,
      updatedAt: v.createdAt.toISOString(),
    }));

    // Cursor = timestamp of the last item returned; the next page reads
    // strictly older items (`lt`), so the boundary item is not skipped.
    // `hasMore` guarantees `rows[limit - 1]` exists.
    const nextCursor = hasMore ? rows[limit - 1]!.createdAt.toISOString() : null;

    return { items, nextCursor };
  }
}
