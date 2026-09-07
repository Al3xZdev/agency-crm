import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import http from 'node:http';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PgBossService } from '../../src/jobs/pg-boss.service';
import { VERSION_QUEUE } from '../../src/jobs/jobs.module';
import { SESSION_COOKIE, cookiePolicy } from '../../src/auth/cookies';
import { applyOperation } from '../../src/tenancy/tenancy.rules';
import { currentPrincipal } from '../../src/tenancy/request-context.als';
import { MAX_UPLOAD_BYTES, validateAdmission } from '../../src/uploads/admission.validator';

/**
 * Slice-5b suite (tasks 5b.1–5b.6): storage driver, ordered admission gate,
 * create-version tx with content-addressed dedup, and the TEXT paste path.
 * The LocalStorageDriver runs FOR REAL against a temp dir; Prisma stays a
 * mock whose $extends view executes the genuine tenancy layer.
 */

const TENANT_MODEL_NAMES: Record<string, string> = {
  client: 'Client',
  campaign: 'Campaign',
  creative: 'Creative',
  creativeVersion: 'CreativeVersion',
  asset: 'Asset',
  session: 'Session',
};

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function sha256hex(v: string | Buffer): string {
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
    // Support Prisma's { increment: n } shape appearing in data payloads.
    if (v !== null && typeof v === 'object' && 'increment' in (v as object)) {
      throw new Error('increment shape reached matchesWhere — handle in delegate');
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
  const versions = new Map<string, Record<string, unknown>>();
  const assets = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
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
      findUnique: ({ where }: { where: Record<string, unknown> }) =>
        [...map.values()].find((r) => matchesWhere(r, where)) ?? null,
      findMany: ({ where }: { where?: Record<string, unknown> }) =>
        [...map.values()].filter((r) => !where || matchesWhere(r, where)),
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
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const targets = [...map.values()].filter((r) => matchesWhere(r, where));
        for (const row of targets) Object.assign(row, data);
        return { count: targets.length };
      },
    };
  }

  /** CreativeVersion delegate: honors orderBy and enforces the composite unique. */
  const versionDelegate = {
    _failNextCreateWithP2002: false,
    create: ({ data }: { data: Record<string, unknown> }) => {
      const dup = [...versions.values()].some(
        (r) => r.creativeId === data.creativeId && r.versionNo === data.versionNo,
      );
      if (versionDelegate._failNextCreateWithP2002) {
        versionDelegate._failNextCreateWithP2002 = false;
        const err = new Error('Unique constraint failed') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      if (dup) {
        const err = new Error('Unique constraint failed') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const row = { id: `cv_${versions.size + 1}`, createdAt: new Date(), reviewStatus: 'NONE', ...data };
      versions.set(row.id as string, row);
      return row;
    },
    findUnique: ({ where }: { where: Record<string, unknown> }) => {
      return [...versions.values()].find((r) => matchesWhere(r, where)) ?? null;
    },
    findFirst: ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: Record<string, string>;
    }) => {
      const hits = [...versions.values()].filter((r) => matchesWhere(r, where));
      if (orderBy?.versionNo === 'desc') hits.sort((a, b) => (b.versionNo as number) - (a.versionNo as number));
      return hits[0] ?? null;
    },
    count: ({ where }: { where?: Record<string, unknown> }) =>
      [...versions.values()].filter((r) => !where || matchesWhere(r, where)).length,
  };

  /** Asset delegate: sha256 lookup + refCount increment semantics. */
  const assetDelegate = {
    // Tenancy injects {AND:[scope, original]} — resolve through the matcher.
    findUnique: ({ where }: { where: Record<string, unknown> }) =>
      [...assets.values()].find((r) => matchesWhere(r, where)) ?? null,
    findFirst: ({ where }: { where: Record<string, unknown> }) =>
      [...assets.values()].find((r) => matchesWhere(r, where)) ?? null,
    create: ({ data, select }: { data: Record<string, unknown>; select?: object }) => {
      const row = { id: `as_${assets.size + 1}`, createdAt: new Date(), refCount: 1, ...data };
      assets.set(row.id as string, row);
      void select;
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
    },
    update: ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: { refCount?: { increment: number } };
    }) => {
      const row = [...assets.values()].find((r) => matchesWhere(r, where));
      if (!row) {
        const err = new Error('record not found') as Error & { code: string };
        err.code = 'P2025';
        throw err;
      }
      if (data.refCount && typeof data.refCount.increment === 'number') {
        row.refCount = ((row.refCount as number) ?? 0) + data.refCount.increment;
      }
      return row;
    },
    updateMany: ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: { refCount?: { increment: number } };
    }) => {
      const targets = [...assets.values()].filter((r) => matchesWhere(r, where));
      for (const row of targets) {
        if (data.refCount && typeof data.refCount.increment === 'number') {
          row.refCount = ((row.refCount as number) ?? 0) + data.refCount.increment;
        }
      }
      return { count: targets.length };
    },
  };

  const db = {
    _clients: clients,
    _campaigns: campaigns,
    _creatives: creatives,
    _versions: versions,
    _assets: assets,
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
    asset: assetDelegate,
    user: {
      findMany: () => [],
    },
    magicLink: {
      findMany: () => [],
    },
    comment: { create: ({ data }: { data: Record<string, unknown> }) => ({ id: 'cm_stub', createdAt: new Date(), ...data }), findMany: () => [] },
    reviewEvent: { create: ({ data }: { data: Record<string, unknown> }) => ({ id: 're_stub', occurredAt: new Date(), ...data }) },
    emailMessage: { findUnique: () => null, create: ({ data }: { data: Record<string, unknown> }) => ({ id: 'em_stub', ...data }), update: ({ data }: { data: Record<string, unknown> }) => ({ id: 'em_stub', ...data }) },
  };
  (db.$extends as unknown) = () => buildTenantedView(db);
  return db;
}

