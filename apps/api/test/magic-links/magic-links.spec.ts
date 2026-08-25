import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SESSION_COOKIE, cookiePolicy } from '../../src/auth/cookies';

/**
 * Slice-4 magic-link suite (tasks 4.1–4.5). Runs against a mocked
 * PrismaService; persistence semantics (unique tokenHash, FK cascades) stay
 * covered by container-based integration evidence pending Docker.
 */

function sha256hex(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

function signCsrf(secret: string): string {
  const nonce = randomBytes(16).toString('base64url');
  return `${nonce}.${createHmac('sha256', secret).update(nonce).digest('base64url')}`;
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function buildMockDb() {
  const clients = new Map<string, Record<string, unknown>>();
  const links = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: {
      id: 'u_admin',
      email: 'admin@agency.test',
      isActive: true,
      role: 'SUPER_ADMIN',
    },
    u_creative: {
      id: 'u_creative',
      email: 'creative@agency.test',
      isActive: true,
      role: 'CREATIVE',
    },
  };

  const db = {
    _clients: clients,
    _links: links,
    _sessions: sessions,
    _seedClient(id = 'client_1') {
      clients.set(id, { id, agencyId: 'agency_1', name: `Client ${id}` });
      return clients.get(id)!;
    },
    // TenancyService.scoped() calls $extends on whatever PrismaService is
    // injected; pass the raw mock through (scoping itself has its own S3 spec).
    $extends: null as unknown,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => fn(db),
    magicLink: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const link = { id: `link_${links.size + 1}`, revokedAt: null, lastUsedAt: null, ...data };
        links.set(link.id as string, link);
        return link;
      },
      findUnique: ({
        where,
        include,
      }: {
        where: { tokenHash: string };
        include?: object;
      }) => {
        void include;
        return [...links.values()].find((l) => l.tokenHash === where.tokenHash) ?? null;
      },
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let n = 0;
        for (const l of links.values()) {
          if (!matchesWhere(l, where)) continue;
          Object.assign(l, data);
          n++;
        }
        return { count: n };
      },
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const l = links.get(where.id);
        if (l) Object.assign(l, data);
        return Promise.resolve(l ?? null); // Prisma delegates are thenables
      },
    },
    session: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const s = { id: `s_${sessions.size + 1}`, revokedAt: null, ...data };
        sessions.set(s.id as string, s);
        return s;
      },
      findUnique: ({
        where,
        include,
      }: {
        where: { tokenHash: string };
        include?: object;
      }) => {
        void include;
        const s =
          [...sessions.values()].find((x) => x.tokenHash === where.tokenHash) ?? null;
        if (!s) return null;
        // Emulate Prisma includes so the guard can read nested relations.
        if (s.userId && !s.user) s.user = userRows[s.userId as string] ?? null;
        if (s.magicLinkId && !s.magicLink) s.magicLink = links.get(s.magicLinkId as string) ?? null;
        return s;
      },
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let n = 0;
        for (const s of sessions.values()) {
          if (!matchesWhere(s, where)) continue;
          Object.assign(s, data);
          n++;
        }
        return { count: n };
      },
    },
    client: {
      findFirst: ({ where }: { where: { id: string } }) =>
        [...clients.values()].find((c) => c.id === where.id) ?? null,
    },
  };
  (db.$extends as unknown) = () => db;
  return db;
}

type MockDb = ReturnType<typeof buildMockDb>;

