import { Module } from '@nestjs/common';
import { PgBossService } from './pg-boss.service';
import { PgBossQueue } from './pg-boss.queue';

export const VERSION_QUEUE = Symbol('VERSION_QUEUE');

@Module({
  providers: [
    PgBossService,
    PgBossQueue,
    { provide: VERSION_QUEUE, useExisting: PgBossQueue },
  ],
  exports: [PgBossService, VERSION_QUEUE],
})
export class JobsModule {}
