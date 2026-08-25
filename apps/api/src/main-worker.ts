import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './jobs/worker.module';
import { PgBossService } from './jobs/pg-boss.service';
import { ProcessVersionHandler } from './jobs/process-version.handler';
import { PROCESS_VERSION } from './jobs/jobs.constants';
import { writeFile, utimes } from 'node:fs/promises';
import { parseEnv } from './config/env.schema';
import type { Job } from 'pg-boss';

const logger = new Logger('Worker');

async function bootstrap(): Promise<void> {
  const config = parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule);

  const pgBoss = app.get(PgBossService);
  const handler = app.get(ProcessVersionHandler);

  await pgBoss.boss.work(
    PROCESS_VERSION,
    { batchSize: config.WORKER_CONCURRENCY },
    async (jobs: Job<{ versionId: string }>[]) => {
      for (const job of jobs) {
        await handler.handle(job);
      }
    },
  );
  logger.log(`Registered ${PROCESS_VERSION} worker (batchSize=${config.WORKER_CONCURRENCY})`);

  const heartbeatPath = config.HEARTBEAT_PATH;
  const touchHeartbeat = async () => {
    try {
      await writeFile(heartbeatPath, new Date().toISOString());
      await utimes(heartbeatPath, new Date(), new Date());
    } catch (err) {
      logger.warn(`Heartbeat write failed: ${err}`);
    }
  };

  await touchHeartbeat();
  const heartbeatInterval = setInterval(touchHeartbeat, 30_000);

  const shutdown = async () => {
    logger.log('Shutting down…');
    clearInterval(heartbeatInterval);
    await pgBoss.boss.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.log('Worker ready');
}

void bootstrap();
