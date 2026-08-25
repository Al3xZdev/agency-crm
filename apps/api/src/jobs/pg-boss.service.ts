import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';

type PgBossInstance = import('pg-boss').PgBoss;

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name);
  boss!: PgBossInstance;

  constructor(@Inject(CONFIG) private readonly config: Env) {}

  async onModuleInit(): Promise<void> {
    const { PgBoss } = await import('pg-boss');
    this.boss = new PgBoss({
      connectionString: this.config.DATABASE_URL,
      schema: 'pgboss',
    });
    await this.boss.start();
    this.logger.log('pg-boss started');
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.boss) return;
    this.logger.log('Stopping pg-boss…');
    await this.boss.stop();
  }
}
