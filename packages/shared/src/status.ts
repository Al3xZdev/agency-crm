/**
 * Creative/version lifecycle unions mirroring the Prisma enums in
 * apps/api/prisma/schema.prisma. Kept as plain string unions so the web and
 * api packages share one source of truth without importing the Prisma client.
 */

export type CreativeKind = 'IMAGE' | 'VIDEO' | 'TEXT';

export type VersionState = 'PROCESSING' | 'READY' | 'FAILED';

export type ReviewStatus = 'NONE' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

/**
 * Spec Cap 4 (amended 2026-08-24): UPLOAD_FAILED is a staff-visible-only
 * creative state reached when the LATEST version's post-processing FAILED.
 */
export type CreativeStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED'
  | 'UPLOAD_FAILED';

/** The latest version of a creative (max versionNo), or null when none exist. */
export interface LatestVersionRef {
  state: VersionState;
  reviewStatus: ReviewStatus;
}

/**
 * Spec Cap 4 "precise rule": Creative.status is derived SOLELY from the latest
 * version. Callers MUST recompute this inside the same transaction as the
 * triggering event (version created, worker finish/fail, decision cast).
 */
export function rollupStatus(latest: LatestVersionRef | null): CreativeStatus {
  if (latest === null) return 'DRAFT';
  switch (latest.state) {
    case 'PROCESSING':
      return 'PROCESSING';
    case 'FAILED':
      return 'UPLOAD_FAILED';
    case 'READY':
      return latest.reviewStatus === 'NONE' ? 'IN_REVIEW' : latest.reviewStatus;
  }
}
