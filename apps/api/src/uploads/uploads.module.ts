import { Body, Controller, Module, Param, Post, Req } from '@nestjs/common';

import { Roles } from '../auth/roles.decorator';
import { JobsModule, VERSION_QUEUE } from '../jobs/jobs.module';
import { PgBossQueue } from '../jobs/pg-boss.queue';
import { StorageModule } from '../storage/storage.module';
import type { Request } from 'express';
import { UploadsService } from './uploads.service';

/**
 * Version upload surface (task 5b.5/5b.6):
 *  - POST /creatives/:id/versions       → multipart binary admission
 *  - POST /creatives/:id/versions/text  → TEXT paste, READY immediately
 * Both are staff-only; tenancy scoping happens inside the service.
 */
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('creatives/:id/versions')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  upload(@Param('id') id: string, @Req() req: Request) {
    return this.uploads.uploadVersion(id, req);
  }

  @Post('creatives/:id/versions/text')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  pasteText(@Param('id') id: string, @Body() body: unknown) {
    return this.uploads.pasteTextVersion(id, body);
  }
}

@Module({
  imports: [StorageModule, JobsModule],
  providers: [
    UploadsService,
    PgBossQueue,
    { provide: VERSION_QUEUE, useExisting: PgBossQueue },
  ],
  controllers: [UploadsController],
  exports: [UploadsService],
})
export class UploadsModule {}
