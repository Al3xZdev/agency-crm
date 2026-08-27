import { Global, Module } from '@nestjs/common';
import { SealService } from './seal.service';

/**
 * Global encryption module (task S11b). Provides SealService for encrypting
 * PII fields at-rest. No dependencies — reads MAIL_SEAL_KEY from process.env.
 */
@Global()
@Module({
  providers: [SealService],
  exports: [SealService],
})
export class SealModule {}
