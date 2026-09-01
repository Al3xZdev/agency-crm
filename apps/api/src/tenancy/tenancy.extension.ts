import { Prisma } from '@prisma/client';
import type { Principal } from './request-context.als';
import { applyOperation } from './tenancy.rules';

/**
 * Thin `$extends` glue (task 3.2): routes every model operation through the
 * pure decision layer in tenancy.rules.ts. All judgment lives there so the
 * matrix stays unit-testable without a database; container-based runs of the
 * real extension remain pending Docker evidence.
 *
 * Unique-selector operations are rejected by tenancy.rules.ts because the
 * injected scope cannot be expressed as a unique selector in Prisma 6.19.
 * They are intentionally NOT rerouted here: Prisma 6.19 does not support
 * `query(args, { operation: 'findFirst' })` rerouting inside `$allOperations`
 * (the query still deserializes as the original operation), and transaction
 * proxies do not expose `$extends`. Rerouting through the base client would
 * escape transactions, so the layer fails closed via TenancyViolation.
 */
export function tenancyQueryExtension(principal: Principal) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            applyOperation(model, operation, args as Record<string, unknown>, principal);
            return query(args);
          },
        },
      },
    }),
  );
}