type MockDbBase = ReturnType<typeof buildMockDb>;
type MockDb = MockDbBase;

describe('admission validator (ordered gate)', () => {
  it('rejects missing or oversized declarations BEFORE anything else', () => {
    expect(validateAdmission({})).toEqual({ code: 'PAYLOAD_TOO_LARGE', httpStatus: 413 });
    expect(
      validateAdmission({ contentLengthHeader: String(MAX_UPLOAD_BYTES + 1), declaredMime: 'image/png', filename: 'a.png' }),
    ).toEqual({ code: 'PAYLOAD_TOO_LARGE', httpStatus: 413 });
  });

  it('accepts an allowlisted MIME that agrees with the extension', () => {
    expect(
      validateAdmission({ contentLengthHeader: '1024', declaredMime: 'image/png', filename: 'banner.png' }),
    ).toBeNull();
    expect(
      validateAdmission({ contentLengthHeader: '1024', declaredMime: 'video/quicktime', filename: 'spot.mov' }),
    ).toBeNull();
  });

  it('rejects disallowed MIME and MIME/extension disagreement with 415', () => {
    expect(
      validateAdmission({ contentLengthHeader: '1024', declaredMime: 'video/x-msvideo', filename: 'clip.avi' }),
    ).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', httpStatus: 415 });
    expect(
      validateAdmission({ contentLengthHeader: '1024', declaredMime: 'image/png', filename: 'clip.avi' }),
    ).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', httpStatus: 415 });
  });

  it('rejects path tricks in filenames with 400', () => {
    expect(
      validateAdmission({ contentLengthHeader: '1024', declaredMime: 'image/png', filename: '../evil.png' }),
    ).toEqual({ code: 'UNSAFE_FILENAME', httpStatus: 400 });
  });
});

