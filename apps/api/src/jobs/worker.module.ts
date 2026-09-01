import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { JobsModule } from './jobs.module';
import { ProcessVersionHandler } from './process-version.handler';
import { ApprovalReminderHandler } from './approval-reminder.handler';
import { WeeklyDigestHandler } from './weekly-digest.handler';

@Module({
  imports: [ConfigModule, PrismaModule, StorageModule, NotificationsModule, TenancyModule, JobsModule],
  providers: [ProcessVersionHandler, ApprovalReminderHandler, WeeklyDigestHandler],
})
export class WorkerModule {}
