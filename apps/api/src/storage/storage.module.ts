import { Global, Injectable, Module } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { LocalStorageDriver } from './local.driver';
import { S3StorageDriver } from './s3.driver';
import type { StorageDriver } from './storage.driver';

/**
 * Factory seam (task 5b.1): the pipeline injects this port; STORAGE_DRIVER
 * picks the implementation. S3 driver (slice 12) requires S3_ENDPOINT,
 * S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
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
        this.driver = new S3StorageDriver({
          endpoint: config.S3_ENDPOINT!,
          bucket: config.S3_BUCKET!,
          accessKey: config.S3_ACCESS_KEY!,
          secretKey: config.S3_SECRET_KEY!,
          region: config.S3_REGION,
        });
        break;
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
