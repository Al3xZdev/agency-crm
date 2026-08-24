import { AsyncLocalStorage } from 'node:async_hooks';
import type { StaffRole } from '@prisma/client';

/**
 * Request-scoped principal context (task 2.5, minimal slice-2 shape).
 *
 * The SessionGuard populates it; downstream code (CsrfGuard, RolesGuard,
 * tenancy extension in S3, audit fields) reads it. Nothing else may create
 * contexts.
 */
export interface Principal {
  kind: 'STAFF' | 'CLIENT';
  agencyId: string;
  sessionId: string;
  /** STAFF only */
  userId?: string;
  role?: StaffRole;
  /** CLIENT only */
  clientId?: string;
  magicLinkId?: string;
}

export interface RequestContext {
  principal: Principal;
  /** Session-bound CSRF secret; never exposed to the client. */
  csrfSecret: string;
}

export const requestAls = new AsyncLocalStorage<RequestContext>();

/** Current principal or undefined outside a guarded request. */
export function currentPrincipal(): Principal | undefined {
  return requestAls.getStore()?.principal;
}
