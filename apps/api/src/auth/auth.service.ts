import { HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Session, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_MAX_FAILURES = 10;

export class TooManyRequestsException extends HttpException {
  constructor() {
    super({ statusCode: 429, message: 'Too Many Requests' }, 429);
  }
}

export interface MintedSession {
  session: Session;
  /** Opaque cookie value; only its sha256 is persisted. */
  rawToken: string;
  /** Double-submit CSRF token: `<nonce>.<hmac>` bound to the session secret. */
  csrfToken: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Staff authentication (tasks 2.4/2.7).
 *
 * Security invariants (spec Cap 1):
 * - unknown email and wrong password produce the IDENTICAL generic 401;
 * - the 11th failed attempt inside a 15-minute window gets 429 BEFORE any
 *   password work happens (fail-insert / success-delete bookkeeping);
 * - only `sha256(rawToken)` is stored — DB theft cannot mint sessions;
 * - every session carries its own csrfSecret for double-submit binding.
 */
@Injectable()
export class AuthService {
  // Explicit @Inject keeps DI working even when decorator metadata is absent
  // (vitest/SWC test transform).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async login(email: string, password: string, ttlDays: number): Promise<MintedSession> {
    const emailLower = email.trim().toLowerCase();

    const failures = await this.prisma.loginAttempt.count({
      where: { emailLower, attemptedAt: { gte: new Date(Date.now() - THROTTLE_WINDOW_MS) } },
    });
    if (failures >= THROTTLE_MAX_FAILURES) {
      throw new TooManyRequestsException();
    }

    const user = await this.prisma.user.findUnique({ where: { email: emailLower } });
    let valid = false;
    if (user?.isActive) {
      valid = await verify(user.passwordHash, password).catch(() => false);
    }

    if (!valid || !user) {
      await this.prisma.loginAttempt.create({ data: { emailLower } });
      throw new UnauthorizedException();
    }

    await this.prisma.loginAttempt.deleteMany({ where: { emailLower } });
    return this.mintStaffSession(user, ttlDays);
  }

  /** Instant revocation: next request with this session dies with 401. */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async mintStaffSession(user: User, ttlDays: number): Promise<MintedSession> {
    const rawToken = randomBytes(32).toString('base64url');
    const csrfNonce = randomBytes(32).toString('base64url');
    const csrfSecret = randomBytes(32).toString('hex');

    const session = await this.prisma.session.create({
      data: {
        tokenHash: sha256(rawToken),
        kind: 'STAFF',
        agencyId: user.agencyId,
        userId: user.id,
        csrfSecret,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });

    const csrfToken = `${csrfNonce}.${createHmac('sha256', csrfSecret).update(csrfNonce).digest('base64url')}`;
    return { session, rawToken, csrfToken };
  }
}
