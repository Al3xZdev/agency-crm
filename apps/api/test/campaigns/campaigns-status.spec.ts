import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PgBossService } from '../../src/jobs/pg-boss.service';
import { VERSION_QUEUE } from '../../src/jobs/jobs.module';
import { SESSION_COOKIE, cookiePolicy } from '../../src/auth/cookies';
import { applyOperation } from '../../src/tenancy/tenancy.rules';
import { currentPrincipal } from '../../src/tenancy/request-context.als';

const TENANT_MODEL_NAMES: Record<string, string> = {
  client: 'Client',
  campaign: 'Campaign',
  creative: 'Creative',
  creativeVersion: 'CreativeVersion',
  asset: 'Asset',
  session: 'Session',
  user: 'User',
  comment: 'Comment',
  reviewEvent: 'ReviewEvent',
};

function sha256hex(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

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

function filterSelect<T extends Record<string, unknown>>(row: T, select?: Record<string, unknown>): T {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (k === '_count') {
      const countConfig = v as { select?: Record<string, unknown> };
      const fields = countConfig?.select ?? v;
      const countResult: Record<string, unknown> = {};
      for (const fk of Object.keys(fields)) countResult[fk] = 0;
      out[k] = countResult;
      continue;
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const nested = (row as Record<string, unknown>)[k];
      if (nested != null) out[k] = filterSelect(nested as Record<string, unknown>, v as Record<string, unknown>);
      else if ('take' in v || 'skip' in v) out[k] = [];
      else out[k] = null;
    } else if (v === true) {
      out[k] = (row as Record<string, unknown>)[k];
    }
  }
  return out as T;
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
  const sessions = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin User', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', displayName: 'Manager User', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', displayName: 'Creative User', isActive: true, role: 'CREATIVE', agencyId: 'agency_1' },
  };

  function crudFor(map: Map<string, Record<string, unknown>>, prefix: string, defaults: () => Record<string, unknown>) {
    return {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `${prefix}_${map.size + 1}`, createdAt: new Date(), ...defaults(), ...data };
        map.set(row.id as string, row);
        return row;
      },
      findFirst: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = [...map.values()].find((r) => matchesWhere(r, where)) ?? null;
        return row ? filterSelect(row, select) : null;
      },
      findMany: ({ where, orderBy, select }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown> }) => {
        const rows = [...map.values()].filter((r) => !where || matchesWhere(r, where));
        if (orderBy) {
          const key = Object.keys(orderBy)[0];
          const dir = orderBy[key];
          rows.sort((a, b) => {
            const av = a[key] as number, bv = b[key] as number;
            return dir === 'desc' ? bv - av : av - bv;
          });
        }
        return rows.map((r) => filterSelect(r, select));
      },
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
      count: ({ where }: { where?: Record<string, unknown> }) =>
        [...map.values()].filter((r) => !where || matchesWhere(r, where)).length,
    };
  }

  const userDelegate = {
    findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = Object.values(userRows).find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
    },
  };

  // Stub delegates for the other tenanted models (unused by these tests but
  // required for the tenanted-view proxy to be constructible).
  const stubDelegate = {
    findMany: () => [],
    findFirst: () => null,
    count: () => 0,
  };

  const db = {
    _campaigns: campaigns,
    _seedClient(id: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name: `Client ${id}`, contact: null, createdAt: new Date() });
      return clients.get(id)!;
    },
    _seedCampaign(id: string, clientId: string, agencyId = 'agency_1', status = 'ACTIVE') {
      campaigns.set(id, { id, agencyId, clientId, name: `Campaign ${id}`, status, createdAt: new Date() });
      return campaigns.get(id)!;
    },
    $extends: null as unknown,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => fn(db),
    session: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const s = { id: `s_${sessions.size + 1}`, revokedAt: null, ...data };
        sessions.set(s.id as string, s);
        return s;
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) => {
        const found = [...sessions.values()].find((x) => x.tokenHash === where.tokenHash) ?? null;
        if (!found) return null;
        const s = { ...found };
        if (s.userId) s.user = userRows[s.userId as string] ?? null;
        return s;
      },
    },
    client: crudFor(clients, 'cl', () => ({ agencyId: 'agency_1', contact: null })),
    campaign: crudFor(campaigns, 'cmp', () => ({ agencyId: 'agency_1', status: 'ACTIVE' })),
    user: userDelegate,
    creative: stubDelegate,
    creativeVersion: stubDelegate,
    asset: stubDelegate,
    comment: stubDelegate,
    reviewEvent: stubDelegate,
  } as unknown as MockDbBase;
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;

describe('campaign status (PR1)', () => {
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
    db._seedCampaign('cmp_1', 'client_1');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(PgBossService)
      .useValue({ boss: { stop: async () => {} } })
      .overrideProvider(VERSION_QUEUE)
      .useValue({ enqueueProcessVersion: async () => {} })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  function staffAuth(role: 'SUPER_ADMIN' | 'ACCOUNT_MANAGER' | 'CREATIVE'): {
    cookie: string;
    headers: Record<string, string>;
  } {
    const userId = role === 'SUPER_ADMIN' ? 'u_admin' : role === 'ACCOUNT_MANAGER' ? 'u_mgr' : 'u_creative';
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

  it('migration SQL adds status column with ACTIVE default and backfills', () => {
    const sql = readFileSync(
      join(process.cwd(), 'prisma', 'migrations', '20260827000000_add_campaign_status', 'migration.sql'),
      'utf8',
    );
    expect(sql).toMatch(/ALTER TABLE "Campaign"/);
    expect(sql).toMatch(/ADD COLUMN "status"/);
    expect(sql).toMatch(/'ACTIVE'/);
  });

  it('schema declares CampaignStatus enum and a status field defaulting to ACTIVE', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/enum CampaignStatus\s*\{[\s\S]*ACTIVE[\s\S]*PAUSED[\s\S]*ARCHIVED\s*\}/);
    expect(schema).toMatch(/status\s+CampaignStatus\s+@default\(ACTIVE\)/);
  });

  it('PATCH /campaigns/:id with { status: PAUSED } returns 200 with PAUSED', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .patch('/campaigns/cmp_1')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ status: 'PAUSED' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'cmp_1', name: 'Campaign cmp_1', status: 'PAUSED' });
    expect(db._campaigns.get('cmp_1')?.status).toBe('PAUSED');
  });

  it('PATCH /campaigns/:id with invalid status returns 400', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .patch('/campaigns/cmp_1')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ status: 'BOGUS' });
    expect(res.status).toBe(400);
  });

  it('PATCH /campaigns/:id with empty body returns 400', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .patch('/campaigns/cmp_1')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({});
    expect(res.status).toBe(400);
  });

  it('list by client exposes status on each campaign', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedCampaign('cmp_2', 'client_1', 'agency_1', 'ARCHIVED');
    const res = await request(app.getHttpServer())
      .get('/clients/client_1/campaigns')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cmp_1', status: 'ACTIVE' }),
        expect.objectContaining({ id: 'cmp_2', status: 'ARCHIVED' }),
      ]),
    );
  });

  it('a newly created campaign is stored as ACTIVE by default', async () => {
    const auth = staffAuth('CREATIVE');
    const res = await request(app.getHttpServer())
      .post('/clients/client_1/campaigns')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ name: 'Fresh' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(db._campaigns.get(res.body.id)?.status).toBe('ACTIVE');
  });
});
