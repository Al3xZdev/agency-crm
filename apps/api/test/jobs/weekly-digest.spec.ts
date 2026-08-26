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

import { WeeklyDigestHandler } from '../../src/jobs/weekly-digest.handler';
import { NotificationsService } from '../../src/notifications/notifications.service';

function buildHandler(mocks: {
  findMany?: ReturnType<typeof vi.fn>;
  queue?: ReturnType<typeof vi.fn>;
} = {}) {
  const findMany = mocks.findMany ?? vi.fn().mockResolvedValue([]);
  const queue = mocks.queue ?? vi.fn().mockResolvedValue('email_1');

  const prisma = {
    agency: {
      findMany: vi.fn().mockResolvedValue([{ id: 'a1', name: 'Test Agency' }]),
    },
    creativeVersion: { findMany },
    magicLink: {
      findMany: vi.fn().mockResolvedValue([{ recipientEmail: 'client@test.com' }]),
    },
  };

  const notifications = { queue } as unknown as InstanceType<typeof NotificationsService>;

  const handler = new WeeklyDigestHandler(
    prisma as unknown as PrismaClient,
    notifications,
  );

  return { handler, findMany, queue, prisma };
}

describe('WeeklyDigestHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends digest when pending versions exist', async () => {
    const pendingVersions = [
      {
        id: 'v1',
        clientId: 'c1',
        versionNo: 1,
        creative: { title: 'Hero Banner' },
      },
      {
        id: 'v2',
        clientId: 'c1',
        versionNo: 2,
        creative: { title: 'Hero Banner' },
      },
    ];
    const { handler, queue } = buildHandler({
      findMany: vi.fn().mockResolvedValue(pendingVersions),
    });

    await handler.handle({});

    expect(queue).toHaveBeenCalledOnce();
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: 'a1',
        template: 'WEEKLY_DIGEST',
        toAddresses: ['client@test.com'],
        relatedClientId: 'c1',
        subject: expect.stringContaining('2'),
      }),
    );
  });

  it('no-ops when no pending versions exist', async () => {
    const { handler, queue } = buildHandler();

    await handler.handle({});

    expect(queue).not.toHaveBeenCalled();
  });

  it('groups versions by client and sends per-client', async () => {
    const pendingVersions = [
      {
        id: 'v1',
        clientId: 'c1',
        versionNo: 1,
        creative: { title: 'A' },
      },
      {
        id: 'v2',
        clientId: 'c2',
        versionNo: 1,
        creative: { title: 'B' },
      },
    ];
    const prisma = {
      agency: {
        findMany: vi.fn().mockResolvedValue([{ id: 'a1', name: 'Test Agency' }]),
      },
      creativeVersion: { findMany: vi.fn().mockResolvedValue(pendingVersions) },
      magicLink: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ recipientEmail: 'c1@test.com' }])
          .mockResolvedValueOnce([{ recipientEmail: 'c2@test.com' }]),
      },
    };
    const queue = vi.fn().mockResolvedValue('email_1');
    const notifications = { queue } as unknown as NotificationsService;

    const handler = new WeeklyDigestHandler(
      prisma as unknown as PrismaClient,
      notifications,
    );

    await handler.handle({});

    expect(queue).toHaveBeenCalledTimes(2);
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({ relatedClientId: 'c1', toAddresses: ['c1@test.com'] }),
    );
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({ relatedClientId: 'c2', toAddresses: ['c2@test.com'] }),
    );
  });

  it('skips clients with no email addresses', async () => {
    const pendingVersions = [
      {
        id: 'v1',
        clientId: 'c1',
        versionNo: 1,
        creative: { title: 'A' },
      },
    ];
    const prisma = {
      agency: {
        findMany: vi.fn().mockResolvedValue([{ id: 'a1', name: 'Test Agency' }]),
      },
      creativeVersion: { findMany: vi.fn().mockResolvedValue(pendingVersions) },
      magicLink: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const queue = vi.fn().mockResolvedValue(null);
    const notifications = { queue } as unknown as NotificationsService;

    const handler = new WeeklyDigestHandler(
      prisma as unknown as PrismaClient,
      notifications,
    );

    await handler.handle({});

    expect(queue).not.toHaveBeenCalled();
  });
});
