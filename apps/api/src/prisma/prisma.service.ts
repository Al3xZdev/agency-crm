import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Process-wide Prisma client (task 2.2).
 *
 * Slices up to S2 inject this directly; from S3 on, feature modules consume
 * the tenancy-scoped data layer instead and only the whitelisted system
 * modules (Auth, MagicLinks, Mailer, Jobs, Health) may touch SYSTEM_PRISMA —
 * enforced by an ESLint import ban with a RED/GREEN meta gate.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
