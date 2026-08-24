import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Slice-1 liveness/readiness probes (task 1.4).
 *
 * - `GET /healthz` — pure liveness: process is up, no external checks.
 * - `GET /readyz`  — readiness: performs a genuine PostgreSQL connection
 *   handshake via `$connect()`, i.e. a real DB ping without touching raw SQL
 *   (Raw-SQL ban, spec Cap 3). The boss-ping addition lands with slice 6.
 *
 * The throwaway `PrismaClient` instance here is scaffold-grade on purpose;
 * slice 2 (task 2.2) replaces it with the global PrismaModule provider.
 */
@Controller()
export class HealthController {
  private readonly prisma = new PrismaClient();

  @Get('healthz')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

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