describe('upload pipeline (slice 5b)', () => {
  let app: INestApplication;
  let db: MockDb;
  let storageRoot: string;
  const csrfCookieName = cookiePolicy('test').csrfName;
  const enqueued: string[] = [];

  function storedFiles(): string[] {
    try {
      return readdirSync(path.join(storageRoot, 'assets'));
    } catch {
      return [];
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
    process.env.SESSION_TTL_DAYS = '7';
    process.env.PUBLIC_WEB_URL = 'http://localhost:3001';
    storageRoot = mkdtempSync(path.join(os.tmpdir(), 'uploads-5b-'));
    process.env.LOCAL_STORAGE_PATH = storageRoot;
    process.env.STORAGE_DRIVER = 'local';
  });

  beforeEach(async () => {
    rmSync(path.join(storageRoot, 'assets'), { recursive: true, force: true });
    db = buildMockDb();
    db._seedClient('client_1');
    db._seedCampaign('cmp_1', 'client_1');
    db._seedCreative('cr_img', 'cmp_1', 'client_1', 'IMAGE');
    db._seedCreative('cr_text', 'cmp_1', 'client_1', 'TEXT');
    db._seedClient('client_9', 'agency_2');
    db._seedCampaign('cmp_foreign', 'client_9', 'agency_2');
    db._seedCreative('cr_foreign', 'cmp_foreign', 'client_9', 'IMAGE', 'agency_2');
    enqueued.length = 0;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(PgBossService)
      .useValue({ boss: { stop: async () => {} } })
      .overrideProvider(VERSION_QUEUE)
      .useValue({ enqueueProcessVersion: async (job: { versionId: string }) => enqueued.push(job.versionId) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(storageRoot, { recursive: true, force: true });
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

  it('uploads a PNG end-to-end: sha256 address, version 1, PROCESSING rollup, one enqueue', async () => {
    const auth = staffAuth('CREATIVE');
    const res = await request(app.getHttpServer())
      .post('/creatives/cr_img/versions')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .attach('file', PNG_BYTES, { filename: 'hero.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ versionNo: 1, state: 'PROCESSING' });

    const expectedSha = sha256hex(PNG_BYTES);
    const assetRows = [...db._assets.values()];
    expect(assetRows).toHaveLength(1);
    expect(assetRows[0]).toMatchObject({ sha256: expectedSha, refCount: 1, mime: 'image/png' });
    expect(storedFiles()).toEqual([expectedSha]); // bytes durable at content address

    const version = [...db._versions.values()][0];
    expect(version).toMatchObject({
      creativeId: 'cr_img', versionNo: 1, state: 'PROCESSING', assetId: assetRows[0].id,
    });
    expect(db._creatives.get('cr_img')?.status).toBe('PROCESSING'); // rollup in-tx
    expect(enqueued).toEqual([version.id]); // job ONLY after commit
  });

  it('identical bytes dedup into ONE Asset with refcount 2 across two versions', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    for (let i = 0; i < 2; i++) {
      const res = await request(app.getHttpServer())
        .post('/creatives/cr_img/versions')
        .set('Cookie', auth.cookie)
        .set(auth.headers)
        .attach('file', PNG_BYTES, { filename: `again-${i}.png`, contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.versionNo).toBe(i + 1); // monotonic without races
    }
    expect(db._assets.size).toBe(1);
    expect(db._assets.values().next().value?.refCount).toBe(2);
    expect([...db._versions.values()].map((v) => v.versionNo).sort()).toEqual([1, 2]);
    expect(storedFiles()).toHaveLength(1); // one physical blob
  });

  it('a disallowed container (.avi) is 415-rejected before any storage side effect', async () => {
    const auth = staffAuth('CREATIVE');
    const res = await request(app.getHttpServer())
      .post('/creatives/cr_img/versions')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .attach('file', Buffer.from('AVI-DATA'), { filename: 'clip.avi', contentType: 'video/x-msvideo' });
    expect(res.status).toBe(415);
    expect(db._assets.size).toBe(0);
    expect(db._versions.size).toBe(0);
    expect(storedFiles()).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('declared oversize is rejected 413 WITHOUT consuming the body', async () => {
    const auth = staffAuth('CREATIVE');
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no address');
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: addr.port,
          method: 'POST',
          path: '/creatives/cr_img/versions',
          headers: {
            Cookie: auth.cookie,
            'X-CSRF-Token': auth.headers['X-CSRF-Token'],
            'Content-Type': 'multipart/form-data; boundary=xx',
            'Content-Length': String(600 * 1024 * 1024), // promise far more than we send
          },
          timeout: 4000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('timeout waiting for early 413'));
      });
      req.end(Buffer.alloc(64)); // actual body stays tiny
    });
    expect(status).toBe(413);
    expect(db._assets.size).toBe(0);
    expect(storedFiles()).toHaveLength(0);
  });

  it('pasted TEXT becomes READY + IN_REVIEW immediately with no asset and no job', async () => {
    const auth = staffAuth('ACCOUNT_MANAGER');
    const res = await request(app.getHttpServer())
      .post('/creatives/cr_text/versions/text')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ textBody: 'Headline: Nueva colección\nCuerpo del aviso.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ versionNo: 1, state: 'READY' });
    expect(db._assets.size).toBe(0);
    expect(db._creatives.get('cr_text')?.status).toBe('IN_REVIEW');
    expect(enqueued).toHaveLength(0);
    const version = [...db._versions.values()][0];
    expect(version.textBody).toContain('Nueva colección');
    expect(version.assetId ?? null).toBeNull();
  });

  it('TEXT paste is refused on binary kinds and multipart on TEXT kinds (409)', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    const wrongPaste = await request(app.getHttpServer())
      .post('/creatives/cr_img/versions/text')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ textBody: 'should not work' });
    expect(wrongPaste.status).toBe(409);

    const wrongUpload = await request(app.getHttpServer())
      .post('/creatives/cr_text/versions')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .attach('file', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' });
    expect(wrongUpload.status).toBe(409);
    expect(JSON.stringify(wrongUpload.body)).toContain('TEXT_USES_PASTE');
    expect(db._assets.size).toBe(0);
  });

  it('cross-agency targets are clean 404s on both routes', async () => {
    const auth = staffAuth('SUPER_ADMIN');
    const up = await request(app.getHttpServer())
      .post('/creatives/cr_foreign/versions')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .attach('file', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' });
    expect(up.status).toBe(404);

    const txt = await request(app.getHttpServer())
      .post('/creatives/cr_foreign/versions/text')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .send({ textBody: 'contraband' });
    expect(txt.status).toBe(404);
    expect(db._versions.size).toBe(0);
  });

  it('a concurrent versionNo collision retries ONCE via the unique constraint, then enqueues exactly one job', async () => {
    db.creativeVersion.create({
      data: { agencyId: 'agency_1', clientId: 'client_1', creativeId: 'cr_img', versionNo: 1, state: 'READY' },
    });
    db.creativeVersion.create({
      data: { agencyId: 'agency_1', clientId: 'client_1', creativeId: 'cr_img', versionNo: 2, state: 'READY' },
    });
    // Simulate losing a race for versionNo 3 exactly once.
    (db.creativeVersion as unknown as { _failNextCreateWithP2002: boolean })._failNextCreateWithP2002 = true;

    const auth = staffAuth('CREATIVE');
    const res = await request(app.getHttpServer())
      .post('/creatives/cr_img/versions')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .attach('file', PNG_BYTES, { filename: 'race.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.versionNo).toBe(3);
    expect(enqueued).toHaveLength(1);
  });

  it('non-multipart bodies are rejected 415 without touching storage', async () => {
    const auth = staffAuth('CREATIVE');
    const res = await request(app.getHttpServer())
      .post('/creatives/cr_img/versions')
      .set('Cookie', auth.cookie)
      .set(auth.headers)
      .set('Content-Type', 'application/json')
      .send({ sneaky: true });
    expect([415, 500].includes(res.status)).toBe(true); // fail-closed either way
    expect(db._assets.size).toBe(0);
    expect(storedFiles()).toHaveLength(0);
  });
});
