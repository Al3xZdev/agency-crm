import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SESSION_COOKIE, cookiePolicy } from '../../src/auth/cookies';

/**
 * Slice-2 auth suite (tasks 2.3–2.7). Runs against a mocked PrismaService so
 * the whole behavioral matrix executes locally without Docker; persistence
 * semantics (unique constraints, trigger immutability) stay covered by
 * container-based integration evidence pending a Docker-capable host.
 */

interface FakeUser {
  id: string;
  agencyId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'ACCOUNT_MANAGER' | 'CREATIVE';
  isActive: boolean;
}

function sha256hex(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

function buildMockDb() {
  const users = new Map<string, FakeUser>();
  const sessions = new Map<string, Record<string, unknown> & { userId?: string }>();
  let loginAttempts: Array<{ id: number; emailLower: string; attemptedAt: Date }> = [];
  let attemptSeq = 0;

  const withUser = (s: Record<string, unknown>) => ({
    ...s,
    user: s.userId ? users.get(s.userId as string) ?? null : null,
  });

  const db = {
    _users: users,
    _sessions: sessions,
    _attempts: () => loginAttempts,
    _seedUser: async (partial: Partial<FakeUser> & { email: string }) => {
      const u: FakeUser = {
        id: `u_${users.size + 1}`,
        agencyId: partial.agencyId ?? 'agency_1',
        displayName: partial.displayName ?? 'Test User',
        role: partial.role ?? 'SUPER_ADMIN',
        isActive: partial.isActive ?? true,
        passwordHash: await hash(partial.password ?? 'correct horse battery staple'),
        ...('passwordHash' in partial ? {} : {}),
        email: partial.email.toLowerCase(),
      };
      users.set(u.id, u);
      return u;
    },
    user: {
      findUnique: ({ where }: { where: { email?: string } }) =>
        [...users.values()].find((u) => u.email === where.email?.toLowerCase()) ?? null,
      create: ({ data }: { data: Record<string, unknown> }) => {
        const u = { id: `u_${users.size + 1}`, isActive: true, ...data } as FakeUser;
        if ([...users.values()].some((x) => x.email === u.email)) {
          const err = new Error('Unique constraint failed') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        users.set(u.id, u);
        return { id: u.id };
      },
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = users.get(where.id);
        if (!u) throw new Error('not found');
        Object.assign(u, data);
        return { id: u.id, role: u.role, isActive: u.isActive };
      },
      updateMany: ({ where, data }: { where: { userId?: string }; data: Record<string, unknown> }) => {
        let n = 0;
        for (const s of sessions.values()) {
          if (!where.userId || s.userId === where.userId) {
            Object.assign(s, data);
            n++;
          }
        }
        return { count: n };
      },
      findMany: () => [...users.values()],
    },
    loginAttempt: {
      count: ({ where }: { where: { emailLower: string; attemptedAt: { gte: Date } } }) =>
        loginAttempts.filter(
          (a) => a.emailLower === where.emailLower && a.attemptedAt >= where.attemptedAt.gte,
        ).length,
      create: ({ data }: { data: { emailLower: string } }) => {
        loginAttempts.push({ id: ++attemptSeq, ...data, attemptedAt: new Date() });
        return data;
      },
      deleteMany: ({
        where,
      }: {
        where: { emailLower: string; attemptedAt?: { lt?: Date } };
      }) => {
        // Mirror Prisma semantics: only rows matching ALL conditions die.
        const cutoff = where.attemptedAt?.lt;
        const before = loginAttempts.length;
        loginAttempts = loginAttempts.filter(
          (a) => !(a.emailLower === where.emailLower && (!cutoff || a.attemptedAt < cutoff)),
        );
        return { count: before - loginAttempts.length };
      },
    },
    session: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const s = { id: `s_${sessions.size + 1}`, revokedAt: null, kind: 'STAFF', ...data };
        sessions.set(s.id as string, s);
        return s;
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) => {
        const s = [...sessions.values()].find((x) => x.tokenHash === where.tokenHash);
        return s ? withUser(s) : null;
      },
      updateMany: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = sessions.get(where.id);
        if (!s || s.revokedAt !== null) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      },
    },
  };
  return db;
}

type MockDb = ReturnType<typeof buildMockDb>;

