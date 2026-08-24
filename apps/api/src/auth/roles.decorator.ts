import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given staff roles (task 2.7 / RolesGuard S3).
 * Routes without this metadata allow any authenticated principal; data-level
 * tenancy still applies from S3 onward.
 */
export const Roles = (...roles: StaffRole[]): MethodDecorator =>
  SetMetadata(ROLES_KEY, roles);
