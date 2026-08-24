/**
 * Meta-fixture (GREEN control) for the Raw-SQL ban — spec Cap 3, task 1.5.
 *
 * Uses only a non-banned Prisma client member so `pnpm lint:meta` can assert
 * the rule does not over-fire on legitimate code. Never imported or executed.
 */
interface SafeClient {
  $connect(): Promise<void>;
}

export async function connect(client: SafeClient): Promise<void> {
  await client.$connect();
}
