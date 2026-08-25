import { Injectable } from '@nestjs/common';
import { PgBossService } from './pg-boss.service';
import { PROCESS_VERSION } from './jobs.constants';
import type { VersionQueue, ProcessVersionJob } from './version-queue.port';

@Injectable()
export class PgBossQueue implements VersionQueue {
  constructor(private readonly pgBoss: PgBossService) {}

  async enqueueProcessVersion(job: ProcessVersionJob): Promise<void> {
    await this.pgBoss.boss.send(PROCESS_VERSION, job);
  }
}