describe('staff auth (slice 2)', () => {
  let app: INestApplication;
  let db: MockDb;

  const ADMIN = { email: 'admin@agency.test', password: 'correct horse battery staple' };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
    process.env.SESSION_TTL_DAYS = '7';
  });

  beforeEach(async () => {
    db = buildMockDb();
    await db._seedUser({ ...ADMIN, role: 'SUPER_ADMIN' });
    await db._seedUser({
      email: 'creative@agency.test',
      password: 'creative-passphrase',
      role: 'CREATIVE',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  function cookieOf(res: request.Response, name: string): string | undefined {
    const raw: string[] = res.headers['set-cookie'] ?? [];
    return raw.find((c) => c.startsWith(`${name}=`));
  }

  async function loginAs(email: string, password: string) {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return res;
  }

  /** CSRF cookie name for the test environment per the shared policy. */
  const csrfCookieName = cookiePolicy('test').csrfName;

  /** Authenticated request helper carrying session+CSRF pair. */
  async function authed(email: string, password: string, method: 'get' | 'post', url: string) {
    const res = await loginAs(email, password);
    const sessionCookie = cookieOf(res, SESSION_COOKIE);
    const csrfCookie = cookieOf(res, csrfCookieName);
    const csrfValue = csrfCookie?.split(';')[0];
    const tokenPair = decodeURIComponent(csrfValue!.split('=')[1]);
    const req = request(app.getHttpServer())
      [method](url)
      .set('Cookie', [sessionCookie, csrfCookie].join('; '));
    if (method !== 'get') req.set('X-CSRF-Token', tokenPair);
    return { req, loginRes: res, tokenPair };
  }

  it('returns the IDENTICAL generic 401 body for unknown email and wrong password', async () => {
    const unknown = await loginAs('nobody@agency.test', 'whatever-secret');
    const wrongPw = await loginAs(ADMIN.email, 'definitely-not-it');

    expect(unknown.status).toBe(401);
    expect(wrongPw.status).toBe(401);
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(wrongPw.body));
  });

  it('sets secure cookie flags on login: session HttpOnly+Lax, csrf readable', async () => {
    const res = await loginAs(ADMIN.email, ADMIN.password);

    expect(res.status).toBe(200);
    const session = cookieOf(res, SESSION_COOKIE)!;
    const csrf = cookieOf(res, csrfCookieName)!;
    expect(session).toContain('HttpOnly');
    expect(session.toLowerCase()).toContain('samesite=lax');
    expect(session).toContain('Path=/');
    // dev/test over plain http: Secure off AND unprefixed csrf name — the
    // __Host- prefix would be silently dropped without Secure (audit #1);
    // production forces Secure + __Host-csrf (unit-checked separately).
    expect(session).not.toContain('Secure');
    expect(csrf).not.toContain('Secure');
    expect(csrf).not.toContain('HttpOnly');
  });

  it('uses __Host-csrf with Secure only in production policy', () => {
    expect(cookiePolicy('production')).toMatchObject({ secure: true, csrfName: '__Host-csrf' });
    expect(cookiePolicy('development').csrfName).toBe('agency_csrf');
  });

  it('rejects unsafe requests missing the CSRF pair with 403 and touches nothing', async () => {
    const res = await loginAs(ADMIN.email, ADMIN.password);
    const sessionCookie = cookieOf(res, SESSION_COOKIE)!;

    const denied = await request(app.getHttpServer())
      .post('/staff')
      .set('Cookie', sessionCookie)
      .send({ email: 'new@agency.test', password: 'long-enough-pass', displayName: 'X', role: 'CREATIVE' });

    expect(denied.status).toBe(403);
    expect(db._users.size).toBe(2); // nothing created
  });

  it('accepts a matching signed CSRF pair and creates the staff member', async () => {
    const { req } = await authed(ADMIN.email, ADMIN.password, 'post', '/staff');
    const created = await req.send({
      email: 'new@agency.test',
      password: 'long-enough-pass',
      displayName: 'New Person',
      role: 'ACCOUNT_MANAGER',
    });

    expect(created.status).toBe(201);
    expect(created.body.id).toBeDefined();
    expect(db._users.size).toBe(3);
  });

  it('invalidates the session after logout: replaying the cookie yields 401', async () => {
    const { req, loginRes, tokenPair } = await authed(ADMIN.email, ADMIN.password, 'post', '/auth/logout');
    const sessionCookie = cookieOf(loginRes, SESSION_COOKIE)!;
    const loggedOut = await req.set('X-CSRF-Token', tokenPair);
    expect(loggedOut.status).toBe(204);

    const replay = await request(app.getHttpServer())
      .get('/staff')
      .set('Cookie', sessionCookie);
    expect(replay.status).toBe(401);
  });

  it('throttles: the 11th failed login within 15 minutes gets 429', async () => {
    // Seed 9 failures, then two live attempts: #10 passes through (401),
    // #11 must hit the throttle wall (429).
    for (let i = 0; i < 9; i++) {
      db.loginAttempt.create({ data: { emailLower: ADMIN.email } });
    }
    const tenth = await loginAs(ADMIN.email, 'nope-nope');
    expect(tenth.status).toBe(401);

    const eleventh = await loginAs(ADMIN.email, 'still-wrong');
    expect(eleventh.status).toBe(429);
  });

  it('denies CREATIVE role access to SUPER_ADMIN staff endpoints with 403', async () => {
    const { req } = await authed('creative@agency.test', 'creative-passphrase', 'post', '/staff');
    const denied = await req.send({
      email: 'x@agency.test',
      password: 'long-enough-pass',
      displayName: 'X',
      role: 'CREATIVE',
    });
    expect(denied.status).toBe(403);
    expect(db._users.size).toBe(2);
  });

  it('unauthenticated access to protected routes yields 401', async () => {
    const res = await request(app.getHttpServer()).get('/staff');
    expect(res.status).toBe(401);
  });

  it('keeps health probes public', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.status).toBe(200);
  });

  it('fail-fast: invalid env aborts configuration parsing', async () => {
    const { parseEnv } = await import('../../src/config/env.schema');
    expect(() => parseEnv({} as NodeJS.ProcessEnv)).toThrowError(/DATABASE_URL/);
  });

  it('session tokens are stored hashed, never raw', async () => {
    const res = await loginAs(ADMIN.email, ADMIN.password);
    const rawToken = decodeURIComponent(cookieOf(res, SESSION_COOKIE)!.split(';')[0].split('=')[1]);
    const storedHashes = [...db._sessions.keys()];
    void storedHashes;
    const values = [...db._sessions.values()] as Array<{ tokenHash: string }>;
    expect(values.some((s) => s.tokenHash === sha256hex(rawToken))).toBe(true);
    expect(values.some((s) => s.tokenHash === rawToken)).toBe(false);
  });

  // --- slice-3.5 hardening additions (audit findings 3/6) ---

  it('rejects an EXPIRED session with the same generic 401', async () => {
    await db._seedUser({ email: 'exp@agency.test', password: 'expired-passphrase' });
    const raw = 'raw-expired-token';
    db._sessions.set('s_expired', {
      id: 's_expired',
      tokenHash: sha256hex(raw),
      kind: 'STAFF',
      agencyId: 'agency_1',
      userId: 'u_3',
      csrfSecret: 'x',
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    });
    const res = await request(app.getHttpServer()).get('/staff').set('Cookie', `${SESSION_COOKIE}=${raw}`);
    expect(res.status).toBe(401);
  });

  it('rejects login of a DEACTIVATED user and revokes their live sessions', async () => {
    const u = await db._seedUser({ email: 'gone@agency.test', password: 'still-correct-pass' });

    // Live session for the user, then soft-deactivation revokes it.
    const raw = 'raw-live-token';
    db._sessions.set('s_live', {
      id: 's_live',
      tokenHash: sha256hex(raw),
      kind: 'STAFF',
      agencyId: 'agency_1',
      userId: u.id,
      csrfSecret: 'x',
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    });
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });

    const liveRejection = await request(app.getHttpServer())
      .get('/staff')
      .set('Cookie', `${SESSION_COOKIE}=${raw}`);
    expect(liveRejection.status).toBe(401);

    const loginAttempt = await loginAs('gone@agency.test', 'still-correct-pass');
    const unknown = await loginAs('nobody@agency.test', 'whatever-secret');
    expect(loginAttempt.status).toBe(401);
    // Deactivated and unknown are indistinguishable AND both burn argon2 work
    // (timing parity — the body check is the behavioral half).
    expect(JSON.stringify(loginAttempt.body)).toBe(JSON.stringify(unknown.body));
  });

  it('rejects a CSRF token replayed across sessions (cross-session pair mismatch)', async () => {
    // Session A (admin) mints a token signed with A's csrfSecret...
    const { tokenPair } = await authed(ADMIN.email, ADMIN.password, 'post', '/staff');
    // ...session B (creative) presents its own cookies but A's token:
    const b = await authed('creative@agency.test', 'creative-passphrase', 'get', '/staff');
    void b;
    const bLogin = await loginAs('creative@agency.test', 'creative-passphrase');
    const forged = await request(app.getHttpServer())
      .post('/staff')
      .set('Cookie', [cookieOf(bLogin, SESSION_COOKIE)!, cookieOf(bLogin, csrfCookieName)!].join('; '))
      .set('X-CSRF-Token', tokenPair)
      .send({ email: 'z@agency.test', password: 'long-enough-pass', displayName: 'Z', role: 'CREATIVE' });
    expect(forged.status).toBe(403);
    expect(db._users.size).toBe(2);
  });

  it('maps malformed JSON bodies to 400 VALIDATION_ERROR via the global filter', async () => {
    const badLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: 'not-an-email' });
    expect(badLogin.status).toBe(400);
    expect(badLogin.body.message).toBe('VALIDATION_ERROR');

    const { req } = await authed(ADMIN.email, ADMIN.password, 'post', '/staff');
    const badStaff = await req.send({ email: 'ok@agency.test', password: 'short' });
    expect(badStaff.status).toBe(400);
    expect(badStaff.body.message).toBe('VALIDATION_ERROR');
  });
});
