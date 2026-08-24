/**
 * Meta-fixture (RED proof) for the Raw-SQL ban — spec Cap 3, task 1.5.
 *
 * Intentionally touches `$queryRaw` so `pnpm lint:meta` can assert the ban
 * actually rejects violating code. Never imported or executed anywhere.
 */
interface RawClient {
  $queryRaw: unknown;
}

export function violating(client: RawClient): unknown {
  return client.$queryRaw;
}
