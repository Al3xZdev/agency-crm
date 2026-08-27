import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import { NotificationsService } from '../notifications/notifications.service';

const REMINDER_THRESHOLD_DAYS = 2;

@Injectable()
export class ApprovalReminderHandler {
  private readonly logger = new Logger(ApprovalReminderHandler.name);

  constructor(
    @Inject(SYSTEM_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(): Promise<void> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - REMINDER_THRESHOLD_DAYS);

    const staleVersions = await this.prisma.creativeVersion.findMany({
      where: {
        state: 'READY',
        reviewStatus: 'NONE',
        reviewStartedAt: { not: null, lt: threshold },
      },
      select: {
        id: true,
        agencyId: true,
        clientId: true,
        creativeId: true,
        versionNo: true,
        reviewStartedAt: true,
        creative: { select: { title: true } },
      },
    });

    if (staleVersions.length === 0) {
      this.logger.debug('No stale versions found for approval reminder');
      return;
    }

    this.logger.log(`Found ${staleVersions.length} stale version(s) needing reminder`);

    for (const version of staleVersions) {
      const toAddresses = await this.resolveClientEmails(version.clientId);
      if (toAddresses.length === 0) {
        this.logger.warn(`Reminder skipped: no email for client ${version.clientId}`);
        continue;
      }

      const title = version.creative.title;

      await this.notifications.queue({
        agencyId: version.agencyId,
        template: 'APPROVAL_REMINDER',
        toAddresses,
        subject: `Reminder: "${title}" v${version.versionNo} is awaiting review`,
        bodyText: [
          `Hi,`,
          ``,
          `This is a reminder that version v${version.versionNo} of "${title}" has been awaiting your review since ${version.reviewStartedAt!.toISOString().slice(0, 10)}.`,
          ``,
          `Please review and approve or request changes at your earliest convenience.`,
          ``,
          `— Agency CRM`,
        ].join('\n'),
        bodyHtml: `<p>Hi,</p>
<p>This is a reminder that version v${version.versionNo} of "<strong>${escapeHtml(title)}</strong>" has been awaiting your review since ${version.reviewStartedAt!.toISOString().slice(0, 10)}.</p>
<p>Please review and approve or request changes at your earliest convenience.</p>
<p>— Agency CRM</p>`,
        relatedVersionId: version.id,
        relatedClientId: version.clientId,
        dedupeKey: `APPROVAL_REMINDER:${version.id}:${new Date().toISOString().slice(0, 10)}`,
      });

      await this.prisma.creativeVersion.update({
        where: { id: version.id },
        data: { lastReminderAt: new Date() },
      });

      this.logger.log(`Reminder sent for version ${version.id}`);
    }
  }

  private async resolveClientEmails(clientId: string): Promise<string[]> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { email: true },
    });
    const clientEmail = client?.email;

    const links = await this.prisma.magicLink.findMany({
      where: { clientId, revokedAt: null },
      select: { recipientEmail: true },
      distinct: ['recipientEmail'],
    });
    const emails = links.map((l) => l.recipientEmail).filter(Boolean);

    if (clientEmail) emails.push(clientEmail);
    return [...new Set(emails)];
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
