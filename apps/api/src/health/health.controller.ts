import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import { Public } from '../auth/public.decorator';

/**
 * Slice-1 liveness/readiness probes (task 1.4).
 *
 * - `GET /healthz` — pure liveness: process is up, no external checks.
 * - `GET /readyz`  — readiness: performs a genuine PostgreSQL connection
 *   handshake via `$connect()`, i.e. a real DB ping without touching raw SQL
 *   (Raw-SQL ban, spec Cap 3). The boss-ping addition lands with slice 6.
 *
 * Health is one of the whitelisted SYSTEM_PRISMA consumers (task 2.2); the
 * throwaway client from the S1 scaffold is gone.
 */
@Controller()
export class HealthController {
  constructor(@Inject(SYSTEM_PRISMA) private readonly prisma: PrismaClient) {}

  @Public()
  @Get('healthz')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  async readiness(): Promise<{ status: string; db: string }> {
    try {
      await this.prisma.$connect();
      return { status: 'ok', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    } finally {
      await this.prisma.$disconnect().catch(() => undefined);
    }
  }
}
