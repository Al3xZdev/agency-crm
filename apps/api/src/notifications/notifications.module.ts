import { Global, Logger, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ConsoleEmailTransport } from './console-email.transport';
import { SmtpEmailTransport } from './smtp-email.transport';
import { EMAIL_TRANSPORT } from './email-transport.token';
import { SealModule } from '../crypto/seal.module';

/**
 * Notifications module (tasks S9 + S11a). Queues email messages for version
 * uploads, comments, review decisions, approval reminders, and weekly digests.
 *
 * Transport selection: when SMTP_URL is set in the environment, emails are
 * delivered via real SMTP (nodemailer). Otherwise, the console stub logs
 * emails to the NestJS logger for development.
 *
 * Must be @Global because the service depends on TenancyService + PrismaService
 * (both global), and child modules that import NotificationsModule need these
 * resolved in the root injector scope.
 */
const logger = new Logger('NotificationsModule');

function createEmailTransport() {
  const smtpUrl = process.env.SMTP_URL;
  const mailFrom = process.env.MAIL_FROM;

  if (smtpUrl) {
    if (!mailFrom) {
      logger.warn('SMTP_URL is set but MAIL_FROM is missing — falling back to console transport');
      return { provide: EMAIL_TRANSPORT, useClass: ConsoleEmailTransport };
    }
    logger.log('Using SMTP email transport');
    return {
      provide: EMAIL_TRANSPORT,
      useFactory: () => new SmtpEmailTransport(smtpUrl, mailFrom),
    };
  }

  logger.log('Using console email transport (no SMTP_URL configured)');
  return { provide: EMAIL_TRANSPORT, useClass: ConsoleEmailTransport };
}

@Global()
@Module({
  imports: [SealModule],
  controllers: [NotificationsController],
  providers: [createEmailTransport(), NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
