import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SYSTEM_PRISMA } from './system-prisma.token';

/**
 * Global Prisma wiring (task 2.2). Exposes the same instance twice:
 * - `PrismaService` class token (pre-S3 consumers),
 * - `SYSTEM_PRISMA` symbol token for whitelisted system modules only.
 * The import ban on SYSTEM_PRISMA is enforced in eslint.config.mjs.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: SYSTEM_PRISMA, useExisting: PrismaService },
  ],
  exports: [PrismaService, SYSTEM_PRISMA],
})
export class PrismaModule {}
