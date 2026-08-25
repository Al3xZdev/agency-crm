import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../src/prisma/system-prisma.token', () => ({
  SYSTEM_PRISMA: Symbol('SYSTEM_PRISMA'),
}));

vi.mock('../../src/storage/storage.module', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    driver: { openRead: vi.fn() },
  })),
}));

import { ProcessVersionHandler } from '../../src/jobs/process-version.handler';
import { StorageService } from '../../src/storage/storage.module';

function buildHandler(mocks: {
  findUnique?: ReturnType<typeof vi.fn>;
  transaction?: ReturnType<typeof vi.fn>;
  openRead?: ReturnType<typeof vi.fn>;
} = {}) {
  const findUnique = mocks.findUnique ?? vi.fn();
  const transaction = mocks.transaction ?? vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn({
    creativeVersion: { update: vi.fn(), findFirst: vi.fn() },
    creative: { update: vi.fn() },
  }));
  const openRead = mocks.openRead ?? vi.fn();

  const prisma = {
    creativeVersion: { findUnique },
    $transaction: transaction,
  };

  const storage = {
    driver: { openRead },
  };

  const handler = new ProcessVersionHandler(
    prisma as unknown as PrismaClient,
    storage as unknown as InstanceType<typeof StorageService>,
  );

  return { handler, findUnique, transaction, openRead };
}

describe('ProcessVersionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets FAILED when magic byte sniff mismatches claimed MIME', async () => {
    const { Readable } = await import('node:stream');

    const findUnique = vi.fn()
      .mockResolvedValueOnce({
        id: 'v1',
        creativeId: 'cr1',
        assetId: 'a1',
        agencyId: 'agency_1',
        asset: { id: 'a1', storageKey: 'assets/abc', mime: 'image/png', sha256: 'abc' },
      })
      .mockResolvedValueOnce({ creativeId: 'cr1' });

    const openRead = vi.fn().mockReturnValue(Readable.from(Buffer.from('ELF_BINARY')));

    const { handler, transaction } = buildHandler({ findUnique, openRead });

    vi.spyOn(handler, 'sniffType').mockResolvedValue({ ext: 'elf', mime: 'application/x-elf' });

    const txUpdate = vi.fn();
    const txFindFirst = vi.fn().mockResolvedValue(null);
    const txCreativeUpdate = vi.fn();
    transaction.mockImplementationOnce(async (fn: (ctx: Record<string, unknown>) => Promise<unknown>) => fn({
      creativeVersion: { update: txUpdate, findFirst: txFindFirst },
      creative: { update: txCreativeUpdate },
    }));

    await handler.handle({ data: { versionId: 'v1' } });

    expect(handler.sniffType).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v1' },
        data: expect.objectContaining({ state: 'FAILED' }),
      }),
    );
  });

  it('sets READY for valid PNG image after magic byte check passes', async () => {
    const { Readable } = await import('node:stream');

    const findUnique = vi.fn()
      .mockResolvedValueOnce({
        id: 'v1',
        creativeId: 'cr1',
        assetId: 'a1',
        agencyId: 'agency_1',
        asset: { id: 'a1', storageKey: 'assets/png123', mime: 'image/png', sha256: 'png123' },
      });

    const openRead = vi.fn().mockReturnValue(Readable.from(Buffer.alloc(32)));

    const { handler, transaction } = buildHandler({ findUnique, openRead });

    vi.spyOn(handler, 'sniffType').mockResolvedValue({ ext: 'png', mime: 'image/png' });

    const txUpdate = vi.fn();
    const txFindFirst = vi.fn().mockResolvedValue({ state: 'READY', reviewStatus: 'NONE' });
    const txCreativeUpdate = vi.fn();
    transaction.mockImplementationOnce(async (fn: (ctx: Record<string, unknown>) => Promise<unknown>) => fn({
      creativeVersion: { update: txUpdate, findFirst: txFindFirst },
      creative: { update: txCreativeUpdate },
    }));

    await handler.handle({ data: { versionId: 'v1' } });

    expect(handler.sniffType).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v1' },
        data: expect.objectContaining({ state: 'READY' }),
      }),
    );
  });

  it('sets FAILED when version or asset is missing', async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(null);
    const { handler, transaction } = buildHandler({ findUnique });

    vi.spyOn(handler, 'sniffType');

    await handler.handle({ data: { versionId: 'nonexistent' } });

    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(handler.sniffType).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
