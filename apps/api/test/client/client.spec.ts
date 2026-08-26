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
  magicLink: 'MagicLink',
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
    const rowVal = row[k];
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if ('not' in v) {
        if (rowVal === (v as Record<string, unknown>).not) return false;
      } else if (rowVal !== v) {
        return false;
      }
    } else {
      if (rowVal !== v) return false;
    }
  }
  return true;
}

function filterSelect<T extends Record<string, unknown>>(row: T, select?: Record<string, unknown>): T {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (k === '_count') {
      const countSelect = v as Record<string, unknown>;
      const countResult: Record<string, unknown> = {};
      for (const fk of Object.keys(countSelect)) {
        countResult[fk] = 0;
      }
      out[k] = countResult;
      continue;
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const nested = (row as Record<string, unknown>)[k];
      const hasSelect = 'select' in (v as Record<string, unknown>);
      const relCfg = v as Record<string, unknown>;

      if (Array.isArray(nested) || ('take' in relCfg && Array.isArray(nested))) {
        let items = nested as Array<Record<string, unknown>>;
        if (relCfg.where) items = items.filter((item) => matchesWhere(item, relCfg.where as Record<string, unknown>));
        if (relCfg.orderBy) {
          const key = Object.keys(relCfg.orderBy as Record<string, string>)[0];
          const dir = (relCfg.orderBy as Record<string, string>)[key];
          items = [...items].sort((a, b) => {
            const av = a[key] as number, bv = b[key] as number;
            return dir === 'desc' ? bv - av : av - bv;
          });
        }
        if (relCfg.take !== undefined) items = items.slice(0, relCfg.take as number);
        if (hasSelect) {
          out[k] = items.map((item) => filterSelect(item, relCfg.select as Record<string, unknown>));
        } else {
          out[k] = items;
        }
      } else if (nested != null && typeof nested === 'object') {
        out[k] = hasSelect
          ? filterSelect(nested as Record<string, unknown>, relCfg.select as Record<string, unknown>)
          : nested;
      } else if ('take' in relCfg) {
        out[k] = [];
      } else {
        out[k] = null;
      }
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
  const assets = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const comments = new Map<string, Record<string, unknown>>();
  const reviewEvents = new Map<string, Record<string, unknown>>();
  const links = new Map<string, Record<string, unknown>>();
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
      findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = [...map.values()].find((r) => matchesWhere(r, where)) ?? null;
        return row ? filterSelect(row, select) : null;
      },
      findMany: ({ where, orderBy, select, take }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown>; take?: number }) => {
        let rows = [...map.values()].filter((r) => !where || matchesWhere(r, where));
        if (orderBy) {
          const key = Object.keys(orderBy)[0];
          const dir = orderBy[key];
          rows.sort((a, b) => {
            const av = a[key] as number, bv = b[key] as number;
            return dir === 'desc' ? bv - av : av - bv;
          });
        }
        if (take !== undefined) rows = rows.slice(0, take);
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

  const userDelegate = {
    findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = Object.values(userRows).find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
    },
  };

  const commentDelegate = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cm_${comments.size + 1}`, createdAt: new Date(), ...data };
      comments.set(row.id as string, row);
      return row;
    },
    findMany: ({ where, orderBy, select }: { where: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown> }) => {
      const rows = [...comments.values()].filter((r) => matchesWhere(r, where));
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        const dir = orderBy[key];
        rows.sort((a, b) => {
          const av = (a[key] as Date).getTime(), bv = (b[key] as Date).getTime();
          return dir === 'asc' ? av - bv : bv - av;
        });
      }
      return rows.map((r) => filterSelect(r, select));
    },
  };

  const reviewEventDelegate = {
    create: ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const d = data as Record<string, unknown>;
      const dup = [...reviewEvents.values()].some(
        (r) => r.versionId === d.versionId,
      );
      if (dup) {
        const err = new Error('Unique constraint failed') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const row = { id: `re_${reviewEvents.size + 1}`, occurredAt: new Date(), ...data };
      reviewEvents.set(row.id as string, row);
      return select ? filterSelect(row, select) : row;
    },
  };

  const versionDelegate = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cv_${versions.size + 1}`, createdAt: new Date(), reviewStatus: 'NONE', ...data };
      versions.set(row.id as string, row);
      return row;
    },
    findFirst: ({ where, orderBy, select }: { where: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown> }) => {
      const hits = [...versions.values()].filter((r) => matchesWhere(r, where));
      if (orderBy?.versionNo === 'desc') hits.sort((a, b) => (b.versionNo as number) - (a.versionNo as number));
      return hits[0] ? filterSelect(hits[0], select) : null;
    },
    findMany: ({ where, orderBy, select, take }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown>; take?: number }) => {
      let rows = [...versions.values()].filter((r) => !where || matchesWhere(r, where));
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        const dir = orderBy[key];
        rows.sort((a, b) => {
          const av = a[key] as number, bv = b[key] as number;
          return dir === 'desc' ? bv - av : av - bv;
        });
      }
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((r) => filterSelect(r, select));
    },
    update: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = [...versions.values()].find((r) => matchesWhere(r, where));
      if (!row) {
        const err = new Error('record not found') as Error & { code: string };
        err.code = 'P2025';
        throw err;
      }
      Object.assign(row, data);
      return row;
    },
    count: ({ where }: { where?: Record<string, unknown> }) =>
      [...versions.values()].filter((r) => !where || matchesWhere(r, where)).length,
  };

  const db = {
    _clients: clients,
    _campaigns: campaigns,
    _creatives: creatives,
    _versions: versions,
    _assets: assets,
    _comments: comments,
    _reviewEvents: reviewEvents,
    _links: links,
    _seedClient(id: string, agencyId = 'agency_1') {
      clients.set(id, { id, agencyId, name: `Client ${id}`, contact: null, createdAt: new Date() });
      return clients.get(id)!;
    },
    _seedCampaign(id: string, clientId: string, agencyId = 'agency_1') {
      campaigns.set(id, { id, agencyId, clientId, name: `Campaign ${id}`, createdAt: new Date() });
      return campaigns.get(id)!;
    },
    _seedCreative(id: string, campaignId: string, clientId: string, kind: string, agencyId = 'agency_1') {
      creatives.set(id, {
        id, agencyId, clientId, campaignId, title: `Creative ${id}`, kind, status: 'DRAFT',
        createdById: 'u_admin', createdAt: new Date(),
      });
      return creatives.get(id)!;
    },
    _seedVersion(id: string, creativeId: string, clientId: string, data: Record<string, unknown>, agencyId = 'agency_1') {
      versions.set(id, {
        id, agencyId, clientId, creativeId, versionNo: 1, state: 'READY', reviewStatus: 'NONE',
        textBody: null, assetId: null, posterId: null, failReason: null, durationMs: null,
        createdAt: new Date(), ...data,
      });
      return versions.get(id)!;
    },
    _seedAsset(id: string, agencyId = 'agency_1') {
      assets.set(id, { id, agencyId, sha256: `hash_${id}`, mime: 'image/png', byteSize: 1024, storageKey: `assets/${id}.png`, refCount: 1, createdAt: new Date() });
      return assets.get(id)!;
    },
    _seedMagicLink(id: string, clientId: string, agencyId = 'agency_1') {
      links.set(id, { id, agencyId, clientId, recipientEmail: 'client@test.test', tokenHash: `mlhash_${id}`, createdById: 'u_admin', expiresAt: null, revokedAt: null, lastUsedAt: null, createdAt: new Date() });
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
        const found = [...sessions.values()].find((x) => x.tokenHash === where.tokenHash) ?? null;
        if (!found) return null;
        const s = { ...found };
        if (s.userId) s.user = userRows[s.userId as string] ?? null;
        if (s.magicLinkId) s.magicLink = links.get(s.magicLinkId as string) ?? null;
        return s;
      },
    },
    client: crudFor(clients, 'cl', () => ({ agencyId: 'agency_1', contact: null })),
    campaign: crudFor(campaigns, 'cmp', () => ({ agencyId: 'agency_1' })),
    creative: crudFor(creatives, 'cr', () => ({ agencyId: 'agency_1', status: 'DRAFT' })),
    creativeVersion: versionDelegate,
    asset: {
      findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = [...assets.values()].find((r) => matchesWhere(r, where)) ?? null;
        return row ? filterSelect(row, select) : null;
      },
      create: ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = { id: `as_${assets.size + 1}`, createdAt: new Date(), refCount: 1, ...data };
        assets.set(row.id as string, row);
        return select ? filterSelect(row, select) : row;
      },
      update: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = [...assets.values()].find((r) => matchesWhere(r, where));
        if (!row) { const err = new Error('not found') as Error & { code: string }; err.code = 'P2025'; throw err; }
        Object.assign(row, data);
        return row;
      },
    },
    magicLink: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `ml_${links.size + 1}`, revokedAt: null, lastUsedAt: null, ...data };
        links.set(row.id as string, row);
        return row;
      },
      findUnique: ({ where }: { where: Record<string, unknown> }) => {
        return [...links.values()].find((l) => matchesWhere(l, where)) ?? null;
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
    },
    user: userDelegate,
    comment: commentDelegate,
    reviewEvent: reviewEventDelegate,
  };
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('client API (slice 9)', () => {
  let app: INestApplication;
  let db: MockDb;
  const csrfCookieName = cookiePolicy('test').csrfName;
  const testAgencyId = 'agency_1';
  const testClientId = 'client_1';
  const testMagicLinkId = 'ml_001';
  const testSessionId = 'sess_client_1';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
    process.env.SESSION_TTL_DAYS = '7';
    process.env.PUBLIC_WEB_URL = 'http://localhost:3001';
  });

  beforeEach(async () => {
    db = buildMockDb();

    db._seedClient(testClientId, testAgencyId);
    db._seedMagicLink(testMagicLinkId, testClientId, testAgencyId);

    db.session.create({
      data: {
        id: testSessionId,
        tokenHash: sha256hex('client-token-raw'),
        kind: 'CLIENT',
        agencyId: testAgencyId,
        clientId: testClientId,
        magicLinkId: testMagicLinkId,
        csrfSecret: 'client-csrf-secret',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      },
    });

    db._seedCampaign('cmp_1', testClientId, testAgencyId);
    db._seedCreative('cr_1', 'cmp_1', testClientId, 'IMAGE', testAgencyId);
    db._seedAsset('asset_poster', testAgencyId);
    const ver1 = db._seedVersion('ver_1', 'cr_1', testClientId, {
      versionNo: 1,
      state: 'READY',
      posterId: 'asset_poster',
    }, testAgencyId);
    ver1.poster = db._assets.get('asset_poster');
    ver1.comments = [];
    ver1.reviewEvents = [];

    db._seedCreative('cr_upload_fail', 'cmp_1', testClientId, 'VIDEO', testAgencyId);
    db._seedVersion('ver_fail', 'cr_upload_fail', testClientId, {
      versionNo: 1,
      state: 'FAILED',
      reviewStatus: 'NONE',
    }, testAgencyId);
    db._creatives.get('cr_upload_fail')!.status = 'UPLOAD_FAILED';

    db._creatives.get('cr_1')!.versions = [ver1];

    db._seedClient('client_foreign', testAgencyId);
    db._seedCampaign('cmp_foreign', 'client_foreign', testAgencyId);
    db._seedCreative('cr_foreign', 'cmp_foreign', 'client_foreign', 'IMAGE', testAgencyId);
    db._seedVersion('ver_foreign', 'cr_foreign', 'client_foreign', { versionNo: 1, state: 'READY' }, testAgencyId);

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

  function clientAuth(): {
    cookie: string;
    headers: Record<string, string>;
  } {
    const raw = 'client-token-raw';
    const csrf = signCsrf('client-csrf-secret');
    return {
      cookie: `${SESSION_COOKIE}=${raw}; ${csrfCookieName}=${csrf}`,
      headers: { 'X-CSRF-Token': csrf },
    };
  }

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
        agencyId: testAgencyId,
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

  describe('GET /c/me', () => {
    it('returns client info for valid CLIENT session', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .get('/c/me')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        clientId: testClientId,
        agencyId: testAgencyId,
        clientName: 'Client client_1',
      });
    });

    it('returns 403 when called by STAFF principal', async () => {
      const auth = staffAuth('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get('/c/me')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /c/creatives', () => {
    it('returns creatives with latest READY version for this client', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .get('/c/creatives')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: 'cr_1',
        title: 'Creative cr_1',
        kind: 'IMAGE',
        status: 'DRAFT',
        campaignId: 'cmp_1',
        latestVersionId: 'ver_1',
        latestVersionNo: 1,
        reviewStatus: 'NONE',
      });
    });

    it('excludes creatives with UPLOAD_FAILED status', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .get('/c/creatives')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      const ids = res.body.map((c: { id: string }) => c.id);
      expect(ids).not.toContain('cr_upload_fail');
    });

    it('returns empty array when client has no creatives', async () => {
      db._creatives.clear();
      db._versions.clear();
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .get('/c/creatives')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 403 for STAFF principal', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      const res = await request(app.getHttpServer())
        .get('/c/creatives')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /c/versions/:versionId', () => {
    it('returns version detail with comments and reviewEvent', async () => {
      const comment = {
        id: 'cm_1',
        versionId: 'ver_1',
        agencyId: testAgencyId,
        clientId: testClientId,
        authorType: 'STAFF',
        authorUserId: 'u_mgr',
        authorLabel: 'Manager User',
        anchor: 'PLAIN',
        posX: null,
        posY: null,
        startMs: null,
        endMs: null,
        body: 'Looks good!',
        createdAt: new Date(),
      };
      db._comments.set('cm_1', comment);
      db._versions.get('ver_1')!.comments = [comment];

      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .get('/c/versions/ver_1')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'ver_1',
        state: 'READY',
        reviewStatus: 'NONE',
      });
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0]).toMatchObject({
        body: 'Looks good!',
        authorType: 'STAFF',
        authorLabel: 'Manager User',
      });
      expect(res.body.reviewEvent).toBeNull();
    });

    it('returns 404 when version does not exist', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .get('/c/versions/nonexistent')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(404);
    });

      it('returns 404 when version belongs to different client (ownership check)', async () => {
        const auth = clientAuth();
        const res = await request(app.getHttpServer())
          .get('/c/versions/ver_foreign')
          .set('Cookie', auth.cookie)
          .set(auth.headers);
        expect(res.status).toBe(404);
      });
  });

  describe('POST /c/versions/:versionId/comments', () => {
    it('creates comment with CLIENT authorship', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .post('/c/versions/ver_1/comments')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ anchor: 'PLAIN', body: 'Nice work!' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        body: 'Nice work!',
        authorType: 'CLIENT',
        authorLabel: 'Client client_1',
      });
      expect(db._comments.size).toBe(1);
    });

    it('returns 404 when version does not exist', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .post('/c/versions/nonexistent/comments')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ anchor: 'PLAIN', body: 'test' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /c/versions/:versionId/decision', () => {
    it('casts APPROVED decision', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .post('/c/versions/ver_1/decision')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        decision: 'APPROVED',
        actorType: 'CLIENT',
        actorLabel: 'Client',
      });
      expect(db._creatives.get('cr_1')?.status).toBe('APPROVED');
    });

    it('returns 409 DECISION_ALREADY_CAST on duplicate', async () => {
      const auth = clientAuth();
      await request(app.getHttpServer())
        .post('/c/versions/ver_1/decision')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ decision: 'APPROVED' });
      const res = await request(app.getHttpServer())
        .post('/c/versions/ver_1/decision')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ decision: 'REJECTED' });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain('DECISION_ALREADY_CAST');
    });

    it('returns 404 when version does not exist', async () => {
      const auth = clientAuth();
      const res = await request(app.getHttpServer())
        .post('/c/versions/nonexistent/decision')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(404);
    });
  });
});
