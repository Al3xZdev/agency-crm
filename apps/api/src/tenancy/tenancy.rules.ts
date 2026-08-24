import type { Principal } from './request-context.als';

/**
 * Pure tenancy decision rules (spec Cap 3, tasks 3.1–3.3).
 *
 * Kept free of Prisma runtime dependencies so the full decision matrix is
 * unit-testable without a database. The `$extends` factory in
 * tenancy.extension.ts applies these rules to real queries; container-based
 * matrix runs stay pending until a Docker-capable host exists.
 */

export type ModelName = string;

/** Columns each model carries for tenant filtering, per schema §1. */
export const TENANTED_MODELS: Readonly<Record<ModelName, readonly string[]>> = {
  User: ['agencyId'],
  Session: ['agencyId'],
  MagicLink: ['agencyId', 'clientId'],
  Client: ['agencyId'],
  Campaign: ['agencyId', 'clientId'],
  Creative: ['agencyId', 'clientId'],
  Asset: ['agencyId'],
  CreativeVersion: ['agencyId', 'clientId'],
  Comment: ['agencyId', 'clientId'],
  ReviewEvent: ['agencyId', 'clientId'],
  EmailMessage: ['agencyId'],
};

export class TenancyViolation extends Error {
  constructor(message: string) {
    super(`TENANCY_VIOLATION: ${message}`);
    this.name = 'TenancyViolation';
  }
}

/** Sentinel: the principal may never see this model through the scoped layer. */
export const DENIED = Symbol('tenancy.denied');

export function isTenanted(model: string): boolean {
  return Object.hasOwn(TENANTED_MODELS, model);
}

/**
 * Column filters implied by the principal:
 * - STAFF  -> whole agency (`agencyId`)
 * - CLIENT -> composite scope (`agencyId` + `clientId`)
 * - Models lacking a `clientId` column are staff-only: a CLIENT principal
 *   gets DENIED for them (defense-in-depth behind route guards).
 * - Non-tenanted/system models are DENIED for everyone here; system modules
 *   must go through SYSTEM_PRISMA instead.
 */
export function scopeColumnsFor(model: string, principal: Principal): readonly string[] | typeof DENIED {
  const columns = TENANTED_MODELS[model];
  if (!columns) return DENIED;
  if (principal.kind === 'STAFF') {
    return columns.includes('agencyId') ? ['agencyId'] : DENIED;
  }
  if (principal.clientId === undefined) return DENIED;
  return columns.includes('clientId') ? ['agencyId', 'clientId'] : DENIED;
}

/**
 * WHERE injection for reads/updates/deletes: original conditions ANDed with
 * the principal's scope. DENIED collapses to an unsatisfiable condition so a
 * `findFirst` naturally yields null and routes map it to 404.
 */
export function injectedWhere(
  model: string,
  principal: Principal,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> | typeof DENIED {
  const columns = scopeColumnsFor(model, principal);
  if (columns === DENIED) return DENIED;
  const scope = Object.fromEntries(columns.map((c) => [c, columnValue(principal, c)]));
  return existing ? { AND: [scope, existing] } : { AND: [scope] };
}

function columnValue(principal: Principal, column: string): string {
  switch (column) {
    case 'agencyId':
      return principal.agencyId;
    case 'clientId':
      return principal.clientId!;
    default:
      throw new TenancyViolation(`unknown scope column ${column}`);
  }
}

/**
 * CREATE-time assertion: every denormalized scope column must be present and
 * match the principal exactly. Missing or mismatched values abort the write.
 */
export function assertDataInScope(
  model: string,
  principal: Principal,
  data: Record<string, unknown>,
): void {
  const columns = scopeColumnsFor(model, principal);
  if (columns === DENIED) {
    throw new TenancyViolation(`create on ${model} denied for ${principal.kind}`);
  }
  for (const column of columns) {
    if (data[column] !== columnValue(principal, column)) {
      throw new TenancyViolation(`${model}.${column} does not match principal scope`);
    }
  }
}

const RELATION_WRITE_KEYS = new Set(['connect', 'connectOrCreate', 'disconnect', 'set', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

/**
 * Conservative nested-write detector (design §3): relation payloads inside
 * create/update are rejected through the scoped layer — callers must perform
 * explicit, separately-scoped operations instead.
 */
export function findNestedRelationWrite(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findNestedRelationWrite(item, path);
      if (hit) return hit;
    }
    return null;
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (RELATION_WRITE_KEYS.has(key) && (typeof child === 'object' || Array.isArray(child))) {
      return nextPath;
    }
    const hit = findNestedRelationWrite(child, nextPath);
    if (hit) return hit;
  }
  return null;
}

const READ_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
]);
const FILTERED_WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UNSATISFIABLE_WHERE = { id: '__tenancy_denied__' } as const;

function asDataRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [value as Record<string, unknown>];
}

/**
 * Pure decision layer applied by the `$extends` glue: mutates `args` with
 * scope injections or throws `TenancyViolation`. Unknown operations fail
 * closed — new Prisma operations must be added to a set deliberately.
 */
export function applyOperation(
  model: string | undefined,
  operation: string,
  args: Record<string, unknown>,
  principal: Principal,
): void {
  if (!model || !isTenanted(model)) {
    throw new TenancyViolation(`operation ${operation} on non-tenanted target ${model ?? '(none)'}`);
  }
  if (READ_OPS.has(operation)) {
    const where = injectedWhere(model, principal, args.where as Record<string, unknown> | undefined);
    args.where = where === DENIED ? structuredClone(UNSATISFIABLE_WHERE) : where;
    return;
  }
  if (FILTERED_WRITE_OPS.has(operation)) {
    const where = injectedWhere(model, principal, args.where as Record<string, unknown> | undefined);
    if (where === DENIED) throw new TenancyViolation(`${operation} on ${model} denied for ${principal.kind}`);
    args.where = where;
    if (args.data !== undefined && findNestedRelationWrite(args.data)) {
      throw new TenancyViolation(`nested relation write at ${model}.${operation}: ${findNestedRelationWrite(args.data)}`);
    }
    return;
  }
  if (CREATE_OPS.has(operation)) {
    for (const record of asDataRecords(args.data)) {
      assertDataInScope(model, principal, record);
      const nested = findNestedRelationWrite(record);
      if (nested) throw new TenancyViolation(`nested relation write at ${model}.create: ${nested}`);
    }
    return;
  }
  throw new TenancyViolation(`operation ${operation} is forbidden through the scoped layer`);
}
