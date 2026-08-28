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

interface VersionRow extends Record<string, unknown> {
  id: string;
  agencyId: string;
  clientId: string;
  creativeId: string;
  versionNo: number;
  state: string;
  reviewStatus: string;
  createdAt: Date;
}

function matchesVersionWhere(row: VersionRow, where: Record<string, unknown>): boolean {
  const clauses = where?.AND ? (where.AND as Array<Record<string, unknown>>) : [where];
  return clauses.every((clause) => {
    if (clause.agencyId !== undefined && clause.agencyId !== row.agencyId) return false;
    if (clause.state !== undefined && clause.state !== row.state) return false;
    if (clause.reviewStatus !== undefined && clause.reviewStatus !== row.reviewStatus) return false;
    if (clause.createdAt !== undefined) {
      const cond = clause.createdAt as { lt?: Date; gte?: Date };
      if (cond.lt && row.createdAt.getTime() >= cond.lt.getTime()) return false;
      if (cond.gte && row.createdAt.getTime() < cond.gte.getTime()) return false;
    }
    return true;
  });
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
  const versions = new Map<string, VersionRow>();
  const sessions = new Map<string, Record<string, unknown>>();
  const comments = new Map<string, Record<string, unknown>>();
  const reviewEvents = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin User', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', displayName: 'Manager User', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', displayName: 'Creative User', isActive: true, role: 'CREATIVE', agencyId: 'agency_1' },
  };

  function userDelegate() {
    return {
      findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = Object.values(userRows).find((r) => {
          return Object.entries(where).every(([k, v]) => r[k] === v);
        }) ?? null;
        return row ? (select ? pick(row, select) : row) : null;
      },
      findMany: ({ where }: { where?: Record<string, unknown> }) =>
        Object.values(userRows).filter((r) => {
          const clauses = where?.AND ?? [where];
          return clauses.every((cl) => Object.entries(cl ?? {}).every(([k, v]) => r[k] === v));
        }),
    };
  }

  function pick<T extends Record<string, unknown>>(row: T, select: Record<string, unknown>): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(select)) {
      const child = (row as Record<string, unknown>)[k];
      // Prisma relation form: { select: { ... } } — unwrap it.
      const inner = v && typeof v === 'object' && 'select' in v ? (v as { select: Record<string, unknown> }).select : v;
      if (typeof inner === 'object' && inner !== null && child != null) out[k] = pick(child as Record<string, unknown>, inner);
      else if (inner === true) out[k] = child;
    }
    return out as T;
  }

  const creativeDelegate = {
    count: ({ where }: { where?: Record<string, unknown> }) => {
      const clauses = where?.AND ?? [where];
      return [...creatives.values()].filter((r) =>
        clauses.every((cl) => Object.entries(cl ?? {}).every(([k, v]) => r[k] === v)),
      ).length;
    },
    findMany: ({ where, select, distinct }: { where?: Record<string, unknown>; select?: Record<string, unknown>; distinct?: string[] }) => {
      let rows = [...creatives.values()];
      const clauses = where?.AND ? (where.AND as Array<Record<string, unknown>>) : [where ?? {}];
      rows = rows.filter((r) => clauses.every((cl) => Object.entries(cl ?? {}).every(([k, v]) => r[k] === v)));
      if (distinct && distinct.length) {
        const seen = new Set<string>();
        rows = rows.filter((r) => {
          const key = distinct.map((d) => String(r[d])).join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return rows.map((r) => (select ? pick(r, select) : r));
    },
  };

  const reviewEventDelegate = {
    count: ({ where }: { where?: Record<string, unknown> }) => {
      const clauses = where?.AND ? (where.AND as Array<Record<string, unknown>>) : [where ?? {}];
      return [...reviewEvents.values()].filter((r) =>
        clauses.every((cl) => {
          if (cl.agencyId !== undefined && cl.agencyId !== r.agencyId) return false;
          if (cl.decision !== undefined && cl.decision !== r.decision) return false;
          if (cl.clientId !== undefined && cl.clientId !== r.clientId) return false;
          if (cl.occurredAt !== undefined) {
            const cond = cl.occurredAt as { gte?: Date };
            if (cond.gte && (r.occurredAt as Date).getTime() < cond.gte.getTime()) return false;
          }
          return true;
        }),
      ).length;
    },
  };

  const commentDelegate = {
    count: ({ where }: { where?: Record<string, unknown> }) => {
      const clauses = where?.AND ? (where.AND as Array<Record<string, unknown>>) : [where ?? {}];
      return [...comments.values()].filter((r) =>
        clauses.every((cl) => Object.entries(cl ?? {}).every(([k, v]) => r[k] === v)),
      ).length;
    },
  };

  const stubDelegate = {
    findMany: () => [],
    findFirst: () => null,
    count: () => 0,
  };

  const versionDelegate = {
    findMany: ({ where, orderBy, take, select }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown>; take?: number }) => {
      let rows = [...versions.values()].filter((r) => matchesVersionWhere(r, where ?? {}));
      if (orderBy?.createdAt === 'desc') rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((v) => {
        const creative = creatives.get(v.creativeId);
        const campaign = creative ? campaigns.get(creative.campaignId as string) : undefined;
        const client = campaign ? clients.get(campaign.clientId as string) : undefined;
        const resolved = {
          id: v.id,
          versionNo: v.versionNo,
          state: v.state,
          createdAt: v.createdAt,
          creative: creative
            ? {
                title: creative.title,
                campaign: campaign ? { client: client ? { name: client.name } : null } : null,
              }
            : null,
        };
        return select ? pick(resolved as unknown as Record<string, unknown>, select) : resolved;
      });
    },
    count: ({ where }: { where?: Record<string, unknown> }) =>
      [...versions.values()].filter((r) => matchesVersionWhere(r, where ?? {})).length,
  };

  const db = {
    _creatives: creatives,
    _versions: versions,
    _seedClient(id: string, name: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name, contact: null, createdAt: new Date() });
      return clients.get(id)!;
    },
    _seedCampaign(id: string, clientId: string, agencyId = 'agency_1') {
      campaigns.set(id, { id, agencyId, clientId, name: `Campaign ${id}`, status: 'ACTIVE', createdAt: new Date() });
      return campaigns.get(id)!;
    },
    _seedCreative(id: string, campaignId: string, clientId: string, agencyId = 'agency_1') {
      creatives.set(id, {
        id, agencyId, clientId, campaignId, title: `Creative ${id}`, kind: 'IMAGE', status: 'DRAFT',
        createdById: 'u_admin', createdAt: new Date(),
      });
      return creatives.get(id)!;
    },
    _seedVersion(id: string, creativeId: string, clientId: string, data: Partial<VersionRow>, agencyId = 'agency_1') {
      versions.set(id, {
        id, agencyId, clientId, creativeId, versionNo: 1, state: 'READY', reviewStatus: 'NONE',
        createdAt: new Date(), ...data,
      });
      return versions.get(id)!;
    },
    _seedComment(id: string, versionId: string, clientId: string, resolved: boolean, agencyId = 'agency_1') {
      comments.set(id, { id, versionId, agencyId, clientId, body: 'body', resolved, createdAt: new Date() });
    },
    _seedReviewEvent(id: string, versionId: string, clientId: string, decision: string, occurredAt: Date, agencyId = 'agency_1') {
      reviewEvents.set(id, { id, versionId, agencyId, clientId, decision, occurredAt });
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
        [...clients.values()].find((r) => {
          const clauses = where?.AND ?? [where];
          return clauses.every((cl) => Object.entries(cl ?? {}).every(([k, v]) => r[k] === v));
        }) ?? null,
    },
    campaign: { findMany: () => [] },
    creative: creativeDelegate,
    creativeVersion: versionDelegate,
    reviewEvent: reviewEventDelegate,
    comment: commentDelegate,
    asset: stubDelegate,
    user: userDelegate(),
  } as unknown as MockDbBase;
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;

