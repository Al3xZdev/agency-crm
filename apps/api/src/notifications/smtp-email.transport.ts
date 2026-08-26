import { Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import type { EmailTransport, SendResult } from './email.transport';

/**
 * Real SMTP email transport (task S11a). Uses nodemailer to deliver emails
 * via any SMTP-compatible provider (Gmail, SendGrid, Mailgun, etc.).
 *
 * Falls back gracefully: if SMTP_URL is not configured, the module injects
 * ConsoleEmailTransport instead. This class is only instantiated when
 * SMTP_URL is present and valid.
 */
@Injectable()
export class SmtpEmailTransport implements EmailTransport {
  readonly kind = 'smtp' as const;
  private readonly logger = new Logger(SmtpEmailTransport.name);
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(smtpUrl: string, fromAddress: string) {
    this.transporter = nodemailer.createTransport(smtpUrl);
    this.fromAddress = fromAddress;
    this.logger.log(`SMTP transport initialized: ${this.maskUrl(smtpUrl)}`);
  }

  async send(params: {
    toAddresses: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string;
  }): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: params.toAddresses.join(', '),
        subject: params.subject,
        text: params.bodyText,
        html: params.bodyHtml,
      });

      this.logger.log(`Email sent: ${info.messageId} to ${params.toAddresses.join(', ')}`);
      return { status: 'SENT', messageId: info.messageId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP send failed: ${errorMsg}`);
      return { status: 'FAILED', error: errorMsg };
    }
  }

  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) parsed.password = '***';
      if (parsed.username) parsed.username = parsed.username.slice(0, 3) + '***';
      return parsed.toString();
    } catch {
      return '***';
    }
  }
}
