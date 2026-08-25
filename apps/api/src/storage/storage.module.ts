import { Global, Injectable, Module } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { LocalStorageDriver } from './local.driver';
import type { StorageDriver } from './storage.driver';

/**
 * Factory seam (task 5b.1): the pipeline injects this port; STORAGE_DRIVER
 * picks the implementation. The s3 driver lands in slice 12 — until then the
 * enum still admits it in config but boot fails fast if selected early.
 */
@Injectable()
export class StorageService {
  readonly driver: StorageDriver;

  constructor(@Inject(CONFIG) config: Env) {
    switch (config.STORAGE_DRIVER) {
      case 'local':
        this.driver = new LocalStorageDriver(config.LOCAL_STORAGE_PATH);
        break;
      case 's3':
        // Slice 12 replaces this fail-fast with the S3Driver.
        throw new Error('STORAGE_DRIVER=s3 arrives with slice 12; use local');
      default: {
        const never: never = config.STORAGE_DRIVER;
        throw new Error(`unknown STORAGE_DRIVER ${String(never)}`);
      }
    }
  }
}

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
