import { Module } from '@nestjs/common';
import { MagicLinksController } from './magic-links.controller';
import { MagicLinksService } from './magic-links.service';

@Module({
  controllers: [MagicLinksController],
  providers: [MagicLinksService],
})
export class MagicLinksModule {}
