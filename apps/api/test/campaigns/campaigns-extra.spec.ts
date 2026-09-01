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
 * PR2 campaign endpoints: GET /campaigns (flat list with clientName +
 * creativesCount), GET /campaigns/:id (detail with creatives and
 * currentVersionNo = max versionNo), PATCH /campaigns/:id (name/status,
 * response shaped as CampaignListItem).
 *
 * Mock strategy mirrors the other suites: the $extends view routes every
 * delegate call through the REAL applyOperation tenancy layer keyed on the
 * request principal, so cross-agency invisibility is exercised for real.
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

/** Single-clause matcher: equality, `in`, contains (+ insensitive), not:null. */
function matchesCondition(row: Record<string, unknown>, key: string, cond: unknown): boolean {
  const cell = row[key];
  if (cell === cond) return true;
  if (typeof cond !== 'object' || cond === null) return false;
  const v = cond as Record<string, unknown>;
  if ('in' in v) return Array.isArray(v.in) && (v.in as unknown[]).includes(cell);
  if ('contains' in v) {
    if (typeof cell !== 'string') return false;
    return v.mode === 'insensitive'
      ? cell.toLowerCase().includes(String(v.contains).toLowerCase())
      : cell.includes(String(v.contains));
  }
  if ('not' in v && v.not === null) return cell !== null;
  if (typeof cell === 'object' && cell !== null) {
    return matchesWhere(cell as Record<string, unknown>, v);
  }
  return false;
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
    if (!matchesCondition(row, k, v)) return false;
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
      else if ('select' in v) out[k] = null;
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
  const versions = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin User', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', displayName: 'Manager User', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', displayName: 'Creative User', isActive: true, role: 'CREATIVE', agencyId: 'agency_1' },
  };

  /** Campaign row enriched with its resolved client relation for filters/selects. */
  function withClient(row: Record<string, unknown>): Record<string, unknown> {
    const client = clients.get(row.clientId as string);
    return { ...row, client: client ? { name: client.name } : null };
  }

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
        // Prisma relation form: { select: { ... } } — unwrap it.
        const inner = 'select' in v ? (v as { select: Record<string, unknown> }).select : v;
        if (nested != null) out[k] = filterSelect(nested as Record<string, unknown>, inner);
        else out[k] = null;
      } else if (v === true) {
        out[k] = row[k];
      }
    }
    return out;
  }

  const campaignDelegate = {
    findFirst: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const rows = [...campaigns.values()].map(withClient);
      const row = rows.find((r) => matchesWhere(r, where)) ?? null;
      return row ? applyCampaignSelect(row, select) : null;
    },
    findMany: ({ where, orderBy, select }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown> }) => {
      const rows = [...campaigns.values()].map(withClient).filter((r) => !where || matchesWhere(r, where));
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
    update: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = [...campaigns.values()].find((r) => matchesWhere(r, where));
      if (!row) {
        const err = new Error('record not found') as Error & { code: string };
        err.code = 'P2025';
        throw err;
      }
      Object.assign(row, data);
      return row;
    },
    updateMany: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of [...campaigns.values()]) {
        if (!matchesWhere(row, where)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    },
    count: ({ where }: { where?: Record<string, unknown> }) =>
      [...campaigns.values()].filter((r) => !where || matchesWhere(r, where)).length,
  };

  const creativeDelegate = {
    findMany: ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> }) =>
      [...creatives.values()]
        .filter((r) => !where || matchesWhere(r, where))
        .map((r) => filterSelect(r, select)),
    count: ({ where }: { where?: Record<string, unknown> }) =>
      [...creatives.values()].filter((r) => !where || matchesWhere(r, where)).length,
  };

  const versionDelegate = {
    findMany: ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> }) =>
      [...versions.values()]
        .filter((r) => !where || matchesWhere(r, where))
        .map((r) => filterSelect(r, select)),
  };

  const stubDelegate = {
    findMany: () => [],
    findFirst: () => null,
    count: () => 0,
  };

  const db = {
    _campaigns: campaigns,
    _creatives: creatives,
    _seedClient(id: string, name: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name, contact: null, createdAt: new Date() });
      return clients.get(id)!;
    },
    _seedCampaign(id: string, clientId: string, agencyId = 'agency_1', name?: string, status = 'ACTIVE') {
      campaigns.set(id, { id, agencyId, clientId, name: name ?? `Campaign ${id}`, status, createdAt: new Date() });
      return campaigns.get(id)!;
    },
    _seedCreative(id: string, campaignId: string, clientId: string, agencyId = 'agency_1', overrides: Record<string, unknown> = {}) {
      creatives.set(id, {
        id, agencyId, clientId, campaignId, title: `Creative ${id}`, kind: 'IMAGE', status: 'DRAFT',
        createdAt: new Date(), updatedAt: new Date(), ...overrides,
      });
      return creatives.get(id)!;
    },
    _seedVersion(id: string, creativeId: string, campaignId: string, clientId: string, versionNo: number, agencyId = 'agency_1') {
      versions.set(id, { id, creativeId, campaignId, clientId, agencyId, versionNo });
      return versions.get(id)!;
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
      findFirst: ({ where }: { where: Record<string, unknown> }) =>
        [...clients.values()].find((r) => matchesWhere(r, where)) ?? null,
    },
    campaign: campaignDelegate,
    creative: creativeDelegate,
    creativeVersion: versionDelegate,
    user: { findUnique: () => null },
    asset: stubDelegate,
    comment: stubDelegate,
    reviewEvent: stubDelegate,
  } as unknown as MockDbBase;
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('campaigns flat list / detail / PATCH (PR2)', () => {
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
    db._seedClient('client_2', 'Beta LLC');
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

  function listShape(body: Array<Record<string, unknown>>) {
    return body.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      clientName: c.clientName,
      name: c.name,
      status: c.status,
      creativesCount: c.creativesCount,
    }));
  }

  describe('GET /campaigns', () => {
    it('returns every campaign with clientName and creativesCount joins', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1');
      db._seedCampaign('cmp_2', 'client_2');
      db._seedCreative('cr_1', 'cmp_1', 'client_1');
      db._seedCreative('cr_2', 'cmp_1', 'client_1');
      db._seedCreative('cr_3', 'cmp_2', 'client_2');

      const res = await request(app.getHttpServer())
        .get('/campaigns')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(listShape(res.body)).toEqual([
        { id: 'cmp_1', clientId: 'client_1', clientName: 'Acme Corp', name: 'Campaign cmp_1', status: 'ACTIVE', creativesCount: 2 },
        { id: 'cmp_2', clientId: 'client_2', clientName: 'Beta LLC', name: 'Campaign cmp_2', status: 'ACTIVE', creativesCount: 1 },
      ]);
    });

    it('filters by status enumeration value', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1');
      db._seedCampaign('cmp_2', 'client_2', 'agency_1', 'Campaign cmp_2', 'ARCHIVED');
      db._seedCampaign('cmp_3', 'client_1', 'agency_1', 'Campaign cmp_3', 'PAUSED');

      const res = await request(app.getHttpServer())
        .get('/campaigns?status=ARCHIVED')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(listShape(res.body)).toEqual([
        { id: 'cmp_2', clientId: 'client_2', clientName: 'Beta LLC', name: 'Campaign cmp_2', status: 'ARCHIVED', creativesCount: 0 },
      ]);
    });

    it('rejects an unknown status with 400', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      const res = await request(app.getHttpServer())
        .get('/campaigns?status=BOGUS')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(400);
    });

    it('matches search against the campaign name case-insensitively', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1', 'agency_1', 'Summer Launch');
      db._seedCampaign('cmp_2', 'client_2', 'agency_1', 'Winter Skincare');

      const res = await request(app.getHttpServer())
        .get('/campaigns?search=launch')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(listShape(res.body)).toEqual([
        { id: 'cmp_1', clientId: 'client_1', clientName: 'Acme Corp', name: 'Summer Launch', status: 'ACTIVE', creativesCount: 0 },
      ]);
    });

    it('matches search against the client name case-insensitively', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1', 'agency_1', 'Summer Launch');
      db._seedCampaign('cmp_2', 'client_2', 'agency_1', 'Winter Skincare');

      const res = await request(app.getHttpServer())
        .get('/campaigns?search=bETA')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(listShape(res.body)).toEqual([
        { id: 'cmp_2', clientId: 'client_2', clientName: 'Beta LLC', name: 'Winter Skincare', status: 'ACTIVE', creativesCount: 0 },
      ]);
    });

    it('keeps foreign-agency campaigns invisible', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1');
      db._seedCampaign('cmp_foreign', 'client_1', 'agency_2');

      const res = await request(app.getHttpServer())
        .get('/campaigns')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(listShape(res.body)).toEqual([
        { id: 'cmp_1', clientId: 'client_1', clientName: 'Acme Corp', name: 'Campaign cmp_1', status: 'ACTIVE', creativesCount: 0 },
      ]);
    });
  });

  describe('GET /campaigns/:id', () => {
    it('returns the campaign with creatives and currentVersionNo = max versionNo', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1');
      db._seedCreative('cr_1', 'cmp_1', 'client_1', 'agency_1', { title: 'Hero Banner', kind: 'IMAGE', status: 'APPROVED', updatedAt: new Date('2026-01-03T00:00:00Z') });
      db._seedCreative('cr_2', 'cmp_1', 'client_1', 'agency_1', { title: 'Social Cut', kind: 'VIDEO', status: 'IN_REVIEW', updatedAt: new Date('2026-01-04T00:00:00Z') });
      db._seedVersion('v1', 'cr_1', 'cmp_1', 'client_1', 1);
      db._seedVersion('v2', 'cr_1', 'cmp_1', 'client_1', 2);
      db._seedVersion('v3', 'cr_1', 'cmp_1', 'client_1', 3);
      // cr_2 has NO versions -> currentVersionNo 0

      const res = await request(app.getHttpServer())
        .get('/campaigns/cmp_1')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'cmp_1',
        clientId: 'client_1',
        clientName: 'Acme Corp',
        name: 'Campaign cmp_1',
        status: 'ACTIVE',
        creativesCount: 2,
      });
      expect(res.body.creatives).toHaveLength(2);
      expect(res.body.creatives[0]).toEqual({
        id: 'cr_1',
        title: 'Hero Banner',
        kind: 'IMAGE',
        status: 'APPROVED',
        currentVersionNo: 3,
        updatedAt: '2026-01-03T00:00:00.000Z',
      });
      expect(res.body.creatives[1]).toMatchObject({ id: 'cr_2', title: 'Social Cut', kind: 'VIDEO', currentVersionNo: 0 });
    });

    it('returns an empty creatives array when the campaign has no creatives', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1');

      const res = await request(app.getHttpServer())
        .get('/campaigns/cmp_1')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body.creatives).toEqual([]);
      expect(res.body.creativesCount).toBe(0);
    });

    it('returns 404 for a foreign-agency campaign id', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_foreign', 'client_1', 'agency_2');

      const res = await request(app.getHttpServer())
        .get('/campaigns/cmp_foreign')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /campaigns/:id (PR2 response shape)', () => {
    it('updates the name and returns a full CampaignListItem with clientName + creativesCount', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1');
      db._seedCreative('cr_1', 'cmp_1', 'client_1');

      const res = await request(app.getHttpServer())
        .patch('/campaigns/cmp_1')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ name: 'Renamed Campaign' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'cmp_1',
        clientId: 'client_1',
        clientName: 'Acme Corp',
        name: 'Renamed Campaign',
        status: 'ACTIVE',
        creativesCount: 1,
      });
      expect(db._campaigns.get('cmp_1')?.name).toBe('Renamed Campaign');
    });

    it('updates name and status together', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedCampaign('cmp_1', 'client_1');

      const res = await request(app.getHttpServer())
        .patch('/campaigns/cmp_1')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ name: 'Winter Skincare', status: 'PAUSED' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'cmp_1', name: 'Winter Skincare', status: 'PAUSED', clientName: 'Acme Corp', creativesCount: 0 });
    });
  });
});