import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SESSION_COOKIE, cookiePolicy } from '../../src/auth/cookies';
import { applyOperation } from '../../src/tenancy/tenancy.rules';
import { currentPrincipal } from '../../src/tenancy/request-context.als';
import { ensureInitialAdmin } from '../../src/seed/ensure-initial-admin';

/**
 * Slice-5a suite (tasks 5a.1–5a.4 + seed bootstrap). Same harness approach as
 * the magic-link suite: mocked PrismaService whose $extends view runs the
 * REAL pure tenancy layer (applyOperation) against in-memory maps, so CRUD
 * scoping is genuinely exercised.
 */

const TENANT_MODEL_NAMES: Record<string, string> = {
  client: 'Client',
  campaign: 'Campaign',
  creative: 'Creative',
  session: 'Session',
};

function sha256hex(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

/** Same construction the real CsrfGuard validates against csrfSecret. */
function signCsrf(secret: string): string {
  const nonce = randomBytes(16).toString('base64url');
  return `${nonce}.${createHmac('sha256', secret).update(nonce).digest('base64url')}`;
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      const clauses = v as Array<Record<string, unknown>>;
      if (!clauses.every((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function buildTenantedView(raw: MockDbBase): MockDbBase {
  const view = { ...raw } as MockDbBase;
  for (const key of Object.keys(TENANT_MODEL_NAMES)) {
    const target = raw[key];
    view[key] = new Proxy(target, {
      get(t, op) {
        const orig = Reflect.get(t, op);
        if (typeof orig !== 'function') return orig;
        return async (...callArgs: unknown[]) => {
          const args = { ...((callArgs[0] as object) ?? {}) };
          const principal = currentPrincipal();
          if (!principal) throw new Error('TENANCY_VIOLATION(mock): scoped call without principal');
          applyOperation(TENANT_MODEL_NAMES[key], String(op), args as Record<string, unknown>, principal);
          return (orig as (...a: unknown[]) => unknown).call(t, args);
        };
      },
    }) as never;
  }
  view.$transaction = async (fn: (tx: MockDbBase) => Promise<unknown>) => fn(view);
  (view as unknown as Record<string, unknown>).$extends = () => view;
  return view;
}

function buildMockDb() {
  const clients = new Map<string, Record<string, unknown>>();
  const campaigns = new Map<string, Record<string, unknown>>();
  const creatives = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const links = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', isActive: true, role: 'SUPER_ADMIN' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', isActive: true, role: 'ACCOUNT_MANAGER' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', isActive: true, role: 'CREATIVE' },
  };

  function crudFor(map: Map<string, Record<string, unknown>>, prefix: string, defaults: () => Record<string, unknown>) {
    return {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `${prefix}_${map.size + 1}`, createdAt: new Date(), ...defaults(), ...data };
        map.set(row.id as string, row);
        return row;
      },
      findFirst: ({ where }: { where: Record<string, unknown> }) =>
        [...map.values()].find((r) => matchesWhere(r, where)) ?? null,
      findMany: ({ where }: { where?: Record<string, unknown> }) =>
        [...map.values()].filter((r) => !where || matchesWhere(r, where)),
      // Tenancy injection nests the original where under AND:[scope, …], so
      // writes must resolve rows through the same matcher as reads.
      update: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = [...map.values()].find((r) => matchesWhere(r, where));
        if (!row) {
          const err = new Error('record not found') as Error & { code: string };
          err.code = 'P2025';
          throw err;
        }
        Object.assign(row, data);
        return row;
      },
      delete: ({ where }: { where: Record<string, unknown> }) => {
        const row = [...map.values()].find((r) => matchesWhere(r, where));
        if (!row) {
          const err = new Error('record not found') as Error & { code: string };
          err.code = 'P2025';
          throw err;
        }
        map.delete(row.id as string);
        return row;
      },
      count: ({ where }: { where?: Record<string, unknown> }) =>
        [...map.values()].filter((r) => !where || matchesWhere(r, where)).length,
    };
  }

  const db = {
    _clients: clients,
    _campaigns: campaigns,
    _creatives: creatives,
    _sessions: sessions,
    _seedClient(id: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name: `Client ${id}`, contact: null, createdAt: new Date() });
      return clients.get(id)!;
    },
    _seedCampaign(id: string, clientId: string, agencyId = 'agency_1') {
      campaigns.set(id, { id, agencyId, clientId, name: `Campaign ${id}`, createdAt: new Date() });
      return campaigns.get(id)!;
    },
    _seedLink(id: string, clientId: string) {
      links.set(id, { id, agencyId: 'agency_1', clientId, revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) });
      return links.get(id)!;
    },
    $extends: null as unknown,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => fn(db),
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
        const found =
          [...sessions.values()].find((x) => x.tokenHash === where.tokenHash) ?? null;
        if (!found) return null;
        const s = { ...found };
        if (s.userId) s.user = userRows[s.userId as string] ?? null;
        if (s.magicLinkId) s.magicLink = { ...(links.get(s.magicLinkId as string) ?? null) };
        return s;
      },
    },
    client: crudFor(clients, 'cl', () => ({ agencyId: 'agency_1', contact: null })),
    campaign: crudFor(campaigns, 'cmp', () => ({ agencyId: 'agency_1' })),
    creative: crudFor(creatives, 'cr', () => ({ agencyId: 'agency_1', status: 'DRAFT' })),
  };
  // Mirror production: $extends yields the tenanted view; the raw instance
  // stays unscoped (SessionGuard).
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('initial admin seed', () => {
  it('creates the first SUPER_ADMIN with a hashed password', async () => {
    const created: Record<string, unknown>[] = [];
    const users = {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'u_new' };
      },
    };
    const result = await ensureInitialAdmin(users, { email: 'Boss@Agency.test', password: 'long-enough-passphrase' }, async (p) => `hashed(${p})`);
    expect(result.created).toBe(true);
    expect(created[0]).toMatchObject({
      email: 'boss@agency.test',
      role: 'SUPER_ADMIN',
      passwordHash: 'hashed(long-enough-passphrase)',
    });
  });

  it('is idempotent — an existing account is never touched', async () => {
    let createCalls = 0;
    const users = {
      findFirst: async () => ({ id: 'u_existing' }),
      create: async () => {
        createCalls++;
        return { id: 'u_nope' };
      },
    };
    const result = await ensureInitialAdmin(users, { email: 'a@b.test', password: 'long-enough-passphrase' }, async (p) => p);
    expect(result).toEqual({ created: false, userId: 'u_existing' });
    expect(createCalls).toBe(0);
  });

  it('rejects weak passwords and malformed emails', async () => {
    const users = { findFirst: async () => null, create: async () => ({ id: 'u_x' }) };
    await expect(
      ensureInitialAdmin(users, { email: 'a@b.test', password: 'short' }, async (p) => p),
    ).rejects.toThrow(/at least 10 characters/);
    await expect(
      ensureInitialAdmin(users, { email: 'not-an-email', password: 'long-enough-passphrase' }, async (p) => p),
    ).rejects.toThrow(/valid email/);
  });
});

