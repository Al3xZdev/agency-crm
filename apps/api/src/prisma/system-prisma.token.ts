/**
 * System-level access to the raw Prisma client.
 *
 * IMPORT BAN: only Auth, MagicLinks, Mailer, Jobs and Health modules may
 * import this file (plus prisma/* infrastructure itself). Anything else must
 * go through the tenancy-scoped data layer (slice 3). Enforced by
 * eslint.config.mjs; RED/GREEN proof lives in tools/scripts/lint-meta.mjs.
 */
export const SYSTEM_PRISMA = Symbol('SYSTEM_PRISMA');
