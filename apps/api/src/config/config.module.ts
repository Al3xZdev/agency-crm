import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env.schema';

export const CONFIG = Symbol('CONFIG');

/**
 * Fail-fast environment configuration (task 2.1): the Zod parse runs when the
 * module is instantiated during boot; an invalid env aborts startup before
 * any listener or DB connection happens.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): Env => parseEnv(),
    },
  ],
  exports: [CONFIG],
})
export class ConfigModule {}
