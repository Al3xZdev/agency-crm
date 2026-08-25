/**
 * First-run bootstrap (slice 5a addition): creates the initial SUPER_ADMIN
 * from environment so a fresh deployment can actually log in. Idempotent —
 * an existing account is never modified or duplicated.
 *
 * Also ensures a default Agency exists so the User FK is satisfied.
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

/**
 * Returns the first Agency id, creating a default one if none exists.
 */
async function ensureDefaultAgency(
  agencies: {
    findFirst(args: { where?: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  },
): Promise<string> {
  const existing = await agencies.findFirst({ select: { id: true } });
  if (existing) return existing.id;
  const created = await agencies.create({ data: { name: 'Mi Agencia' } });
  return created.id;
}

export async function ensureInitialAdmin(
  users: UserLike,
  input: SeedAdminInput,
  hash: PasswordHasher,
  agencies?: {
    findFirst(args: { where?: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  },
): Promise<{ created: boolean; userId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('SEED_ADMIN_EMAIL must be a valid email');
  if (input.password.length < 10) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
  }

  const existing = await users.findFirst({ where: { email }, select: { id: true } });
  if (existing) return { created: false, userId: existing.id };

  // Ensure an agency exists for the User FK.
  let agencyId: string | undefined;
  if (agencies) {
    agencyId = await ensureDefaultAgency(agencies);
  }

  const created = await users.create({
    data: {
      email,
      passwordHash: await hash(input.password),
      displayName: 'Initial Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
      ...(agencyId ? { agencyId } : {}),
    },
  });
  return { created: true, userId: created.id };
}
