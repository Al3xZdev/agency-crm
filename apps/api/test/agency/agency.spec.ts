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

function sha256hex(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

function signCsrf(secret: string): string {
  const nonce = randomBytes(16).toString('base64url');
  return `${nonce}.${createHmac('sha256', secret).update(nonce).digest('base64url')}`;
}

describe('agency API (PR1)', () => {
  let app: INestApplication;
  let db: MockDb;
  const csrfCookieName = cookiePolicy('test').csrfName;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
    process.env.SESSION_TTL_DAYS = '7';
    process.env.PUBLIC_WEB_URL = 'http://localhost:3001';
  });

  function buildMock() {
    const userRows: Record<string, Record<string, unknown>> = {
      u_admin: { id: 'u_admin', email: 'admin@agency.test', displayName: 'Admin', isActive: true, role: 'SUPER_ADMIN', agencyId: 'agency_1' },
      u_cm: { id: 'u_cm', email: 'mgr@agency.test', displayName: 'Manager', isActive: true, role: 'ACCOUNT_MANAGER', agencyId: 'agency_1' },
    };
    const agencies = new Map<string, Record<string, unknown>>([
      ['agency_1', { id: 'agency_1', name: 'Acme Agency', createdAt: new Date('2026-01-01T00:00:00Z') }],
    ]);
    const sessions = new Map<string, Record<string, unknown>>();

    const mock = {
      _seedSession(role: keyof typeof userRows) {
        return mock.session.create({
          data: {
            tokenHash: `h_${randomBytes(16).toString('hex')}`,
            kind: 'STAFF',
            agencyId: 'agency_1',
            userId: role,
            csrfSecret: 'agency-secret',
            expiresAt: new Date(Date.now() + 86_400_000),
            revokedAt: null,
          },
        });
      },
      $extends: null as unknown,
      $transaction: async <T>(fn: (tx: typeof mock) => Promise<T>): Promise<T> => fn(mock),
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
      user: {
        findUnique: ({ where }: { where: { id: string } }) => userRows[where.id] ?? null,
      },
      agency: {
        findFirst: ({ where }: { where: Record<string, unknown> }) => {
          const found = [...agencies.values()].find((r) => r.id === where.id) ?? null;
          return found ? { ...found } : null;
        },
        update: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const cur = agencies.get(where.id as string);
          if (!cur) throw new Error('NOT_FOUND');
          const next = { ...cur, ...data };
          agencies.set(where.id as string, next);
          return { ...next };
        },
      },
    } as unknown as MockDb;
    return mock;
  }

  beforeEach(async () => {
    db = buildMock();
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

  function staffAuth(role: 'u_admin' | 'u_cm'): { cookie: string; headers: Record<string, string> } {
    const raw = randomBytes(32).toString('base64url');
    const csrf = signCsrf('agency-secret');
    db.session.create({
      data: {
        tokenHash: sha256hex(raw),
        kind: 'STAFF',
        agencyId: 'agency_1',
        userId: role,
        csrfSecret: 'agency-secret',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      },
    });
    return { cookie: `${SESSION_COOKIE}=${raw}; ${csrfCookieName}=${csrf}`, headers: { 'X-CSRF-Token': csrf } };
  }

  describe('GET /agency', () => {
    it('returns the current agency for an authenticated staff member', async () => {
      const auth = staffAuth('u_admin');
      const res = await request(app.getHttpServer()).get('/agency').set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'agency_1',
        name: 'Acme Agency',
      });
    });
  });

  describe('PATCH /agency', () => {
    it('updates the agency name and returns the updated agency', async () => {
      const auth = staffAuth('u_cm');
      const res = await request(app.getHttpServer())
        .patch('/agency')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.headers['X-CSRF-Token'])
        .send({ name: 'Renamed Agency' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'agency_1', name: 'Renamed Agency' });
    });

    it('rejects an empty body with 400', async () => {
      const auth = staffAuth('u_admin');
      const res = await request(app.getHttpServer())
        .patch('/agency')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.headers['X-CSRF-Token'])
        .send({});
      expect(res.status).toBe(400);
    });
  });
});

type MockDb = ReturnType<typeof buildMock>;
