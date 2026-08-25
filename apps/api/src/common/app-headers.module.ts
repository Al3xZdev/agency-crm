import { Module, type NestModule } from '@nestjs/common';
import { MiddlewareConsumer } from '@nestjs/common';
import { ReferrerPolicyMiddleware } from './referrer-policy.middleware';

@Module({})
export class AppHeadersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ReferrerPolicyMiddleware).forRoutes('*path');
  }
}
