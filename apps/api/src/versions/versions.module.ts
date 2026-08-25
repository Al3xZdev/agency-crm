import { Module } from '@nestjs/common';

import { VersionsService } from './versions.service';
import { VersionsController } from './versions.controller';

@Module({
  providers: [VersionsService],
  controllers: [VersionsController],
  exports: [VersionsService],
})
export class VersionsModule {}
