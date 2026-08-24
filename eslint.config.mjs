// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Spec Cap 3 "Raw-SQL ban enforced in CI": application code must never use the
 * Prisma raw-SQL escape hatches — ALL data access flows through the tenancy-scoped
 * data layer. Applied to apps/api/src/**; see apps/api/src/lint-ban.meta.spec.ts
 * for the meta-fixture proof that violations fail lint.
 */
export const rawSqlBanRule = {
  'no-restricted-properties': [
    'error',
    { property: '$queryRaw', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
    { property: '$executeRaw', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
    { property: '$queryRawUnsafe', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
    { property: '$executeRawUnsafe', message: 'Raw SQL is banned: use the tenancy-scoped Prisma data layer.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', '**/next-env.d.ts'] },
  tseslint.configs.recommended,
  {
    files: ['apps/api/src/**/*.ts'],
    rules: { ...rawSqlBanRule },
  },
);
