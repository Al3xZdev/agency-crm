import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
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

interface StaffAuth {
  cookie: string;
  headers: Record<string, string>;
}

describe('staff session / profile (PR1)', () => {
  let app: INestApplication;
  let db: ReturnType<typeof buildMock>;
  const csrfCookieName = cookiePolicy('test').csrfName;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
    process.env.SESSION_TTL_DAYS = '7';
    process.env.PUBLIC_WEB_URL = 'http://localhost:3001';
  });

  function buildMock() {
    const users = new Map<string, Record<string, unknown>>();
    const sessions = new Map<string, Record<string, unknown>>();

    function pick<T extends Record<string, unknown>>(row: T, select: Record<string, unknown>): T {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(select)) {
        const child = (row as Record<string, unknown>)[k];
        const inner = v && typeof v === 'object' && 'select' in v ? (v as { select: Record<string, unknown> }).select : v;
        if (typeof inner === 'object' && inner !== null && child != null) out[k] = pick(child as Record<string, unknown>, inner);
        else if (inner === true) out[k] = child;
      }
      return out as T;
    }

    const mock = {
      $extends: null as unknown,
      $transaction: async <T>(fn: (tx: typeof mock) => Promise<T>): Promise<T> => fn(mock),
      _seedUser: async (id: string, overrides: Record<string, unknown> = {}) => {
        const row = {
          id,
          email: `${id}@agency.test`,
          displayName: 'Default Name',
          role: 'ACCOUNT_MANAGER',
          agencyId: 'agency_1',
          isActive: true,
          passwordHash: await hash('correct horse battery staple'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
          ...overrides,
        };
        users.set(id, row);
        return row;
      },
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
          if (s.userId) s.user = users.get(s.userId as string) ?? null;
          return s;
        },
      },
      user: {
        findUnique: ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
          const row = [...users.values()].find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
          if (!row) return null;
          return select ? pick(row, select) : { ...row };
        },
        update: ({ where, data, select }: { where: Record<string, unknown>; data: Record<string, unknown>; select?: Record<string, unknown> }) => {
          const cur = [...users.values()].find((r) => r.id === where.id);
          if (!cur) throw new Error('NOT_FOUND');
          const next = { ...cur, ...data };
          users.set(cur.id as string, next);
          return select ? pick(next, select) : { ...next };
        },
      },
    } as unknown as ReturnType<typeof buildMock>;
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

  async function staffAuth(id = 'u_1'): Promise<StaffAuth> {
    await db._seedUser(id);
    const raw = randomBytes(32).toString('base64url');
    const csrf = signCsrf('staff-secret');
    db.session.create({
      data: {
        tokenHash: sha256hex(raw),
        kind: 'STAFF',
        agencyId: 'agency_1',
        userId: id,
        csrfSecret: 'staff-secret',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      },
    });
    return { cookie: `${SESSION_COOKIE}=${raw}; ${csrfCookieName}=${csrf}`, headers: { 'X-CSRF-Token': csrf } };
  }

  describe('GET /staff/session', () => {
    it('returns the current staff member profile', async () => {
      const auth = await staffAuth();
      const res = await request(app.getHttpServer()).get('/staff/session').set('Cookie', auth.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'u_1',
        email: 'u_1@agency.test',
        displayName: 'Default Name',
        role: 'ACCOUNT_MANAGER',
        agencyId: 'agency_1',
      });
    });
  });

  describe('POST /staff/change-password', () => {
    it('changes password when the current password is correct', async () => {
      const auth = await staffAuth();
      const res = await request(app.getHttpServer())
        .post('/staff/change-password')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.headers['X-CSRF-Token'])
        .send({ currentPassword: 'correct horse battery staple', newPassword: 'a brand new long password' });
      expect(res.status).toBe(200);
    });

    it('rejects a wrong current password with 401', async () => {
      const auth = await staffAuth();
      const res = await request(app.getHttpServer())
        .post('/staff/change-password')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.headers['X-CSRF-Token'])
        .send({ currentPassword: 'wrong password', newPassword: 'a brand new long password' });
      expect(res.status).toBe(401);
    });

    it('rejects a too-short new password with 400', async () => {
      const auth = await staffAuth();
      const res = await request(app.getHttpServer())
        .post('/staff/change-password')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.headers['X-CSRF-Token'])
        .send({ currentPassword: 'correct horse battery staple', newPassword: 'short' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /staff/me', () => {
    it('updates the display name and returns the profile', async () => {
      const auth = await staffAuth();
      const res = await request(app.getHttpServer())
        .patch('/staff/me')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.headers['X-CSRF-Token'])
        .send({ displayName: 'Renamed User' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'u_1', displayName: 'Renamed User', email: 'u_1@agency.test' });
    });

    it('rejects an empty body with 400', async () => {
      const auth = await staffAuth();
      const res = await request(app.getHttpServer())
        .patch('/staff/me')
        .set('Cookie', auth.cookie)
        .set('X-CSRF-Token', auth.headers['X-CSRF-Token'])
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
