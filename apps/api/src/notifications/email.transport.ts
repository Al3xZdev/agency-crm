import type { EmailStatus } from '@prisma/client';

/** Result of attempting to deliver an email via the transport. */
export interface SendResult {
  status: EmailStatus;
  /** Provider-level message ID (optional, for SENT). */
  messageId?: string;
  /** Error message (for FAILED). */
  error?: string;
}

/**
 * Email transport port (task S9). The notifications module depends on this
 * interface only; implementations are swapped by the EMAIL_TRANSPORT env seam.
 * Slice 11a replaces the console stub with a real SMTP driver.
 */
export interface EmailTransport {
  readonly kind: 'console' | 'smtp' | 'ses';
  send(params: {
    toAddresses: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string;
  }): Promise<SendResult>;
}
