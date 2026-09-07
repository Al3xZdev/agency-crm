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
      if (nested != null) {
        out[k] = filterSelect(nested as Record<string, unknown>, v as Record<string, unknown>);
      } else if ('take' in v || 'skip' in v) {
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
    findFirst: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = Object.values(userRows).find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
    },
    findMany: ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const rows = Object.values(userRows).filter((r) => !where || matchesWhere(r, where));
      return rows.map((r) => filterSelect(r, select));
    },
  };

  const magicLinkDelegate = {
    findMany: () => [],
  };

  const commentDelegate = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cm_${comments.size + 1}`, createdAt: new Date(), removedAt: null, ...data };
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
    findFirst: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = [...comments.values()].find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
    },
    updateMany: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of [...comments.values()]) {
        if (!matchesWhere(row, where)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    },
  };

  const versionDelegate = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cv_${versions.size + 1}`, createdAt: new Date(), reviewStatus: 'NONE', ...data };
      versions.set(row.id as string, row);
      return row;
    },
    findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = [...versions.values()].find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
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

  const reviewEventDelegate = {
    create: ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = { id: `re_${reviewEvents.size + 1}`, occurredAt: new Date(), ...data };
      reviewEvents.set(row.id as string, row);
      return select ? filterSelect(row, select) : row;
    },
  };

  const db = {
    _clients: clients,
    _campaigns: campaigns,
    _creatives: creatives,
    _versions: versions,
    _assets: assets,
    _comments: comments,
    _reviewEvents: reviewEvents,
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
    _seedComment(id: string, versionId: string, data: Record<string, unknown>) {
      comments.set(id, {
        id, agencyId: 'agency_1', clientId: 'client_1', versionId,
        authorType: 'STAFF', authorUserId: null, authorLabel: 'Seeded User',
        anchor: 'PLAIN', posX: null, posY: null, startMs: null, endMs: null,
        strokes: [], body: 'Seeded comment body', createdAt: new Date(), removedAt: null,
        ...data,
      });
      return comments.get(id)!;
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
    user: userDelegate,
    comment: commentDelegate,
    reviewEvent: reviewEventDelegate,
    magicLink: magicLinkDelegate,
    emailMessage: { findUnique: () => null, create: ({ data }: { data: Record<string, unknown> }) => ({ id: 'em_stub', ...data }), update: ({ data }: { data: Record<string, unknown> }) => ({ id: 'em_stub', ...data }) },
  };
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('comments API (slice 7)', () => {
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
    db._seedCreative('cr_1', 'cmp_1', 'client_1', 'IMAGE');
    db._seedVersion('ver_1', 'cr_1', 'client_1', { versionNo: 1, state: 'READY' });
    db._seedClient('client_9', 'agency_2');
    db._seedCampaign('cmp_foreign', 'client_9', 'agency_2');
    db._seedCreative('cr_foreign', 'cmp_foreign', 'client_9', 'IMAGE', 'agency_2');
    db._seedVersion('ver_foreign', 'cr_foreign', 'client_9', { versionNo: 1, state: 'READY' }, 'agency_2');
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

  it('creates a PLAIN comment as STAFF (201)', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'PLAIN', body: 'Looks good!' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ anchor: 'PLAIN', body: 'Looks good!' });
    expect(res.body.posX).toBeNull();
    expect(res.body.startMs).toBeNull();
  });

  it('creates a PIN comment with posX+posY (201)', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'PIN', posX: 100, posY: 200, body: 'Move this left' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ anchor: 'PIN', posX: 100, posY: 200, body: 'Move this left' });
    expect(res.body.startMs).toBeNull();
  });

  it('creates a RANGE comment with startMs+endMs (201)', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'RANGE', startMs: 1000, endMs: 5000, body: 'Too long here' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ anchor: 'RANGE', startMs: 1000, endMs: 5000, body: 'Too long here' });
    expect(res.body.posX).toBeNull();
  });

  it('returns 400 when PIN anchor is missing posX/posY', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'PIN', body: 'Missing coordinates' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when RANGE anchor is missing startMs/endMs', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'RANGE', body: 'Missing timestamps' });
    expect(res.status).toBe(400);
  });

  it('GET returns comments ordered by createdAt ASC', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'PLAIN', body: 'Second comment' });
    await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'PLAIN', body: 'First comment' });

    const res = await request(app.getHttpServer())
      .get('/versions/ver_1/comments')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].body).toBe('Second comment');
    expect(res.body[1].body).toBe('First comment');
  });

  it('returns 404 when version does not exist', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/versions/nonexistent/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'PLAIN', body: 'Ghost comment' });
    expect(res.status).toBe(404);
  });

  it('GET exposes ownership flags: own comment editable/deletable, others immutable', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    await request(app.getHttpServer())
      .post('/versions/ver_1/comments')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ anchor: 'PLAIN', body: 'My comment' });
    // Another staff user's comment, and a client-authored one.
    db._seedComment('cm_other', 'ver_1', { authorUserId: 'u_creative', authorLabel: 'Creative User' });
    db._seedComment('cm_client', 'ver_1', { authorType: 'CLIENT', authorUserId: null, authorLabel: 'Acme Corp' });

    const res = await request(app.getHttpServer())
      .get('/versions/ver_1/comments')
      .set('Cookie', auth.cookie);
    expect(res.status).toBe(200);

    const own = res.body.find((c: Record<string, unknown>) => c.id === 'cm_1');
    expect(own.canDelete).toBe(true);
    expect(own.canEdit).toBe(true);
    expect(own.authorUserId).toBe('u_mgr');
    expect(own.authorLabel).toBe('Manager User');

    const other = res.body.find((c: Record<string, unknown>) => c.id === 'cm_other');
    expect(other.canDelete).toBe(false);
    expect(other.canEdit).toBe(false);
    expect(other.authorUserId).toBe('u_creative');

    const client = res.body.find((c: Record<string, unknown>) => c.id === 'cm_client');
    expect(client.canDelete).toBe(false);
    expect(client.canEdit).toBe(false);
    expect(client.authorUserId).toBeNull();
  });

  describe('DELETE /versions/:versionId/comments/:commentId (ownership)', () => {
    it('removes the caller\'s own STAFF comment (200)', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedComment('cm_mine', 'ver_1', { authorUserId: 'u_mgr', authorLabel: 'Manager User' });

      const res = await request(app.getHttpServer())
        .delete('/versions/ver_1/comments/cm_mine')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      // Soft-deleted: hidden from the list, row preserved for the audit trail.
      expect(db._comments.get('cm_mine')!['removedAt']).toBeInstanceOf(Date);

      const list = await request(app.getHttpServer()).get('/versions/ver_1/comments').set('Cookie', auth.cookie);
      expect(list.body.map((c: Record<string, unknown>) => c.id)).not.toContain('cm_mine');
    });

    it('forbids removing another staff user\'s comment (403)', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedComment('cm_other', 'ver_1', { authorUserId: 'u_creative', authorLabel: 'Creative User' });

      const res = await request(app.getHttpServer())
        .delete('/versions/ver_1/comments/cm_other')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(403);
      expect(db._comments.get('cm_other')!['removedAt']).toBeNull();
    });

    it('forbids removing a client-authored comment (403)', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedComment('cm_client', 'ver_1', { authorType: 'CLIENT', authorUserId: null, authorLabel: 'Acme Corp' });

      const res = await request(app.getHttpServer())
        .delete('/versions/ver_1/comments/cm_client')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(403);
    });

    it('returns 404 when the comment does not exist', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      const res = await request(app.getHttpServer())
        .delete('/versions/ver_1/comments/cm_ghost')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /versions/:versionId/comments/:commentId (ownership)', () => {
    it('rewrites the caller\'s own STAFF comment body and stamps editedAt (200)', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedComment('cm_mine', 'ver_1', { authorUserId: 'u_mgr', authorLabel: 'Manager User', anchor: 'RANGE', startMs: 1000, endMs: 5000 });

      const res = await request(app.getHttpServer())
        .patch('/versions/ver_1/comments/cm_mine')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ body: 'Reworded take' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'cm_mine',
        body: 'Reworded take',
        canDelete: true,
        canEdit: true,
        authorUserId: 'u_mgr',
      });
      expect(res.body.editedAt).toBeDefined();
      // Anchor payload is immutable — the PATCH cannot touch it.
      expect(res.body.anchor).toBe('RANGE');
      expect(res.body.startMs).toBe(1000);
      expect(db._comments.get('cm_mine')!['body']).toBe('Reworded take');
      expect(db._comments.get('cm_mine')!['editedAt']).toBeInstanceOf(Date);
    });

    it('forbids editing another staff user\'s comment (403)', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedComment('cm_other', 'ver_1', { authorUserId: 'u_creative', authorLabel: 'Creative User' });

      const res = await request(app.getHttpServer())
        .patch('/versions/ver_1/comments/cm_other')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ body: 'Hijacked' });
      expect(res.status).toBe(403);
      expect(db._comments.get('cm_other')!['body']).toBe('Seeded comment body');
    });

    it('forbids editing a client-authored comment (403)', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedComment('cm_client', 'ver_1', { authorType: 'CLIENT', authorUserId: null, authorLabel: 'Acme Corp' });

      const res = await request(app.getHttpServer())
        .patch('/versions/ver_1/comments/cm_client')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ body: 'Edited by staff' });
      expect(res.status).toBe(403);
    });

    it('returns 400 for an empty/whitespace body', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      db._seedComment('cm_mine', 'ver_1', { authorUserId: 'u_mgr', authorLabel: 'Manager User' });

      const res = await request(app.getHttpServer())
        .patch('/versions/ver_1/comments/cm_mine')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ body: '   ' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the comment does not exist', async () => {
      const auth = staffAuth('ACCOUNT_MANAGER');
      const res = await request(app.getHttpServer())
        .patch('/versions/ver_1/comments/cm_ghost')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ body: 'Ghost edit' });
      expect(res.status).toBe(404);
    });
  });
});
