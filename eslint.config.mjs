// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Spec Cap 3 "Raw-SQL ban enforced in CI": application code must never use the
 * Prisma raw-SQL escape hatches — ALL data access flows through the tenancy-scoped
 * data layer. Applied to apps/api/src/**.
 *
 * The RED/GREEN proof that violations fail lint lives in tools/scripts/lint-meta.mjs
 * (`pnpm lint:meta`) with fixtures under apps/api/test/lint-ban/** — ignored here
 * so this config never sees the intentional violation.
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
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', '**/next-env.d.ts', 'apps/api/test/lint-ban/**'] },
  tseslint.configs.recommended,
  {
    files: ['apps/api/src/**/*.ts'],
    rules: { ...rawSqlBanRule },
  },
  {
    // SYSTEM_PRISMA whitelist (task 2.2): only system modules may import the
    // raw-client token. Everything else goes through the tenancy-scoped data
    // layer. prisma/* infrastructure and the whitelisted consumers are exempt.
    files: ['apps/api/src/**/*.ts'],
    ignores: [
      'apps/api/src/prisma/**',
      'apps/api/src/auth/**',
      'apps/api/src/magic-links/**',
      'apps/api/src/mailer/**',
      'apps/api/src/jobs/**',
      'apps/api/src/health/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/prisma/system-prisma.token', '**/prisma/system-prisma.token.*'],
              message:
                'SYSTEM_PRISMA is restricted to Auth, MagicLinks, Mailer, Jobs and Health modules.',
            },
          ],
        },
      ],
    },
  },
);