describe('hierarchy CRUD (slice 5a)', () => {
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
    db._seedClient('client_9', 'agency_2');
    db._seedCampaign('cmp_foreign', 'client_9', 'agency_2');
    db._seedLink('link_seed', 'client_1');
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

  /** Direct-insert STAFF session + signed double-submit pair. */
  function staffAuth(role: 'SUPER_ADMIN' | 'ACCOUNT_MANAGER' | 'CREATIVE'): {
    cookie: string;
    headers: Record<string, string>;
  } {
    const userId =
      role === 'SUPER_ADMIN' ? 'u_admin' : role === 'ACCOUNT_MANAGER' ? 'u_mgr' : 'u_creative';
    const raw = randomBytes(32).toString('base64url');
    const csrf = signCsrf('staff-secret');
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
    return {
      cookie: `${SESSION_COOKIE}=${raw}; ${csrfCookieName}=${csrf}`,
      headers: { 'X-CSRF-Token': csrf },
    };
  }

  it('SUPER_ADMIN creates a client stored under their own agency', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    const res = await request(app.getHttpServer())
      .post('/clients')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ name: 'Acme Corp', contact: 'acme@example.com' });
    expect(res.status).toBe(201);
    const row = [...db._clients.values()].find((c) => c.name === 'Acme Corp');
    expect(row?.agencyId).toBe('agency_1');
  });

  it('CREATIVE is denied client management (403)', async () => {
    const auth = staffAuth('CREATIVE');
    const res = await request(app.getHttpServer())
      .post('/clients')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('client list is agency-scoped', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .get('/clients')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    const names: string[] = res.body.map((c: { name: string }) => c.name);
    expect(names).toContain('Client client_1');
    expect(names).not.toContain('Client client_9'); // agency_2
  });

  it('ACCOUNT_MANAGER creates and lists campaigns under a client', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/clients/client_1/campaigns')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ name: 'Spring Launch' });
    expect(res.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get('/clients/client_1/campaigns')
      .set('Cookie', auth.cookie);
    expect(list.status).toBe(200);
    const names: string[] = list.body.map((c: { name: string }) => c.name);
    expect(names).toContain('Spring Launch');
  });

  it('campaign creation under another agency’s client is a clean 404', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/clients/client_9/campaigns')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ name: 'Contraband' });
    expect(res.status).toBe(404);
    const names = [...db._campaigns.values()].map((c) => c.name);
    expect(names).not.toContain('Contraband');
  });

  it('deleting a campaign that still has creatives is blocked with 409', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    db._seedCampaign('cmp_full', 'client_1');
    db.creative.create({
      data: {
        id: 'cr_1',
        agencyId: 'agency_1',
        clientId: 'client_1',
        campaignId: 'cmp_full',
        title: 'Banner v1',
        kind: 'IMAGE',
        status: 'DRAFT',
        createdById: 'u_admin',
      },
    });

    const res = await request(app.getHttpServer())
      .delete('/campaigns/cmp_full')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('CAMPAIGN_NOT_EMPTY');
    expect(db._campaigns.has('cmp_full')).toBe(true); // nothing deleted
    expect(db._creatives.has('cr_1')).toBe(true);
  });

  it('deleting an empty campaign succeeds', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedCampaign('cmp_empty', 'client_1');
    const res = await request(app.getHttpServer())
      .delete('/campaigns/cmp_empty')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(200);
    expect(db._campaigns.has('cmp_empty')).toBe(false);
  });

  it('creative starts DRAFT and its kind is immutable', async () => {
    const auth = staffAuth('CREATIVE');
    db._seedCampaign('cmp_k', 'client_1');

    const res = await request(app.getHttpServer())
      .post('/campaigns/cmp_k/creatives')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ title: 'Hero Banner', kind: 'IMAGE' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.kind).toBe('IMAGE');

    const patched = await request(app.getHttpServer())
      .patch(`/creatives/${res.body.id}`)
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ title: 'Hero Banner (renamed)', kind: 'VIDEO' }); // kind ignored
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe('Hero Banner (renamed)');
    expect(patched.body.kind).toBe('IMAGE');
  });

  it('cross-agency campaign patch is a clean 404 and mutates nothing', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    const before = JSON.stringify(db._campaigns.get('cmp_foreign'));
    const res = await request(app.getHttpServer())
      .patch('/campaigns/cmp_foreign')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    expect(JSON.stringify(db._campaigns.get('cmp_foreign'))).toBe(before);
  });

  it('CLIENT sessions are denied staff surfaces entirely', async () => {
    // Seed a magic link + CLIENT session directly (guard path).
    const raw = randomBytes(32).toString('base64url');
    db.session.create({
      data: {
        tokenHash: sha256hex(raw),
        kind: 'CLIENT',
        agencyId: 'agency_1',
        userId: null,
        clientId: 'client_1',
        magicLinkId: 'link_seed',
        csrfSecret: 'client-secret',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      },
    });
    const res = await request(app.getHttpServer())
      .get('/clients')
      .set('Cookie', `${SESSION_COOKIE}=${raw}`);
    expect(res.status).toBe(403);
  });
});
