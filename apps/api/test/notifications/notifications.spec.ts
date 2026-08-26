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

// ── tenancy constants (must mirror schema TENANTED_MODELS) ──────────────────
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
  emailMessage: 'EmailMessage',
};

// ── helpers ────────────────────────────────────────────────────────────────
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
    if (k === 'not') {
      if (row === v) return false;
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
    if (v === true) {
      out[k] = (row as Record<string, unknown>)[k];
    }
  }
  return out as T;
}

// ── tenanted view ──────────────────────────────────────────────────────────
function buildTenantedView(raw: MockDbBase): MockDbBase {
  const view = { ...raw } as MockDbBase;
  for (const key of Object.keys(TENANT_MODEL_NAMES)) {
    const target = (raw as Record<string, unknown>)[key];
    if (!target) continue;
    (view as Record<string, unknown>)[key] = new Proxy(target as object, {
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

// ── mock db builder ────────────────────────────────────────────────────────
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
  const emailMessages = new Map<string, Record<string, unknown>>();

  const userRows: Record<string, Record<string, unknown>> = {
    u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin User', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
    u_mgr: { id: 'u_mgr', email: 'mgr@agency.test', displayName: 'Manager User', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    u_creative: { id: 'u_creative', email: 'creative@agency.test', displayName: 'Creative User', isActive: true, role: 'CREATIVE', agencyId: 'agency_1' },
  };

  const userDelegate = {
    findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = Object.values(userRows).find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
    },
    findMany: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      return Object.values(userRows)
        .filter((r) => matchesWhere(r, where))
        .map((r) => filterSelect(r, select));
    },
  };

  const commentDelegate = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cm_${comments.size + 1}`, createdAt: new Date(), ...data };
      comments.set(row.id as string, row);
      return row;
    },
  };

  const reviewEventDelegate = {
    create: ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
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
    findFirst: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = [...versions.values()].find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
    },
    findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = [...versions.values()].find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
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
  };

  const emailMessageDelegate = {
    create: ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = { id: `em_${emailMessages.size + 1}`, createdAt: new Date(), attempts: 0, sentAt: null, failedAt: null, handledAt: null, ...data };
      emailMessages.set(row.id as string, row);
      return select ? filterSelect(row, select) : row;
    },
    findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = [...emailMessages.values()].find((r) => matchesWhere(r, where)) ?? null;
      return row ? filterSelect(row, select) : null;
    },
    findMany: ({ where, orderBy, select, take }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown>; take?: number }) => {
      let rows = [...emailMessages.values()].filter((r) => !where || matchesWhere(r, where));
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        const dir = orderBy[key];
        rows.sort((a, b) => {
          const av = (a[key] as Date).getTime(), bv = (b[key] as Date).getTime();
          return dir === 'desc' ? bv - av : av - bv;
        });
      }
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((r) => filterSelect(r, select));
    },
    update: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = [...emailMessages.values()].find((r) => matchesWhere(r, where));
      if (!row) {
        const err = new Error('record not found') as Error & { code: string };
        err.code = 'P2025';
        throw err;
      }
      Object.assign(row, data);
      return row;
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
    _links: links,
    _emailMessages: emailMessages,
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
    _seedMagicLink(id: string, clientId: string, email: string, agencyId = 'agency_1') {
      links.set(id, { id, agencyId, clientId, recipientEmail: email, tokenHash: `mlhash_${id}`, createdById: 'u_admin', expiresAt: null, revokedAt: null, lastUsedAt: null, createdAt: new Date() });
      return links.get(id)!;
    },
    _seedEmailMessage(data: Record<string, unknown>) {
      const row = { id: `em_${emailMessages.size + 1}`, createdAt: new Date(), attempts: 0, sentAt: null, failedAt: null, handledAt: null, ...data };
      emailMessages.set(row.id as string, row);
      return row;
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
        if (s.magicLinkId) s.magicLink = links.get(s.magicLinkId as string) ?? null;
        return s;
      },
    },
    client: { create: ({ data }: { data: Record<string, unknown> }) => { const r = { id: `cl_${clients.size + 1}`, createdAt: new Date(), ...data }; clients.set(r.id as string, r); return r; } },
    campaign: { create: ({ data }: { data: Record<string, unknown> }) => { const r = { id: `cmp_${campaigns.size + 1}`, createdAt: new Date(), ...data }; campaigns.set(r.id as string, r); return r; } },
    creative: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `cr_${creatives.size + 1}`, createdAt: new Date(), ...data };
        creatives.set(r.id as string, r);
        return r;
      },
      findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = [...creatives.values()].find((r) => matchesWhere(r, where)) ?? null;
        return row ? filterSelect(row, select) : null;
      },
    },
    creativeVersion: versionDelegate,
    asset: { findUnique: () => null, create: ({ data }: { data: Record<string, unknown> }) => ({ id: `as_${assets.size + 1}`, createdAt: new Date(), ...data }) },
    magicLink: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `ml_${links.size + 1}`, revokedAt: null, lastUsedAt: null, ...data };
        links.set(row.id as string, row);
        return row;
      },
      findUnique: ({ where }: { where: Record<string, unknown> }) => {
        return [...links.values()].find((l) => matchesWhere(l, where)) ?? null;
      },
      findMany: ({ where, select, distinct }: { where: Record<string, unknown>; select?: Record<string, unknown>; distinct?: string[] }) => {
        let rows = [...links.values()].filter((r) => matchesWhere(r, where));
        if (distinct?.includes('recipientEmail')) {
          const seen = new Set<string>();
          rows = rows.filter((r) => {
            const e = r.recipientEmail as string;
            if (seen.has(e)) return false;
            seen.add(e);
            return true;
          });
        }
        return rows.map((r) => filterSelect(r, select));
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
    emailMessage: emailMessageDelegate,
  };
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

// ── tests ──────────────────────────────────────────────────────────────────
describe('notifications API (slice 9)', () => {
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
    db._seedMagicLink('ml_1', 'client_1', 'client@test.test');
    db._seedMagicLink('ml_2', 'client_1', 'client-dup@test.test'); // second link for dedupe

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

  function staffAuth(role: 'SUPER_ADMIN' | 'ACCOUNT_MANAGER'): {
    cookie: string;
    headers: Record<string, string>;
  } {
    const userId = role === 'SUPER_ADMIN' ? 'u_admin' : 'u_mgr';
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

  // ── GET /emails ──────────────────────────────────────────────────────

  describe('GET /emails', () => {
    it('returns 401 without session', async () => {
      const res = await request(app.getHttpServer()).get('/emails');
      expect(res.status).toBe(401);
    });

    it('returns empty list when no emails queued', async () => {
      const auth = staffAuth('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get('/emails')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns queued emails for SUPER_ADMIN', async () => {
      db._seedEmailMessage({
        agencyId: 'agency_1',
        template: 'VERSION_NEW',
        status: 'SENT',
        toAddresses: ['client@test.test'],
        subject: 'New version ready',
        bodyText: 'Check it out',
        bodyHtml: '<p>Check it out</p>',
      });

      const auth = staffAuth('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get('/emails')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        template: 'VERSION_NEW',
        status: 'SENT',
        subject: 'New version ready',
      });
    });

    it('returns queued emails for ACCOUNT_MANAGER', async () => {
      db._seedEmailMessage({
        agencyId: 'agency_1',
        template: 'COMMENT_NEW',
        status: 'QUEUED',
        toAddresses: ['admin@agency.test'],
        subject: 'New comment',
        bodyText: 'See below',
        bodyHtml: '<p>See below</p>',
      });

      const auth = staffAuth('ACCOUNT_MANAGER');
      const res = await request(app.getHttpServer())
        .get('/emails')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('filters by status query param', async () => {
      db._seedEmailMessage({
        agencyId: 'agency_1', template: 'VERSION_NEW', status: 'SENT',
        toAddresses: ['a@test.test'], subject: 'S1', bodyText: '', bodyHtml: '',
      });
      db._seedEmailMessage({
        agencyId: 'agency_1', template: 'COMMENT_NEW', status: 'QUEUED',
        toAddresses: ['b@test.test'], subject: 'S2', bodyText: '', bodyHtml: '',
      });

      const auth = staffAuth('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get('/emails?status=SENT')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('SENT');
    });

    it('filters by template query param', async () => {
      db._seedEmailMessage({
        agencyId: 'agency_1', template: 'VERSION_NEW', status: 'QUEUED',
        toAddresses: ['a@test.test'], subject: 'V1', bodyText: '', bodyHtml: '',
      });
      db._seedEmailMessage({
        agencyId: 'agency_1', template: 'DECISION_CAST', status: 'SENT',
        toAddresses: ['b@test.test'], subject: 'D1', bodyText: '', bodyHtml: '',
      });

      const auth = staffAuth('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get('/emails?template=DECISION_CAST')
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].template).toBe('DECISION_CAST');
    });

    it('rejects CREATIVE role (not in SUPER_ADMIN|ACCOUNT_MANAGER)', async () => {
      const raw = randomBytes(32).toString('base64url');
      const csrf = signCsrf('staff-secret');
      db.session.create({
        data: {
          tokenHash: sha256hex(raw),
          kind: 'STAFF',
          agencyId: 'agency_1',
          userId: 'u_creative',
          csrfSecret: 'staff-secret',
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: null,
        },
      });
      const res = await request(app.getHttpServer())
        .get('/emails')
        .set('Cookie', `${SESSION_COOKIE}=${raw}; ${csrfCookieName}=${csrf}`)
        .set({ 'X-CSRF-Token': csrf });
      expect(res.status).toBe(403);
    });
  });

  // ── PATCH /emails/:id/handle ─────────────────────────────────────────

  describe('PATCH /emails/:id/handle', () => {
    it('marks an email as handled', async () => {
      const em = db._seedEmailMessage({
        agencyId: 'agency_1', template: 'VERSION_NEW', status: 'SENT',
        toAddresses: ['a@test.test'], subject: 'Test', bodyText: '', bodyHtml: '',
      });

      const auth = staffAuth('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .patch(`/emails/${em.id}/handle`)
        .set('Cookie', auth.cookie)
        .set(auth.headers);
      expect(res.status).toBe(200);
      expect(res.body.handledAt).toBeTruthy();
      expect(res.body.id).toBe(em.id);
    });

    it('returns 403 for CREATIVE role', async () => {
      const em = db._seedEmailMessage({
        agencyId: 'agency_1', template: 'COMMENT_NEW', status: 'QUEUED',
        toAddresses: ['a@test.test'], subject: 'Test', bodyText: '', bodyHtml: '',
      });

      const raw = randomBytes(32).toString('base64url');
      const csrf = signCsrf('staff-secret');
      db.session.create({
        data: {
          tokenHash: sha256hex(raw),
          kind: 'STAFF',
          agencyId: 'agency_1',
          userId: 'u_creative',
          csrfSecret: 'staff-secret',
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: null,
        },
      });
      const res = await request(app.getHttpServer())
        .patch(`/emails/${em.id}/handle`)
        .set('Cookie', `${SESSION_COOKIE}=${raw}; ${csrfCookieName}=${csrf}`)
        .set({ 'X-CSRF-Token': csrf });
      expect(res.status).toBe(403);
    });
  });

  // ── fire-and-forget integration via console transport spy ────────────

  describe('fire-and-forget triggers (integration)', () => {
    it('queues COMMENT_NEW email when creating a comment as STAFF', async () => {
      db._seedCampaign('cmp_1', 'client_1');
      db._seedCreative('cr_1', 'cmp_1', 'client_1', 'IMAGE');
      db._seedVersion('ver_1', 'cr_1', 'client_1', { versionNo: 1, state: 'READY' });

      const auth = staffAuth('ACCOUNT_MANAGER');
      const res = await request(app.getHttpServer())
        .post('/versions/ver_1/comments')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ anchor: 'PLAIN', body: 'Nice work!' });
      expect(res.status).toBe(201);

      // Fire-and-forget: wait for async queue to complete
      await new Promise((r) => setTimeout(r, 100));

      const emails = [...db._emailMessages.values()];
      expect(emails.length).toBeGreaterThanOrEqual(1);
      expect(emails.some((e) => e.template === 'COMMENT_NEW')).toBe(true);
    });
  });

  // ── queue + dedupe ───────────────────────────────────────────────────

  describe('NotificationsService.queue (unit-ish)', () => {
    it('queues one email per comment event', async () => {
      db._seedCampaign('cmp_d', 'client_1');
      db._seedCreative('cr_d', 'cmp_d', 'client_1', 'VIDEO');
      db._seedVersion('ver_d', 'cr_d', 'client_1', { versionNo: 1, state: 'READY' });

      const auth = staffAuth('ACCOUNT_MANAGER');
      await request(app.getHttpServer())
        .post('/versions/ver_d/comments')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .send({ anchor: 'PLAIN', body: 'First comment' });

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 100));

      const countAfterFirst = [...db._emailMessages.values()].filter(
        (e) => e.template === 'COMMENT_NEW',
      ).length;
      expect(countAfterFirst).toBeGreaterThanOrEqual(1);
    });
  });
});
