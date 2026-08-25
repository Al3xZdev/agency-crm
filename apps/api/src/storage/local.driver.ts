import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { AdmitResult, StorageDriver } from './storage.driver';

/** Streams bytes through while computing their sha256. */
class HashTransform extends Transform {
  readonly hash = createHash('sha256');
  byteSize = 0;

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.hash.update(chunk);
    this.byteSize += chunk.length;
    cb(null, chunk);
  }
}

/**
 * Content-addressed filesystem driver (task 5b.4): stream → sha256 tee →
 * temp file → size verify → ATOMIC rename into `{root}/assets/{sha256}`.
 * Identical bytes converge on one file, which is what makes the Asset
 * refcount dedup safe. Original bytes are never modified.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async admit(stream: Readable, declaredByteSize?: number): Promise<AdmitResult> {
    const assetsDir = path.join(this.root, 'assets');
    await mkdir(assetsDir, { recursive: true });

    const tmpPath = path.join(this.root, `upload-${randomUUID()}`);
    const tee = new HashTransform();
    try {
      await pipeline(stream, tee, createWriteStream(tmpPath));
      if (declaredByteSize !== undefined && tee.byteSize !== declaredByteSize) {
        throw new Error(`SIZE_MISMATCH declared=${declaredByteSize} actual=${tee.byteSize}`);
      }
      const sha256 = tee.hash.digest('hex');
      const storageKey = `assets/${sha256}`;
      const finalPath = path.join(this.root, storageKey);
      try {
        await stat(finalPath); // dedup: identical content already stored
        await unlink(tmpPath);
      } catch {
        await rename(tmpPath, finalPath); // atomic within the same volume
      }
      return { sha256, byteSize: tee.byteSize, storageKey };
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }

  openRead(storageKey: string): Readable {
    // Key format is driver-owned (`assets/{sha256}`); reject traversal.
    if (!/^assets\/[a-f0-9]{64}$/.test(storageKey)) {
      throw new Error(`INVALID_STORAGE_KEY ${storageKey}`);
    }
    return createReadStream(path.join(this.root, storageKey));
  }

  async head(storageKey: string): Promise<{ byteSize: number } | null> {
    if (!/^assets\/[a-f0-9]{64}$/.test(storageKey)) return null;
    try {
      const s = await stat(path.join(this.root, storageKey));
      return { byteSize: s.size };
    } catch {
      return null;
    }
  }
}
