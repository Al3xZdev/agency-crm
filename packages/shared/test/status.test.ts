import { describe, expect, it } from 'vitest';
import { rollupStatus, type LatestVersionRef } from '../src/status';

const latest = (state: LatestVersionRef['state'], reviewStatus: LatestVersionRef['reviewStatus'] = 'NONE'): LatestVersionRef => ({
  state,
  reviewStatus,
});

describe('rollupStatus truth table (spec Cap 4 precise rule)', () => {
  it('no versions → DRAFT', () => {
    expect(rollupStatus(null)).toBe('DRAFT');
  });

  it('latest PROCESSING → PROCESSING (regardless of any stale review state)', () => {
    expect(rollupStatus(latest('PROCESSING'))).toBe('PROCESSING');
    expect(rollupStatus(latest('PROCESSING', 'APPROVED'))).toBe('PROCESSING');
  });

  it('latest READY undecided → IN_REVIEW', () => {
    expect(rollupStatus(latest('READY'))).toBe('IN_REVIEW');
    expect(rollupStatus(latest('READY', 'NONE'))).toBe('IN_REVIEW');
  });

  it('latest READY decided → that decision', () => {
    expect(rollupStatus(latest('READY', 'APPROVED'))).toBe('APPROVED');
    expect(rollupStatus(latest('READY', 'REJECTED'))).toBe('REJECTED');
    expect(rollupStatus(latest('READY', 'CHANGES_REQUESTED'))).toBe('CHANGES_REQUESTED');
  });

  it('latest FAILED → UPLOAD_FAILED (amendment 2026-08-24)', () => {
    // Scn "Failed upload flips rollup": v1 APPROVED + v2 FAILED ⇒ creative UPLOAD_FAILED.
    expect(rollupStatus(latest('FAILED'))).toBe('UPLOAD_FAILED');
    expect(rollupStatus(latest('FAILED', 'NONE'))).toBe('UPLOAD_FAILED');
  });
});
