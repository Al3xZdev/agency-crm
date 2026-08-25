import type { Readable } from 'node:stream';

/** Result of a successful admission into content-addressed storage. */
export interface AdmitResult {
  /** Authoritative sha256 of the stored bytes (computed while streaming). */
  sha256: string;
  byteSize: number;
  /** Driver-relative key, e.g. `assets/{sha256}`. */
  storageKey: string;
}

/**
 * Storage abstraction (task 5b.1). The upload pipeline depends on this port
 * only; drivers are selected by the STORAGE_DRIVER env seam. `admit` streams
 * the request body to its final content address; `openRead`/`head` back the
 * media routes (slice 6) and size verification respectively.
 */
export interface StorageDriver {
  readonly kind: 'local' | 's3';
  admit(stream: Readable, declaredByteSize?: number): Promise<AdmitResult>;
  openRead(storageKey: string): Readable;
  head(storageKey: string): Promise<{ byteSize: number } | null>;
}
