import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class WeeklyDigestHandler {
  private readonly logger = new Logger(WeeklyDigestHandler.name);

  constructor(
    @Inject(SYSTEM_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(): Promise<void> {
    const agencies = await this.prisma.agency.findMany({
      select: { id: true, name: true },
    });

    for (const agency of agencies) {
      await this.digestForAgency(agency.id, agency.name);
    }
  }

  private async digestForAgency(agencyId: string, agencyName: string): Promise<void> {
    const pendingVersions = await this.prisma.creativeVersion.findMany({
      where: {
        agencyId,
        state: 'READY',
        reviewStatus: 'NONE',
      },
      select: {
        id: true,
        clientId: true,
        versionNo: true,
        creative: { select: { title: true } },
      },
    });

    if (pendingVersions.length === 0) {
      this.logger.debug(`No pending versions for agency ${agencyId}`);
      return;
    }

    const byClient = new Map<string, typeof pendingVersions>();
    for (const v of pendingVersions) {
      const list = byClient.get(v.clientId) ?? [];
      list.push(v);
      byClient.set(v.clientId, list);
    }

    this.logger.log(`Weekly digest: ${pendingVersions.length} pending version(s) across ${byClient.size} client(s) for ${agencyName}`);

    for (const [clientId, versions] of byClient) {
      const toAddresses = await this.resolveClientEmails(clientId);
      if (toAddresses.length === 0) {
        this.logger.warn(`Digest skipped: no email for client ${clientId}`);
        continue;
      }

      const lines = versions.map(
        (v) => `  - "${v.creative.title}" v${v.versionNo}`,
      );

      await this.notifications.queue({
        agencyId,
        template: 'WEEKLY_DIGEST',
        toAddresses,
        subject: `Weekly Digest: ${versions.length} item(s) awaiting your review`,
        bodyText: [
          `Hi,`,
          ``,
          `You have ${versions.length} creative version(s) awaiting review this week:`,
          ``,
          ...lines,
          ``,
          `Open the review portal to approve or request changes.`,
          ``,
          `— Agency CRM`,
        ].join('\n'),
        bodyHtml: `<p>Hi,</p>
<p>You have <strong>${versions.length}</strong> creative version(s) awaiting review this week:</p>
<ul>
${lines.map((l) => `<li>${escapeHtml(l.trim().replace(/^- /, ''))}</li>`).join('\n')}
</ul>
<p>Open the review portal to approve or request changes.</p>
<p>— Agency CRM</p>`,
        relatedClientId: clientId,
        dedupeKey: `WEEKLY_DIGEST:${clientId}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  private async resolveClientEmails(clientId: string): Promise<string[]> {
    const links = await this.prisma.magicLink.findMany({
      where: { clientId, revokedAt: null },
      select: { recipientEmail: true },
      distinct: ['recipientEmail'],
    });
    return links.map((l) => l.recipientEmail).filter(Boolean);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
