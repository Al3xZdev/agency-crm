import { Injectable, Logger } from '@nestjs/common';
import type { EmailTransport, SendResult } from './email.transport';

/**
 * Console email transport stub (task S9). Logs emails to the NestJS logger
 * instead of sending real SMTP. Slice 11a replaces this with a real driver.
 * In test mode, this acts as a capture spy for assertions.
 */
@Injectable()
export class ConsoleEmailTransport implements EmailTransport {
  readonly kind = 'console' as const;
  private readonly logger = new Logger(ConsoleEmailTransport.name);

  /** Captured emails for test assertions. */
  readonly captured: Array<{
    toAddresses: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string;
  }> = [];

  async send(params: {
    toAddresses: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string;
  }): Promise<SendResult> {
    this.captured.push(params);

    this.logger.log(
      `[EMAIL STUB] To: ${params.toAddresses.join(', ')} | Subject: ${params.subject}`,
    );
    this.logger.debug(`[EMAIL STUB] Body:\n${params.bodyText}`);

    return { status: 'SENT', messageId: `stub-${Date.now()}` };
  }
}
