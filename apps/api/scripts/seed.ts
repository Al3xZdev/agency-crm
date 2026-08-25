/**
 * Seed CLI (slice 5a): `pnpm --filter @agency-crm/api db:seed`
 *
 * Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from the environment and
 * creates the first SUPER_ADMIN if missing. Safe to run on every boot
 * (compose migrate service can call it after `migrate deploy`).
 *
 * Runs under Node >= 22.6 type stripping — no ts runtime dependency.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { ensureInitialAdmin } from '../src/seed/ensure-initial-admin.ts';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error(
      'seed: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to bootstrap the first admin',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const result = await ensureInitialAdmin(prisma.user, { email, password }, hash);
    console.log(
      result.created
        ? `seed: created initial SUPER_ADMIN ${email}`
        : `seed: SUPER_ADMIN ${email} already exists, leaving untouched`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
