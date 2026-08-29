import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PgBossService } from '../../src/jobs/pg-boss.service';
import { VERSION_QUEUE } from '../../src/jobs/jobs.module';
import { SESSION_COOKIE, cookiePolicy } from '../../src/auth/cookies';
import { applyOperation } from '../../src/tenancy/tenancy.rules';
import { currentPrincipal } from '../../src/tenancy/request-context.als';

/**
 * PR2 client detail: GET /clients/:id returns the client plus its campaigns
 * (each with creativesCount), activeCampaigns and totalCreatives aggregates.
 * Cross-agency and unknown ids collapse to 404 through the real tenancy layer.
 */

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
    if (k === 'OR') {
      const clauses = v as Array<Record<string, unknown>>;
      if (!clauses.some((sub) => matchesWhere(row, sub))) return false;
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
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const nested = (row as Record<string, unknown>)[k];
      const inner = 'select' in v ? (v as { select: Record<string, unknown> }).select : v;
      if (nested != null) out[k] = filterSelect(nested as Record<string, unknown>, inner);
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
  const creatives = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin User', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', displayName: 'Manager User', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', displayName: 'Creative User', isActive: true, role: 'CREATIVE', agencyId: 'agency_1' },
  };

  function creativeCountFor(campaignId: string): number {
    return [...creatives.values()].filter((c) => c.campaignId === campaignId).length;
  }

  function applyCampaignSelect(row: Record<string, unknown>, select?: Record<string, unknown>): Record<string, unknown> {
    if (!select) return row;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(select)) {
      if (k === '_count') {
        const countConfig = (v as { select?: Record<string, unknown> }).select ?? v;
        const counts: Record<string, unknown> = {};
        for (const fk of Object.keys(countConfig)) {
          counts[fk] = fk === 'creatives' ? creativeCountFor(row.id as string) : 0;
        }
        out[k] = counts;
        continue;
      }
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const nested = row[k];
        const inner = 'select' in v ? (v as { select: Record<string, unknown> }).select : v;
        if (nested != null) out[k] = filterSelect(nested as Record<string, unknown>, inner);
        else out[k] = null;
      } else if (v === true) {
        out[k] = row[k];
      }
    }
    return out;
  }

  const db = {
    _clients: clients,
    _campaigns: campaigns,
    _seedClient(id: string, name: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name, email: null, contact: null, createdAt: new Date() });
      return clients.get(id)!;
    },
    _seedCampaign(id: string, clientId: string, agencyId = 'agency_1', name?: string, status = 'ACTIVE') {
      campaigns.set(id, { id, agencyId, clientId, name: name ?? `Campaign ${id}`, status, createdAt: new Date() });
      return campaigns.get(id)!;
    },
    _seedCreative(id: string, campaignId: string, clientId: string, agencyId = 'agency_1') {
      creatives.set(id, { id, agencyId, clientId, campaignId, title: `Creative ${id}`, kind: 'IMAGE', status: 'DRAFT', createdAt: new Date(), updatedAt: new Date() });
      return creatives.get(id)!;
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
    client: {
      findFirst: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = [...clients.values()].find((r) => matchesWhere(r, where)) ?? null;
        return row ? filterSelect(row, select) : null;
      },
    },
    campaign: {
      findMany: ({ where, orderBy, select }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown> }) => {
        const rows = [...campaigns.values()].filter((r) => !where || matchesWhere(r, where));
        if (orderBy) {
          const key = Object.keys(orderBy)[0];
          const dir = orderBy[key];
          rows.sort((a, b) => {
            const av = a[key] as number, bv = b[key] as number;
            return dir === 'desc' ? bv - av : av - bv;
          });
        }
        return rows.map((r) => applyCampaignSelect(r, select));
      },
    },
    creative: {
      findMany: () => [],
      count: () => 0,
    },
    creativeVersion: { findMany: () => [] },
    user: { findUnique: () => null },
    asset: { findMany: () => [], findFirst: () => null, count: () => 0 },
    comment: { findMany: () => [], findFirst: () => null, count: () => 0 },
    reviewEvent: { findMany: () => [], findFirst: () => null, count: () => 0 },
  } as unknown as MockDbBase;
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('client detail with counts (PR2)', () => {
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
    db._seedClient('client_1', 'Acme Corp');
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

  it('returns the client with campaigns, activeCampaigns and totalCreatives', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedCampaign('cmp_1', 'client_1', 'agency_1', 'Summer Launch', 'ACTIVE');
    db._seedCampaign('cmp_2', 'client_1', 'agency_1', 'Winter Skincare', 'PAUSED');
    db._seedCreative('cr_1', 'cmp_1', 'client_1');
    db._seedCreative('cr_2', 'cmp_1', 'client_1');
    db._seedCreative('cr_3', 'cmp_2', 'client_1');

    const res = await request(app.getHttpServer())
      .get('/clients/client_1')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'client_1',
      name: 'Acme Corp',
      email: null,
      contact: null,
      activeCampaigns: 1,
      totalCreatives: 3,
    });
    expect(res.body.campaigns).toEqual([
      { id: 'cmp_1', name: 'Summer Launch', status: 'ACTIVE', creativesCount: 2 },
      { id: 'cmp_2', name: 'Winter Skincare', status: 'PAUSED', creativesCount: 1 },
    ]);
    expect(new Date(res.body.createdAt).getTime()).not.toBeNaN();
  });

  it('returns zeroed aggregates for a client without campaigns', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    const res = await request(app.getHttpServer())
      .get('/clients/client_1')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'client_1', name: 'Acme Corp', campaigns: [], activeCampaigns: 0, totalCreatives: 0 });
  });

  it('returns 404 for an unknown client id', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .get('/clients/client_missing')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a foreign-agency client id', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedClient('client_foreign', 'Foreign', 'agency_2');

    const res = await request(app.getHttpServer())
      .get('/clients/client_foreign')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(404);
  });
});