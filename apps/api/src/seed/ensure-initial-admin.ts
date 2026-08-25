/**
 * First-run bootstrap (slice 5a addition): creates the initial SUPER_ADMIN
 * from environment so a fresh deployment can actually log in. Idempotent —
 * an existing account is never modified or duplicated.
 *
 * Kept dependency-free and structurally typed so both the real PrismaClient
 * and test mocks satisfy the parameter.
 */

export interface SeedAdminInput {
  email: string;
  password: string;
}

export interface UserLike {
  findFirst(args: {
    where: { email: string };
    select?: Record<string, boolean>;
  }): Promise<{ id: string } | null>;
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
}

export type PasswordHasher = (password: string) => Promise<string>;

export async function ensureInitialAdmin(
  users: UserLike,
  input: SeedAdminInput,
  hash: PasswordHasher,
): Promise<{ created: boolean; userId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('SEED_ADMIN_EMAIL must be a valid email');
  if (input.password.length < 10) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
  }

  const existing = await users.findFirst({ where: { email }, select: { id: true } });
  if (existing) return { created: false, userId: existing.id };

  const created = await users.create({
    data: {
      email,
      passwordHash: await hash(input.password),
      displayName: 'Initial Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });
  return { created: true, userId: created.id };
}
