import { Prisma } from '@prisma/client';
import type { Principal } from './request-context.als';
import { applyOperation } from './tenancy.rules';

/**
 * Thin `$extends` glue (task 3.2): routes every model operation through the
 * pure decision layer in tenancy.rules.ts. All judgment lives there so the
 * matrix stays unit-testable without a database; container-based runs of the
 * real extension remain pending Docker evidence.
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