describe('dashboard API (PR1)', () => {
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
    db._seedCampaign('cmp_1', 'client_1');
    db._seedCreative('cr_1', 'cmp_1', 'client_1');
    db._seedCreative('cr_2', 'cmp_1', 'client_1');
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

  describe('GET /dashboard/stats', () => {
    it('computes each counter from agency data', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      const now = new Date();
      // pending: 2 ready+NONE versions
      db._seedVersion('v_p1', 'cr_1', 'client_1', { state: 'READY', reviewStatus: 'NONE' });
      db._seedVersion('v_p2', 'cr_2', 'client_1', { state: 'READY', reviewStatus: 'NONE' });
      // not pending: approved version
      db._seedVersion('v_app', 'cr_1', 'client_1', { state: 'READY', reviewStatus: 'APPROVED' });
      // approved this week: 1 (now)
      db._seedReviewEvent('re_1', 'v_app', 'client_1', 'APPROVED', now);
      // outside current week
      db._seedReviewEvent('re_old', 'v_app', 'client_1', 'APPROVED', new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000));
      // active clients: distinct clients with creatives = only client_1
      // unresolved comments: 2 unresolved, 1 resolved
      db._seedComment('cm_1', 'v_p1', 'client_1', false);
      db._seedComment('cm_2', 'v_p1', 'client_1', false);
      db._seedComment('cm_res', 'v_p1', 'client_1', true);

      const res = await request(app.getHttpServer())
        .get('/dashboard/stats')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        pendingReview: 2,
        approvedThisWeek: 1,
        activeClients: 1,
        unresolvedComments: 2,
      });
    });

    it('returns zeros for an empty agency', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._creatives.clear();
      db._versions.clear();
      const res = await request(app.getHttpServer())
        .get('/dashboard/stats')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        pendingReview: 0,
        approvedThisWeek: 0,
        activeClients: 0,
        unresolvedComments: 0,
      });
    });
  });

  describe('GET /dashboard/activity', () => {
    it('returns up to limit items plus a nextCursor when more exist', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedVersion('v1', 'cr_1', 'client_1', { versionNo: 1, state: 'READY', createdAt: new Date('2026-01-03T00:00:00Z') });
      db._seedVersion('v2', 'cr_1', 'client_1', { versionNo: 2, state: 'PROCESSING', createdAt: new Date('2026-01-02T00:00:00Z') });
      db._seedVersion('v3', 'cr_1', 'client_1', { versionNo: 3, state: 'READY', createdAt: new Date('2026-01-01T00:00:00Z') });
      const res = await request(app.getHttpServer())
        .get('/dashboard/activity?limit=2')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({ versionNumber: 1, creativeName: 'Creative cr_1', clientName: 'Acme Corp', status: 'READY' });
      expect(res.body.items[1]).toMatchObject({ versionNumber: 2, status: 'PROCESSING' });
      expect(res.body.nextCursor).toBe('2026-01-02T00:00:00.000Z');
    });

    it('paginates with cursor and returns nextCursor null on the last page', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedVersion('v1', 'cr_1', 'client_1', { versionNo: 1, state: 'READY', createdAt: new Date('2026-01-03T00:00:00Z') });
      db._seedVersion('v2', 'cr_1', 'client_1', { versionNo: 2, state: 'READY', createdAt: new Date('2026-01-02T00:00:00Z') });
      const page1 = await request(app.getHttpServer())
        .get('/dashboard/activity?limit=1')
        .set('Cookie', auth.cookie);
      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.items[0].versionNumber).toBe(1);
      const cursor = page1.body.nextCursor;
      expect(cursor).toBe('2026-01-03T00:00:00.000Z');
      const page2 = await request(app.getHttpServer())
        .get(`/dashboard/activity?limit=1&cursor=${encodeURIComponent(cursor)}`)
        .set('Cookie', auth.cookie);
      expect(page2.status).toBe(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].versionNumber).toBe(2);
      expect(page2.body.nextCursor).toBeNull();
    });

    it('caps limit at 50 and returns empty items for an empty agency', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._versions.clear();
      const res = await request(app.getHttpServer())
        .get('/dashboard/activity?limit=500')
        .set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.nextCursor).toBeNull();
    });
  });
});
