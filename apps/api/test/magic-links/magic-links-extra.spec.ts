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
 * PR2 magic links flat list: GET /magic-links joined to Client for
 * clientName, with optional clientId and status (active|revoked, where
 * active = revokedAt IS NULL) filters. SUPER_ADMIN/ACCOUNT_MANAGER only;
 * CREATIVE gets 403.
 */

const TENANT_MODEL_NAMES: Record<string, string> = {
  client: 'Client',
  magicLink: 'MagicLink',
  session: 'Session',
  campaign: 'Campaign',
  creative: 'Creative',
  creativeVersion: 'CreativeVersion',
  asset: 'Asset',
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
  const links = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin User', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', displayName: 'Manager User', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', displayName: 'Creative User', isActive: true, role: 'CREATIVE', agencyId: 'agency_1' },
  };

  const db = {
    _links: links,
    _seedClient(id: string, name: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name });
      return clients.get(id)!;
    },
    _seedLink(id: string, clientId: string, agencyId = 'agency_1', overrides: Record<string, unknown> = {}) {
      links.set(id, {
        id, agencyId, clientId, recipientEmail: `client+${id}@example.com`,
        createdAt: new Date(), expiresAt: null, lastUsedAt: null, revokedAt: null, ...overrides,
      });
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
      findUnique: ({ where }: { where: { tokenHash: string } }) => {
        const found = [...sessions.values()].find((x) => x.tokenHash === where.tokenHash) ?? null;
        if (!found) return null;
        const s = { ...found };
        if (s.userId) s.user = userRows[s.userId as string] ?? null;
        return s;
      },
    },
    magicLink: {
      findMany: ({ where, orderBy, select }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown> }) => {
        const rows = [...links.values()]
          .map((r) => {
            const client = clients.get(r.clientId as string);
            return { ...r, client: client ? { name: client.name } : null };
          })
          .filter((r) => !where || matchesWhere(r, where));
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
    },
    client: {
      findFirst: () => null,
      findMany: () => [],
    },
    campaign: { findMany: () => [], findFirst: () => null, count: () => 0 },
    creative: { findMany: () => [], findFirst: () => null, count: () => 0 },
    creativeVersion: { findMany: () => [], findFirst: () => null, count: () => 0 },
    asset: { findMany: () => [], findFirst: () => null, count: () => 0 },
    user: { findUnique: () => null },
    comment: { findMany: () => [], findFirst: () => null, count: () => 0 },
    reviewEvent: { findMany: () => [], findFirst: () => null, count: () => 0 },
  } as unknown as MockDbBase;
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('magic links flat list (PR2)', () => {
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

  function listShape(body: Array<Record<string, unknown>>) {
    return body.map((l) => ({
      id: l.id,
      clientId: l.clientId,
      clientName: l.clientName,
      recipientEmail: l.recipientEmail,
      expiresAt: l.expiresAt,
      lastUsedAt: l.lastUsedAt,
      revokedAt: l.revokedAt,
    }));
  }

  it('returns every link with the client name joined and no token material', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const revokedAt = new Date('2026-01-05T00:00:00Z');
    db._seedLink('link_1', 'client_1');
    db._seedLink('link_2', 'client_2', 'agency_1', { revokedAt, expiresAt: new Date('2026-02-01T00:00:00Z') });

    const res = await request(app.getHttpServer())
      .get('/magic-links')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(listShape(res.body)).toEqual([
      { id: 'link_1', clientId: 'client_1', clientName: 'Acme Corp', recipientEmail: 'client+link_1@example.com', expiresAt: null, lastUsedAt: null, revokedAt: null },
      { id: 'link_2', clientId: 'client_2', clientName: 'Beta LLC', recipientEmail: 'client+link_2@example.com', expiresAt: '2026-02-01T00:00:00.000Z', lastUsedAt: null, revokedAt: '2026-01-05T00:00:00.000Z' },
    ]);
    // The token hash must never leak through the list response.
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
  });

  it('filters by status=active (revokedAt IS NULL)', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    db._seedLink('link_1', 'client_1');
    db._seedLink('link_2', 'client_2', 'agency_1', { revokedAt: new Date() });

    const res = await request(app.getHttpServer())
      .get('/magic-links?status=active')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(listShape(res.body)).toEqual([
      { id: 'link_1', clientId: 'client_1', clientName: 'Acme Corp', recipientEmail: 'client+link_1@example.com', expiresAt: null, lastUsedAt: null, revokedAt: null },
    ]);
  });

  it('filters by status=revoked (revokedAt NOT NULL)', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    db._seedLink('link_1', 'client_1');
    db._seedLink('link_2', 'client_2', 'agency_1', { revokedAt: new Date('2026-01-05T00:00:00Z') });

    const res = await request(app.getHttpServer())
      .get('/magic-links?status=revoked')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(listShape(res.body)).toEqual([
      { id: 'link_2', clientId: 'client_2', clientName: 'Beta LLC', recipientEmail: 'client+link_2@example.com', expiresAt: null, lastUsedAt: null, revokedAt: '2026-01-05T00:00:00.000Z' },
    ]);
  });

  it('filters by clientId', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedLink('link_1', 'client_1');
    db._seedLink('link_2', 'client_2');

    const res = await request(app.getHttpServer())
      .get('/magic-links?clientId=client_2')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(listShape(res.body)).toEqual([
      { id: 'link_2', clientId: 'client_2', clientName: 'Beta LLC', recipientEmail: 'client+link_2@example.com', expiresAt: null, lastUsedAt: null, revokedAt: null },
    ]);
  });

  it('rejects an unknown status value with 400', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .get('/magic-links?status=bogus')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(400);
  });

  it('keeps foreign-agency links invisible', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedLink('link_1', 'client_1');
    db._seedLink('link_foreign', 'client_1', 'agency_2');

    const res = await request(app.getHttpServer())
      .get('/magic-links')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(listShape(res.body)).toEqual([
      { id: 'link_1', clientId: 'client_1', clientName: 'Acme Corp', recipientEmail: 'client+link_1@example.com', expiresAt: null, lastUsedAt: null, revokedAt: null },
    ]);
  });

  it('allows super admin and account manager but denies CREATIVE with 403', async () => {
    const admin = await request(app.getHttpServer())
      .get('/magic-links')
      .set('Cookie', staffAuth('SUPER_ADMIN').cookie);
    const manager = await request(app.getHttpServer())
      .get('/magic-links')
      .set('Cookie', staffAuth('ACCOUNT_MANAGER').cookie);
    const creative = await request(app.getHttpServer())
      .get('/magic-links')
      .set('Cookie', staffAuth('CREATIVE').cookie);
    expect(admin.status).toBe(200);
    expect(manager.status).toBe(200);
    expect(creative.status).toBe(403);
  });
});