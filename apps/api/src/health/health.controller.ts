import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import { Public } from '../auth/public.decorator';

/**
 * Slice-1 liveness/readiness probes (task 1.4), hardened per the slice-3.5
 * audit:
 *
 * - `GET /healthz` — pure liveness: process is up, no external checks.
 * - `GET /readyz`  — readiness: a real `SELECT 1` round-trip. The raw-SQL
 *   ban (spec Cap 3) carries a deliberate, commented exemption for this
 *   probe in eslint.config.mjs — health checks are exactly where a
 *   parameterized one-liner belongs. The previous `$connect/$disconnect`
 *   version tore down the connection pool on every probe (audit finding 4).
 *   The boss-ping addition lands with slice 6.
 *
 * Health is one of the whitelisted SYSTEM_PRISMA consumers (task 2.2).
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
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
  }
}
