# Tenancy choke point (Slice 3)

All tenant-scoped persistence MUST go through `TenancyService.scoped()`. The
extended client injects `agencyId` (STAFF) or `agencyId` + `clientId` (CLIENT)
into every read and filtered write, asserts scope on creates, rejects nested
relation writes, forbids upsert/raw operations, and fails closed on unknown
operations.

## Error mapping convention

| Signal | HTTP | Meaning |
| --- | --- | --- |
| Role mismatch at guard (`@Roles`) | 403 | Authenticated, not authorized for the route |
| Scoped read yields no row | 404 | Route maps null to 404 — cross-tenant probing is indistinguishable from a missing row |

Never translate tenancy denials into 403: that would confirm resource
existence across tenant boundaries.

## System-level access

Background jobs, migrations, health checks, and session minting use
`SYSTEM_PRISMA` directly. The ESLint rule in `eslint.config.mjs` restricts the
token import to an explicit whitelist; anything else must go through the
scoped layer.

## Test coverage

- Unit matrix: `test/tenancy/tenancy-rules.spec.ts` covers the full decision
  layer (registry, scope columns, WHERE injection, create assertions, nested
  writes, forbidden ops) without a database.
- Container matrix (RED harness pending): the same `applyOperation` decisions
  exercised against real PostgreSQL via testcontainers, once a Docker-capable
  host exists. The unit suite is written to mirror those cases one-to-one.
