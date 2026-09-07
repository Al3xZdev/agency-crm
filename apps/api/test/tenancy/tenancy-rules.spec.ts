import { describe, expect, it } from 'vitest';
import type { Principal } from '../../src/tenancy/request-context.als';
import {
  DENIED,
  TENANTED_MODELS,
  applyOperation,
  assertDataInScope,
  findNestedRelationWrite,
  injectedWhere,
  scopeColumnsFor,
  TenancyViolation,
} from '../../src/tenancy/tenancy.rules';

const staff: Principal = { kind: 'STAFF', agencyId: 'a1', sessionId: 's1' };
const client: Principal = { kind: 'CLIENT', agencyId: 'a1', clientId: 'c1', sessionId: 's2' };

describe('tenancy registry (3.1)', () => {
  it('covers exactly the denormalized-scope models from the schema', () => {
    expect(Object.keys(TENANTED_MODELS).sort()).toEqual(
      ['Asset', 'Campaign', 'Client', 'Comment', 'Creative', 'CreativeVersion',
        'EmailMessage', 'MagicLink', 'ReviewEvent', 'Session', 'User'].sort(),
    );
  });

  it('marks composite models with both columns and staff models with agency only', () => {
    expect(TENANTED_MODELS.Campaign).toEqual(['agencyId', 'clientId']);
    expect(TENANTED_MODELS.User).toEqual(['agencyId']);
  });
});

describe('scopeColumnsFor', () => {
  it('gives STAFF the agency column on tenanted models', () => {
    expect(scopeColumnsFor('Campaign', staff)).toEqual(['agencyId']);
  });

  it('gives CLIENT the composite scope where clientId exists', () => {
    expect(scopeColumnsFor('Creative', client)).toEqual(['agencyId', 'clientId']);
  });

  it('denies CLIENT access to staff-only models', () => {
    expect(scopeColumnsFor('User', client)).toBe(DENIED);
    expect(scopeColumnsFor('Asset', client)).toBe(DENIED);
  });

  it('denies every principal on non-tenanted system models', () => {
    expect(scopeColumnsFor('SystemState', staff)).toBe(DENIED);
    expect(scopeColumnsFor('Agency', client)).toBe(DENIED);
  });
});

describe('injectedWhere', () => {
  it('ANDs scope into existing conditions for STAFF', () => {
    const where = injectedWhere('Campaign', staff, { status: 'ACTIVE' }) as Record<string, unknown>;
    expect(where).toEqual({ AND: [{ agencyId: 'a1' }, { status: 'ACTIVE' }] });
  });

  it('ANDs composite scope for CLIENT', () => {
    const where = injectedWhere('CreativeVersion', client) as Record<string, unknown>;
    expect(where).toEqual({ AND: [{ agencyId: 'a1', clientId: 'c1' }] });
  });

  it('returns DENIED for unauthorized model/principal pairs', () => {
    expect(injectedWhere('User', client, undefined)).toBe(DENIED);
  });
});

describe('assertDataInScope', () => {
  it('accepts records whose scope matches the principal', () => {
    expect(() => assertDataInScope('Campaign', client, { agencyId: 'a1', clientId: 'c1', name: 'x' })).not.toThrow();
  });

  it('rejects missing or mismatched scope columns', () => {
    expect(() => assertDataInScope('Campaign', client, { agencyId: 'a1', clientId: 'OTHER' })).toThrow(TenancyViolation);
    expect(() => assertDataInScope('User', staff, {})).toThrow(/does not match/);
  });

  it('rejects creates on denied models outright', () => {
    expect(() => assertDataInScope('SystemState', staff, { agencyId: 'a1' })).toThrow(TenancyViolation);
  });
});

describe('findNestedRelationWrite', () => {
  it('detects relation write payloads at their path', () => {
    expect(findNestedRelationWrite({ campaign: { connect: { id: 'x' } } })).toBe('campaign.connect');
    expect(findNestedRelationWrite({ items: { createMany: { data: [] } } })).toBe('items.createMany');
    expect(findNestedRelationWrite([{ meta: [{ upsert: {} }] }])).toBe('meta.upsert');
  });

  it('ignores scalars, dates, and plain nested data', () => {
    expect(findNestedRelationWrite({ name: 'x', dueAt: new Date(), meta: { a: 1 } })).toBeNull();
    expect(findNestedRelationWrite(null)).toBeNull();
  });
});

describe('applyOperation matrix (RED harness for container run)', () => {
  it('injects agency scope into reads for STAFF', () => {
    const args: Record<string, unknown> = {};
    applyOperation('Campaign', 'findMany', args, staff);
    expect(args.where).toEqual({ AND: [{ agencyId: 'a1' }] });
  });

  it('collapses denied reads to an unsatisfiable condition (routes map to 404)', () => {
    const args: Record<string, unknown> = {};
    applyOperation('User', 'findFirst', args, client);
    expect(args.where).toEqual({ id: '__tenancy_denied__' });
  });

  it('keeps original conditions when filtering writes', () => {
    const args: Record<string, unknown> = { where: { status: 'DRAFT' }, data: { title: 't' } };
    applyOperation('Campaign', 'updateMany', args, client);
    expect(args.where).toEqual({ AND: [{ agencyId: 'a1', clientId: 'c1' }, { status: 'DRAFT' }] });
  });

  it('rejects filtered writes on denied models', () => {
    expect(() => applyOperation('LoginAttempt', 'deleteMany', {}, staff)).toThrow(TenancyViolation);
  });

  it('passes scoped creates and rejects out-of-scope ones', () => {
    expect(() => applyOperation('Creative', 'create', { data: { agencyId: 'a1', clientId: 'c1' } }, client)).not.toThrow();
    expect(() => applyOperation('Creative', 'createMany', { data: [
      { agencyId: 'a1', clientId: 'c1' },
      { agencyId: 'a2', clientId: 'c9' },
    ] }, client)).toThrow(/does not match/);
  });

  it('rejects nested relation writes in create/update', () => {
    expect(() => applyOperation('Campaign', 'create', { data: {
      agencyId: 'a1', clientId: 'c1', campaign: { connect: { id: 'x' } },
    } }, client)).toThrow(/nested relation write/);
    expect(() => applyOperation('Campaign', 'update', {
      where: { id: 'k' }, data: { creatives: { create: {} } },
    }, staff)).toThrow(/is unsupported through the scoped layer/);
  });

  it('forbids upsert and raw operations through the scoped layer', () => {
    expect(() => applyOperation('Client', 'upsert', {}, staff)).toThrow(/is unsupported through the scoped layer/);
    expect(() => applyOperation('Client', '$queryRaw', {}, staff)).toThrow(/forbidden/);
  });

  it('fails closed on unknown operations and undefined models', () => {
    expect(() => applyOperation('Client', 'frobnicate', {}, staff)).toThrow(TenancyViolation);
    expect(() => applyOperation(undefined, 'findMany', {}, staff)).toThrow(TenancyViolation);
  });
});
