import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmailTemplate } from '@prisma/client';
import { SealService } from '../crypto/seal.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { EmailTransport } from './email.transport';
import { EMAIL_TRANSPORT } from './email-transport.token';

/** Parameters for rendering a notification email. */
export interface QueueEmailParams {
  agencyId: string;
  template: EmailTemplate;
  toAddresses: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  relatedVersionId?: string;
  relatedClientId?: string;
  dedupeKey?: string;
}

const APP_NAME = 'Agency CRM';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly seal: SealService,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
  ) {}

  // ---------------------------------------------------------------------------
  // High-level queue methods — call these from domain services
  // ---------------------------------------------------------------------------

  /** VERSION_NEW: new version uploaded for a creative, ready for review. */
  async queueVersionNew(input: {
    agencyId: string;
    clientId: string;
    creativeId: string;
    creativeTitle: string;
    versionId: string;
    versionNo: number;
  }): Promise<void> {
    const toAddresses = await this.resolveClientEmails(input.clientId);
    if (toAddresses.length === 0) {
      this.logger.warn(`VERSION_NEW skipped: no email for client ${input.clientId}`);
      return;
    }

    const subject = `${APP_NAME}: New version "${input.creativeTitle}" v${input.versionNo}`;
    const bodyText = [
      `Hi,`,
      ``,
      `A new version (v${input.versionNo}) of "${input.creativeTitle}" has been uploaded and is ready for review.`,
      ``,
      `Open the review portal to approve or request changes.`,
      ``,
      `— ${APP_NAME}`,
    ].join('\n');

    const bodyHtml = `<p>Hi,</p>
<p>A new version (v${input.versionNo}) of "<strong>${escapeHtml(input.creativeTitle)}</strong>" has been uploaded and is ready for review.</p>
<p>Open the review portal to approve or request changes.</p>
<p>— ${APP_NAME}</p>`;

    await this.queue({
      agencyId: input.agencyId,
      template: 'VERSION_NEW',
      toAddresses,
      subject,
      bodyText,
      bodyHtml,
      relatedVersionId: input.versionId,
      relatedClientId: input.clientId,
      dedupeKey: `VERSION_NEW:${input.versionId}`,
    });
  }

  /** COMMENT_NEW: someone commented on a version. */
  async queueCommentNew(input: {
    agencyId: string;
    clientId: string;
    creativeTitle: string;
    versionId: string;
    versionNo: number;
    authorLabel: string;
    authorType: 'STAFF' | 'CLIENT';
    commentBody: string;
  }): Promise<void> {
    const toAddresses =
      input.authorType === 'STAFF'
        ? await this.resolveClientEmails(input.clientId)
        : await this.resolveStaffEmails(input.agencyId);

    if (toAddresses.length === 0) {
      this.logger.warn(`COMMENT_NEW skipped: no recipients for version ${input.versionId}`);
      return;
    }

    const subject = `${APP_NAME}: New comment on "${input.creativeTitle}" v${input.versionNo}`;
    const bodyText = [
      `Hi,`,
      ``,
      `${input.authorLabel} commented on version v${input.versionNo} of "${input.creativeTitle}":`,
      ``,
      `"${input.commentBody}"`,
      ``,
      `— ${APP_NAME}`,
    ].join('\n');

    const bodyHtml = `<p>Hi,</p>
<p><strong>${escapeHtml(input.authorLabel)}</strong> commented on version v${input.versionNo} of "<strong>${escapeHtml(input.creativeTitle)}</strong>":</p>
<blockquote>${escapeHtml(input.commentBody)}</blockquote>
<p>— ${APP_NAME}</p>`;

    await this.queue({
      agencyId: input.agencyId,
      template: 'COMMENT_NEW',
      toAddresses,
      subject,
      bodyText,
      bodyHtml,
      relatedVersionId: input.versionId,
      relatedClientId: input.clientId,
      dedupeKey: `COMMENT_NEW:${input.versionId}:${input.authorType}`,
    });
  }

  /** DECISION_CAST: someone approved/rejected/requested changes on a version. */
  async queueDecisionCast(input: {
    agencyId: string;
    clientId: string;
    creativeTitle: string;
    versionId: string;
    versionNo: number;
    decision: string;
    actorLabel: string;
    actorType: 'STAFF' | 'CLIENT';
  }): Promise<void> {
    const toAddresses =
      input.actorType === 'STAFF'
        ? await this.resolveClientEmails(input.clientId)
        : await this.resolveStaffEmails(input.agencyId);

    if (toAddresses.length === 0) {
      this.logger.warn(`DECISION_CAST skipped: no recipients for version ${input.versionId}`);
      return;
    }

    const decisionLabel = input.decision === 'APPROVED'
      ? 'approved'
      : input.decision === 'REJECTED'
        ? 'rejected'
        : 'requested changes on';

    const subject = `${APP_NAME}: Version "${input.creativeTitle}" v${input.versionNo} ${decisionLabel}`;
    const bodyText = [
      `Hi,`,
      ``,
      `${input.actorLabel} has ${decisionLabel} version v${input.versionNo} of "${input.creativeTitle}".`,
      ``,
      `— ${APP_NAME}`,
    ].join('\n');

    const bodyHtml = `<p>Hi,</p>
<p><strong>${escapeHtml(input.actorLabel)}</strong> has ${decisionLabel} version v${input.versionNo} of "<strong>${escapeHtml(input.creativeTitle)}</strong>".</p>
<p>— ${APP_NAME}</p>`;

    await this.queue({
      agencyId: input.agencyId,
      template: 'DECISION_CAST',
      toAddresses,
      subject,
      bodyText,
      bodyHtml,
      relatedVersionId: input.versionId,
      relatedClientId: input.clientId,
      dedupeKey: `DECISION_CAST:${input.versionId}:${input.actorType}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Low-level queue + transport
  // ---------------------------------------------------------------------------

  async queue(params: QueueEmailParams): Promise<string | null> {
    // Use unscoped prisma (not tenancy.scoped()) because this may run async
    // outside the request ALS context. agencyId is always provided explicitly.
    const db = this.prisma;

    // Dedupe: skip if an identical email was already queued/sent for this event.
    if (params.dedupeKey) {
      const existing = await db.emailMessage.findUnique({
        where: { dedupeKey: params.dedupeKey },
        select: { id: true },
      });
      if (existing) {
        this.logger.debug(`Duplicate skipped: ${params.dedupeKey}`);
        return null;
      }
    }

    // Seal body content for at-rest encryption (S11b). Transport receives
    // plaintext; DB stores sealed ciphertext.
    const sealedBodyText = this.seal.seal(params.bodyText);
    const sealedBodyHtml = this.seal.seal(params.bodyHtml);

    const email = await db.emailMessage.create({
      data: {
        agencyId: params.agencyId,
        template: params.template,
        status: 'QUEUED',
        dedupeKey: params.dedupeKey ?? null,
        toAddresses: params.toAddresses,
        subject: params.subject,
        bodyText: sealedBodyText,
        bodyHtml: sealedBodyHtml,
        relatedVersionId: params.relatedVersionId ?? null,
        relatedClientId: params.relatedClientId ?? null,
      },
      select: { id: true },
    });

    // Fire-and-forget transport; failure is non-blocking.
    try {
      const result = await this.transport.send({
        toAddresses: params.toAddresses,
        subject: params.subject,
        bodyText: params.bodyText,
        bodyHtml: params.bodyHtml,
      });

      await db.emailMessage.update({
        where: { id: email.id },
        data: {
          status: result.status,
          sentAt: result.status === 'SENT' ? new Date() : null,
          error: result.error ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Transport failed for ${email.id}: ${err}`);
      await db.emailMessage.update({
        where: { id: email.id },
        data: { status: 'FAILED', error: String(err) },
      });
    }

    return email.id;
  }

  // ---------------------------------------------------------------------------
  // Admin queries
  // ---------------------------------------------------------------------------

  async listEmails(filters?: { status?: string; template?: string }) {
    const db = this.tenancy.scoped();
    const where: Record<string, unknown> = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.template) where.template = filters.template;

    const rows = await db.emailMessage.findMany({
      where,
      select: {
        id: true,
        template: true,
        status: true,
        toAddresses: true,
        subject: true,
        bodyText: true,
        bodyHtml: true,
        relatedVersionId: true,
        relatedClientId: true,
        attempts: true,
        error: true,
        sentAt: true,
        failedAt: true,
        handledAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Unseal encrypted body fields (S11b) before returning to callers.
    return rows.map((row) => ({
      ...row,
      bodyText: this.seal.unseal(row.bodyText),
      bodyHtml: this.seal.unseal(row.bodyHtml),
    }));
  }

  async markHandled(emailId: string): Promise<{ id: string; handledAt: Date }> {
    const db = this.tenancy.scoped();
    const now = new Date();
    const result = await db.emailMessage.update({
      where: { id: emailId },
      data: { handledAt: now },
      select: { id: true },
    });
    return { id: result.id, handledAt: now };
  }

  // ---------------------------------------------------------------------------
  // Email address resolution
  // ---------------------------------------------------------------------------

  private async resolveClientEmails(clientId: string): Promise<string[]> {
    const links = await this.prisma.magicLink.findMany({
      where: { clientId, revokedAt: null },
      select: { recipientEmail: true },
      distinct: ['recipientEmail'],
    });
    const emails = links.map((l) => l.recipientEmail).filter(Boolean);
    return [...new Set(emails)];
  }

  private async resolveStaffEmails(agencyId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { agencyId, isActive: true, role: 'SUPER_ADMIN' },
      select: { email: true },
    });
    return users.map((u) => u.email);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