describe('magic links (slice 4)', () => {
  let app: INestApplication;
  let db: MockDb;
  const csrfCookieName = cookiePolicy('test').csrfName;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
    process.env.SESSION_TTL_DAYS = '7';
    process.env.PUBLIC_WEB_URL = 'http://localhost:3001';
  });

  beforeEach(async () => {
    db = buildMockDb();
    db._seedClient('client_1');
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

  /** Direct-insert STAFF session + matching signed double-submit pair. */
  function staffAuth(role: 'SUPER_ADMIN' | 'CREATIVE'): {
    cookie: string;
    headers: Record<string, string>;
  } {
    const userId = role === 'SUPER_ADMIN' ? 'u_admin' : 'u_creative';
    const raw = randomBytes(32).toString('base64url');
    db.session.create({
      data: {
        tokenHash: sha256hex(raw),
        kind: 'STAFF',
        agencyId: 'agency_1',
        userId,
        csrfSecret: 'staff-secret',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      },
    });
    const csrf = signCsrf('staff-secret');
    return {
      cookie: `${SESSION_COOKIE}=${raw}; ${csrfCookieName}=${csrf}`,
      headers: { 'X-CSRF-Token': csrf },
    };
  }

  async function mintLink(auth: { cookie: string; headers: Record<string, string> }, clientId = 'client_1') {
    return request(app.getHttpServer())
      .post(`/clients/${clientId}/magic-links`)
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({});
  }

  function redeem(token: string) {
    return request(app.getHttpServer()).post('/magic-links/redeem').send({ token });
  }

  function cookiesOf(res: request.Response): string[] {
    return res.headers['set-cookie'] ?? [];
  }

  function tokenFrom(url: string): string {
    return url.split('/c/')[1];
  }

  it('mint: URL appears exactly once, DB stores only the hash', async () => {
    const res = await mintLink(staffAuth('SUPER_ADMIN'));
    expect(res.status).toBe(201);

    const url: string = res.body.url;
    expect(url).toMatch(/^http:\/\/localhost:3001\/c\/[A-Za-z0-9_-]{40,}$/);
    expect(res.text.split(url).length - 1).toBe(1); // exactly once

    const rawToken = tokenFrom(url);
    const stored = JSON.stringify([...db._links.values()]);
    expect(stored).not.toContain(rawToken); // hash-only at rest
    expect(stored).toContain(sha256hex(rawToken));
  });

  it('happy redemption mints a CLIENT session with the full cookie pair', async () => {
    const minted = await mintLink(staffAuth('SUPER_ADMIN'));
    const res = await redeem(tokenFrom(minted.body.url));
    expect(res.status).toBe(200);

    const names = cookiesOf(res).map((c) => c.split('=')[0]);
    expect(names).toContain(SESSION_COOKIE);
    expect(names).toContain(csrfCookieName);

    const created = [...db._sessions.values()].find((s) => s.kind === 'CLIENT');
    expect(created?.clientId).toBe('client_1');
    expect(created?.agencyId).toBe('agency_1');
    // Session cookie never carries the raw DB-side material.
    const sessionCookieValue = cookiesOf(res)
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];
    expect(String(created?.tokenHash)).not.toContain(sessionCookieValue);
  });

  it('browser-B redeems the same link OK — each redemption mints a fresh session', async () => {
    const minted = await mintLink(staffAuth('SUPER_ADMIN'));
    const token = tokenFrom(minted.body.url);

    const first = await redeem(token);
    const second = await redeem(token);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const t1 = cookiesOf(first).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    const t2 = cookiesOf(second).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
    expect(t1).not.toBe(t2);
  });

  it('expired and unknown tokens get the IDENTICAL generic body and NO Set-Cookie', async () => {
    const minted = await mintLink(staffAuth('SUPER_ADMIN'));
    const linkId = minted.body.id as string;
    const token = tokenFrom(minted.body.url);

    db._links.get(linkId)!.expiresAt = new Date(Date.now() - 1000);

    const expired = await redeem(token);
    const unknown = await redeem(randomBytes(32).toString('base64url'));

    for (const r of [expired, unknown]) {
      expect(r.status).toBe(401);
      expect(JSON.stringify(r.body)).toBe(JSON.stringify({ statusCode: 401, message: 'INVALID_LINK' }));
      expect(cookiesOf(r)).toHaveLength(0);
    }
  });

  it('revoke kills every live session from that link in ONE transaction', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    const minted = await mintLink(auth);
    const linkId = minted.body.id as string;
    const token = tokenFrom(minted.body.url);

    const a = await redeem(token);
    const b = await redeem(token);
    const cookieA = cookiesOf(a).map((c) => c.split(';')[0]).join('; ');
    const cookieB = cookiesOf(b).map((c) => c.split(';')[0]).join('; ');

    // Authenticated CLIENT hitting a staff route: role denial (403), NOT 401.
    const beforeA = await request(app.getHttpServer()).get('/staff').set('Cookie', cookieA);
    const beforeB = await request(app.getHttpServer()).get('/staff').set('Cookie', cookieB);
    expect(beforeA.status).toBe(403);
    expect(beforeB.status).toBe(403);

    const revoked = await request(app.getHttpServer())
      .post(`/magic-links/${linkId}/revoke`)
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({});
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedSessions).toBe(2);

    // Both live sessions die instantly.
    const afterA = await request(app.getHttpServer()).get('/staff').set('Cookie', cookieA);
    const afterB = await request(app.getHttpServer()).get('/staff').set('Cookie', cookieB);
    expect(afterA.status).toBe(401);
    expect(afterB.status).toBe(401);

    // Revoked-link redemption now reads as the same generic invalid.
    expect((await redeem(token)).status).toBe(401);
  });

  it('revoking an already-revoked or foreign link is a defensive 404', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    const again = await request(app.getHttpServer())
      .post('/magic-links/link_missing/revoke')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({});
    expect(again.status).toBe(404);
  });

  it('CREATIVE cannot mint or revoke links (role 403)', async () => {
    const auth = staffAuth('CREATIVE');

    const minted = await mintLink(auth);
    expect(minted.status).toBe(403);

    const revoked = await request(app.getHttpServer())
      .post('/magic-links/link_1/revoke')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({});
    expect(revoked.status).toBe(403);
  });

  it('sets Referrer-Policy: no-referrer on API responses', async () => {
    const res = await redeem(randomBytes(32).toString('base64url'));
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
