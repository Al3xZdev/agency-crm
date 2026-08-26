import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../src/prisma/system-prisma.token', () => ({
  SYSTEM_PRISMA: Symbol('SYSTEM_PRISMA'),
}));

vi.mock('../../src/notifications/notifications.service', () => ({
  NotificationsService: vi.fn().mockImplementation(() => ({
    queue: vi.fn().mockResolvedValue('email_1'),
  })),
}));

import { ApprovalReminderHandler } from '../../src/jobs/approval-reminder.handler';
import { NotificationsService } from '../../src/notifications/notifications.service';

function buildHandler(mocks: {
  findMany?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  queue?: ReturnType<typeof vi.fn>;
} = {}) {
  const findMany = mocks.findMany ?? vi.fn().mockResolvedValue([]);
  const update = mocks.update ?? vi.fn();
  const queue = mocks.queue ?? vi.fn().mockResolvedValue('email_1');

  const prisma = {
    creativeVersion: { findMany, update },
    magicLink: {
      findMany: vi.fn().mockResolvedValue([{ recipientEmail: 'client@test.com' }]),
    },
  };

  const notifications = { queue } as unknown as InstanceType<typeof NotificationsService>;

  const handler = new ApprovalReminderHandler(
    prisma as unknown as PrismaClient,
    notifications,
  );

  return { handler, findMany, update, queue };
}

describe('ApprovalReminderHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues emails for stale versions', async () => {
    const staleVersion = {
      id: 'v1',
      agencyId: 'a1',
      clientId: 'c1',
      creativeId: 'cr1',
      versionNo: 3,
      reviewStartedAt: new Date('2026-08-20'),
      creative: { title: 'Hero Banner' },
    };
    const { handler, findMany, queue, update } = buildHandler({
      findMany: vi.fn().mockResolvedValue([staleVersion]),
    });

    await handler.handle({});

    expect(findMany).toHaveBeenCalledOnce();
    expect(queue).toHaveBeenCalledOnce();
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: 'a1',
        template: 'APPROVAL_REMINDER',
        toAddresses: ['client@test.com'],
        relatedVersionId: 'v1',
        relatedClientId: 'c1',
      }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { lastReminderAt: expect.any(Date) },
    });
  });

  it('no-ops when no stale versions exist', async () => {
    const { handler, queue, update } = buildHandler();

    await handler.handle({});

    expect(queue).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('skips version when no client email is found', async () => {
    const staleVersion = {
      id: 'v2',
      agencyId: 'a1',
      clientId: 'c2',
      creativeId: 'cr2',
      versionNo: 1,
      reviewStartedAt: new Date('2026-08-19'),
      creative: { title: 'Campaign Ad' },
    };
    const prisma = {
      creativeVersion: {
        findMany: vi.fn().mockResolvedValue([staleVersion]),
        update: vi.fn(),
      },
      magicLink: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const notifications = {
      queue: vi.fn().mockResolvedValue(null),
    } as unknown as NotificationsService;

    const handler = new ApprovalReminderHandler(
      prisma as unknown as PrismaClient,
      notifications,
    );

    await handler.handle({});

    expect(prisma.magicLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'c2', revokedAt: null } }),
    );
    expect(notifications.queue).not.toHaveBeenCalled();
    expect(prisma.creativeVersion.update).not.toHaveBeenCalled();
  });

  it('updates lastReminderAt after each successful email', async () => {
    const versions = [
      {
        id: 'v1',
        agencyId: 'a1',
        clientId: 'c1',
        creativeId: 'cr1',
        versionNo: 1,
        reviewStartedAt: new Date('2026-08-18'),
        creative: { title: 'A' },
      },
      {
        id: 'v2',
        agencyId: 'a1',
        clientId: 'c1',
        creativeId: 'cr2',
        versionNo: 2,
        reviewStartedAt: new Date('2026-08-19'),
        creative: { title: 'B' },
      },
    ];
    const { handler, queue, update } = buildHandler({
      findMany: vi.fn().mockResolvedValue(versions),
    });

    await handler.handle({});

    expect(queue).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { lastReminderAt: expect.any(Date) },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'v2' },
      data: { lastReminderAt: expect.any(Date) },
    });
  });
});
