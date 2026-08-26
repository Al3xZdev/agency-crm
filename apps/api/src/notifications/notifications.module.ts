import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ConsoleEmailTransport } from './console-email.transport';
import { EMAIL_TRANSPORT } from './email-transport.token';

/**
 * Notifications module (task S9). Queues email messages for version uploads,
 * comments, and review decisions. The console transport stub logs emails to
 * the logger; slice 11a replaces it with real SMTP.
 *
 * Must be @Global because the service depends on TenancyService + PrismaService
 * (both global), and child modules that import NotificationsModule need these
 * resolved in the root injector scope.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: EMAIL_TRANSPORT, useClass: ConsoleEmailTransport },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
