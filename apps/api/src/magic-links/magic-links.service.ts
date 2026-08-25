import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { MagicLink, Session } from '@prisma/client';
import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import type { PrismaService } from '../prisma/prisma.service';
import type { Principal } from '../tenancy/request-context.als';
import { TenancyService } from '../tenancy/tenancy.service';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function signCsrf(secret: string, nonce: string): string {
  return createHmac('sha256', secret).update(nonce).digest('base64url');
}

export interface MintedLink {
  id: string;
  /** Absolute `/c/{raw}` URL shown exactly once; the raw token is never stored. */
  url: string;
  expiresAt: Date | null;
}

export interface RedeemedSession {
  session: Session;
  rawToken: string;
  csrfToken: string;
}

/**
 * Client magic links (tasks 4.2/4.3, spec Cap 2).
 *
 * Invariants:
 * - only sha256(rawToken) is persisted — DB theft cannot mint links;
 * - a link may be redeemed from MULTIPLE browsers (each redemption mints a
 *   fresh CLIENT session); revoking the link instantly kills every session
 *   it ever created via one transactional cascade;
 * - unknown/expired/revoked tokens are indistinguishable (generic invalid);
 * - logs carry the link id and hash prefix only, never raw material.
 */
@Injectable()
export class MagicLinksService {
  private readonly logger = new Logger(MagicLinksService.name);
  private readonly prisma: PrismaService;
  private readonly tenancy: TenancyService;
  private readonly webBaseUrl: string;

  constructor(
    @Inject(SYSTEM_PRISMA) prisma: PrismaService,
    tenancy: TenancyService,
    @Inject(CONFIG) config: Env,
  ) {
    this.prisma = prisma;
    this.tenancy = tenancy;
    this.webBaseUrl = config.PUBLIC_WEB_URL.replace(/\/+$/, '');
  }

  async mint(
    actor: Principal,
    clientId: string,
    input: { recipientEmail?: string; expiresInDays?: number },
  ): Promise<MintedLink> {
    const client = await this.tenancy.scoped().client.findFirst({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException();

    const rawToken = randomBytes(32).toString('base64url');
    const link = await this.tenancy.scoped().magicLink.create({
      data: {
        agencyId: actor.agencyId,
        clientId,
        recipientEmail: input.recipientEmail ?? '',
        createdById: actor.userId!,
        tokenHash: sha256(rawToken),
        ...(input.expiresInDays
          ? { expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000) }
          : {}),
      },
      select: { id: true, expiresAt: true },
    });
    this.logger.log(`minted link ${link.id} (${sha256(rawToken).slice(0, 8)}…) for client ${clientId}`);
    return { id: link.id, url: `${this.webBaseUrl}/c/${rawToken}`, expiresAt: link.expiresAt };
  }

  /** One-transaction kill switch: revoke the link AND every session it minted. */
  async revoke(actor: Principal, linkId: string): Promise<{ revokedSessions: number }> {
    const scoped = this.tenancy.scoped();
    const killed = await scoped.$transaction(async (tx) => {
      const link = await tx.magicLink.updateMany({
        where: { id: linkId, agencyId: actor.agencyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (link.count === 0) return null;
      const sessions = await tx.session.updateMany({
        where: { magicLinkId: linkId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return sessions.count;
    });
    if (killed === null) throw new NotFoundException();
    this.logger.log(`revoked link ${linkId}, ${killed} live session(s) killed`);
    return { revokedSessions: killed };
  }

  /**
   * Public redemption. Every failure mode returns `undefined` so the route
   * answers with ONE identical generic response and sets NO cookies.
   */
  async redeem(rawToken: string): Promise<RedeemedSession | undefined> {
    const link: MagicLink | null = await this.prisma.magicLink.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { client: { select: { id: true, agencyId: true } } },
    });
    if (!link || link.revokedAt !== null) return undefined;
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return undefined;

    const rawSessionToken = randomBytes(32).toString('base64url');
    const csrfNonce = randomBytes(32).toString('base64url');
    const csrfSecret = randomBytes(32).toString('hex');
    const session = await this.prisma.session.create({
      data: {
        tokenHash: sha256(rawSessionToken),
        kind: 'CLIENT',
        agencyId: link.agencyId,
        clientId: link.clientId,
        magicLinkId: link.id,
        csrfSecret,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    void this.prisma.magicLink
      .update({ where: { id: link.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { session, rawToken: rawSessionToken, csrfToken: `${csrfNonce}.${signCsrf(csrfSecret, csrfNonce)}` };
  }
}
