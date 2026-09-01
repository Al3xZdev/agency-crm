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
 * Campaign + creative cascade deletion.
 *
 * Mock strategy mirrors the other suites: the $extends view routes every
 * delegate call through the REAL applyOperation tenancy layer keyed on the
 * request principal. This spec needs a richer in-memory collection than the
 * shallow PR2 mock because `remove` now cascade-deletes creatives, versions,
 * comments, review events and assets in dependency order.
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

/** Single-clause matcher: equality, `in`, decrement-safe opaque where. */
function matchesCondition(row: Record<string, unknown>, key: string, cond: unknown): boolean {
  const cell = row[key];
  if (cell === cond) return true;
  if (typeof cond !== 'object' || cond === null) return false;
  const v = cond as Record<string, unknown>;
  if ('in' in v) return Array.isArray(v.in) && (v.in as unknown[]).includes(cell);
  if ('not' in v && v.not === null) return cell !== null;
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
      if (nested != null) out[k] = filterSelect(nested as Record<string, unknown>, v as Record<string, unknown>);
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
          const out = (orig as (...a: unknown[]) => unknown).call(t, args);
          return out instanceof Promise ? await out : out;
        };
      },
    }) as never;
  }
  view.$transaction = async (fn: (tx: MockDbBase) => Promise<unknown>) => fn(view);
  view.$executeRawUnsafe = async () => ({ count: 0 });
  (view as unknown as Record<string, unknown>).$extends = () => view;
  return view;
}

/** Translate a `{ version: { creativeId } }` relation clause into a flat
 * `versionId IN (...)` by joining against the versions collection. Walks AND
 * branches (the tenancy layer wraps where in { AND: [scope, ...] }). */
function resolveVersionRelation(
  where: Record<string, unknown>,
  versions: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      out[k] = (v as Array<Record<string, unknown>>).map((clause) => resolveVersionRelation(clause, versions));
      continue;
    }
    if (k === 'version' && typeof v === 'object' && v !== null) {
      const matchedIds = [...versions.values()]
        .filter((row) => matchesWhere(row, v as Record<string, unknown>))
        .map((row) => row.id as string);
      out.versionId = { in: matchedIds };
      continue;
    }
    out[k] = v;
  }
  return out;
}

