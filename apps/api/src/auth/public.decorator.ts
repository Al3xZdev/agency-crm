import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as unauthenticated (health probes, login itself).
 * SessionGuard and CsrfGuard both honor it.
 */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);
