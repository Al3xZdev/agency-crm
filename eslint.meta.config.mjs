// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Standalone flat config used ONLY by `pnpm lint:meta` (tools/scripts/lint-meta.mjs).
 *
 * The main eslint.config.mjs ignores apps/api/test/lint-ban/** so day-to-day
 * `pnpm lint` stays green; this config re-includes that directory and applies
 * the Raw-SQL ban (spec Cap 3, task 1.5) to prove — RED/GREEN — that a
 * violating snippet actually fails lint while a clean one passes.
 */
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'] },
  tseslint.configs.recommended,
  {
    files: ['apps/api/test/lint-ban/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: '$queryRaw', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
        { property: '$executeRaw', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
        { property: '$queryRawUnsafe', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
        { property: '$executeRawUnsafe', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
      ],
    },
  },
);