function buildMockDb() {
  const clients = new Map<string, Record<string, unknown>>();
  const campaigns = new Map<string, Record<string, unknown>>();
  const creatives = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, Record<string, unknown>>();
  const assets = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const comments = new Map<string, Record<string, unknown>>();
  const reviewEvents = new Map<string, Record<string, unknown>>();
  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin User', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', displayName: 'Manager User', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', displayName: 'Creative User', isActive: true, role: 'CREATIVE', agencyId: 'agency_1' },
  };

  /** Read/write delegate over a named column map. Supports the operations the
   * cascade deletion uses (findMany/findFirst/deleteMany/updateMany/count)
   * plus create/update for seeding. */
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
        if (!row) { const err = new Error('record not found') as Error & { code: string }; err.code = 'P2025'; throw err; }
        Object.assign(row, data);
        return row;
      },
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of [...map.values()]) {
          if (!matchesWhere(row, where)) continue;
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'decrement' in v) {
              row[k] = (row[k] as number) - (v as { decrement: number }).decrement;
            } else {
              row[k] = v;
            }
          }
          count++;
        }
        return { count };
      },
      deleteMany: ({ where }: { where: Record<string, unknown> }) => {
        const targets = [...map.keys()].filter((id) => matchesWhere(map.get(id)!, where));
        for (const id of targets) map.delete(id);
        return { count: targets.length };
      },
      count: ({ where }: { where?: Record<string, unknown> }) =>
        [...map.values()].filter((r) => !where || matchesWhere(r, where)).length,
    };
  }

  /** Delegate for append-only tables: resolves `version.creativeId` relation
   * filters before performing deletes (the creative-delete path uses them). */
  function auditDelegate(
    map: Map<string, Record<string, unknown>>,
    prefix: string,
    versions: Map<string, Record<string, unknown>>,
  ) {
    const base = crudFor(map, prefix, () => ({ agencyId: 'agency_1' }));
    return {
      ...base,
      deleteMany: ({ where }: { where: Record<string, unknown> }) => {
        const resolvedWhere = resolveVersionRelation(where, versions);
        const targets = [...map.keys()].filter((id) => matchesWhere(map.get(id)!, resolvedWhere));
        for (const id of targets) map.delete(id);
        return { count: targets.length };
      },
    };
  }

  const db = {
    _campaigns: campaigns,
    _creatives: creatives,
    _versions: versions,
    _assets: assets,
    _comments: comments,
    _reviewEvents: reviewEvents,
    _seedClient(id: string, name: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name, contact: null, createdAt: new Date() });
      return clients.get(id)!;
    },
    _seedCampaign(id: string, clientId: string, agencyId = 'agency_1', name?: string, status = 'ACTIVE') {
      campaigns.set(id, { id, agencyId, clientId, name: name ?? `Campaign ${id}`, status, createdAt: new Date() });
      return campaigns.get(id)!;
    },
    _seedCreative(id: string, campaignId: string, clientId: string, agencyId = 'agency_1') {
      creatives.set(id, {
        id, agencyId, clientId, campaignId, title: `Creative ${id}`, kind: 'IMAGE', status: 'DRAFT',
        createdAt: new Date(), updatedAt: new Date(),
      });
      return creatives.get(id)!;
    },
    _seedVersion(id: string, creativeId: string, campaignId: string, clientId: string, versionNo: number, agencyId = 'agency_1', data: Record<string, unknown> = {}) {
      versions.set(id, {
        id, agencyId, clientId, creativeId, campaignId, versionNo, state: 'READY',
        assetId: null, posterAssetId: null, textBody: null, ...data,
      });
      return versions.get(id)!;
    },
    _seedAsset(id: string, sha: string, refCount: number, agencyId = 'agency_1') {
      assets.set(id, { id, agencyId, sha256: sha, mime: 'image/png', byteSize: 1n, storageKey: `assets/${sha}`, refCount, createdAt: new Date() });
      return assets.get(id)!;
    },
    _seedComment(id: string, versionId: string, clientId: string, agencyId = 'agency_1') {
      comments.set(id, { id, agencyId, clientId, versionId, authorType: 'STAFF', authorLabel: 'Admin', anchor: 'PLAIN', body: 'note', createdAt: new Date() });
      return comments.get(id)!;
    },
    _seedReviewEvent(id: string, versionId: string, clientId: string, agencyId = 'agency_1') {
      reviewEvents.set(id, { id, agencyId, clientId, versionId, decision: 'APPROVED', actorType: 'STAFF', actorLabel: 'Admin', occurredAt: new Date() });
      return reviewEvents.get(id)!;
    },
    $extends: null as unknown,
    $executeRawUnsafe: async () => ({ count: 0 }),
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
    campaign: crudFor(campaigns, 'cmp', () => ({ agencyId: 'agency_1' })),
    creative: crudFor(creatives, 'cr', () => ({ agencyId: 'agency_1', status: 'DRAFT' })),
    creativeVersion: crudFor(versions, 'cv', () => ({ agencyId: 'agency_1' })),
    asset: crudFor(assets, 'as', () => ({ agencyId: 'agency_1' })),
    // Comments and review events filter by their version relation in the
    // creative-delete path, so resolve `version: { creativeId }` to a flat
    // versionId IN when deleting.
    comment: auditDelegate(comments, 'cm', versions),
    reviewEvent: auditDelegate(reviewEvents, 're', versions),
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Object.values(userRows).find((r) => r.id === where.id) ?? null,
    },
  } as unknown as MockDbBase;
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('campaign / creative cascade deletion', () => {
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

  // Seed a campaign with one creative, two versions, a comment and a review
  // event, sharing two assets (one referenced twice to exercise refCount).
  function seedNestedCampaign() {
    db._seedCampaign('cmp_1', 'client_1');
    db._seedCreative('cr_1', 'cmp_1', 'client_1');
    db._seedAsset('as_main', 'shaA', 1);
    db._seedAsset('as_poster', 'shaB', 1);
    db._seedAsset('as_shared', 'shaC', 2);
    db._seedVersion('v1', 'cr_1', 'cmp_1', 'client_1', 1, 'agency_1', { assetId: 'as_main', posterAssetId: 'as_poster' });
    db._seedVersion('v2', 'cr_1', 'cmp_1', 'client_1', 2, 'agency_1', { assetId: 'as_shared' });
    db._seedVersion('v3', 'cr_1', 'cmp_1', 'client_1', 3, 'agency_1', { assetId: 'as_shared' });
    db._seedComment('cm_1', 'v1', 'client_1');
    db._seedComment('cm_2', 'v2', 'client_1');
    db._seedReviewEvent('re_1', 'v1', 'client_1');
  }

  it('DELETE /campaigns/:id cascade-deletes creatives, versions, comments and review events (200 {ok:true})', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    seedNestedCampaign();

    const res = await request(app.getHttpServer())
      .delete('/campaigns/cmp_1')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(db._campaigns.has('cmp_1')).toBe(false);
    expect(db._creatives.has('cr_1')).toBe(false);
    expect(db._versions.size).toBe(0);
    expect(db._comments.size).toBe(0);
    expect(db._reviewEvents.size).toBe(0);
  });

  it('decrementing refCount removes assets with no remaining references and keeps shared ones', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    seedNestedCampaign();

    const res = await request(app.getHttpServer())
      .delete('/campaigns/cmp_1')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(200);

    // as_main and as_poster were referenced once -> refCount hits 0 -> removed.
    expect(db._assets.has('as_main')).toBe(false);
    expect(db._assets.has('as_poster')).toBe(false);
    // as_shared was referenced twice (v2 + v3) -> decremented to 1 -> kept.
    expect(db._assets.get('as_shared')?.refCount).toBe(1);
  });

  it('DELETE /campaigns/:id on an existing empty campaign still succeeds', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedCampaign('cmp_empty', 'client_1');

    const res = await request(app.getHttpServer())
      .delete('/campaigns/cmp_empty')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(db._campaigns.has('cmp_empty')).toBe(false);
  });

  it('DELETE /campaigns/:id returns 404 for a nonexistent campaign', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .delete('/campaigns/nope')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(404);
  });

  it('DELETE /campaigns/:id returns 404 for a foreign-agency campaign (tenancy)', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    db._seedCampaign('cmp_foreign', 'client_1', 'agency_2');

    const res = await request(app.getHttpServer())
      .delete('/campaigns/cmp_foreign')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(404);
    // Foreign campaign must remain untouched.
    expect(db._campaigns.has('cmp_foreign')).toBe(true);
  });

  it('DELETE /creatives/:id with versions/comments now succeeds', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    seedNestedCampaign();

    const res = await request(app.getHttpServer())
      .delete('/creatives/cr_1')
      .set('Cookie', auth.cookie)
      .set(auth.headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(db._creatives.has('cr_1')).toBe(false);
    expect(db._versions.size).toBe(0);
    expect(db._comments.size).toBe(0);
    expect(db._reviewEvents.size).toBe(0);
  });
});
