import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { JobsModule } from './jobs.module';
import { ProcessVersionHandler } from './process-version.handler';

@Module({
  imports: [ConfigModule, PrismaModule, StorageModule, JobsModule],
  providers: [ProcessVersionHandler],
})
export class WorkerModule {}
