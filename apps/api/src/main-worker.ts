import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './jobs/worker.module';
import { PgBossService } from './jobs/pg-boss.service';
import { ProcessVersionHandler } from './jobs/process-version.handler';
import { ApprovalReminderHandler } from './jobs/approval-reminder.handler';
import { WeeklyDigestHandler } from './jobs/weekly-digest.handler';
import { PROCESS_VERSION, APPROVAL_REMINDER, WEEKLY_DIGEST } from './jobs/jobs.constants';
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

  // Scheduled: approval reminders (weekdays 9am)
  const reminderHandler = app.get(ApprovalReminderHandler);
  if (!config.REMINDERS_DISABLED) {
    await pgBoss.boss.schedule(APPROVAL_REMINDER, '0 9 * * 1-5', {});
    await pgBoss.boss.work(APPROVAL_REMINDER, async () => {
      await reminderHandler.handle();
    });
    logger.log(`Registered ${APPROVAL_REMINDER} schedule (0 9 * * 1-5)`);
  } else {
    logger.log(`${APPROVAL_REMINDER} disabled via REMINDERS_DISABLED`);
  }

  // Scheduled: weekly digest (Monday 8am)
  const digestHandler = app.get(WeeklyDigestHandler);
  if (!config.DIGEST_DISABLED) {
    await pgBoss.boss.schedule(WEEKLY_DIGEST, '0 8 * * 1', {});
    await pgBoss.boss.work(WEEKLY_DIGEST, async () => {
      await digestHandler.handle();
    });
    logger.log(`Registered ${WEEKLY_DIGEST} schedule (0 8 * * 1)`);
  } else {
    logger.log(`${WEEKLY_DIGEST} disabled via DIGEST_DISABLED`);
  }

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
