import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

import type { AdmitResult, StorageDriver } from './storage.driver';

export interface S3DriverConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}

/**
 * S3-compatible storage driver (Garage/S3). Stream → buffer → sha256 →
 * PutObject with content-addressed key `{sha256}`. Returns storageKey
 * `assets/{sha256}` for port compatibility with LocalStorageDriver.
 */
export class S3StorageDriver implements StorageDriver {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3DriverConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
  }

  private objectKey(sha256: string): string {
    return sha256;
  }

  private storageKey(sha256: string): string {
    return `assets/${sha256}`;
  }

  async admit(stream: Readable, declaredByteSize?: number): Promise<AdmitResult> {
    // Buffer all bytes, compute sha256, then PUT in one call.
    const chunks: Buffer[] = [];
    let byteSize = 0;
    const hash = createHash('sha256');

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        hash.update(chunk);
        byteSize += chunk.length;
        chunks.push(chunk);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    if (declaredByteSize !== undefined && byteSize !== declaredByteSize) {
      throw new Error(`SIZE_MISMATCH declared=${declaredByteSize} actual=${byteSize}`);
    }

    const sha256 = hash.digest('hex');
    const body = Buffer.concat(chunks);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(sha256),
        Body: body,
        ContentType: 'application/octet-stream',
        Metadata: {
          'content-sha256': sha256,
          'declared-byte-size': String(byteSize),
        },
      }),
    );

    return { sha256, byteSize, storageKey: this.storageKey(sha256) };
  }

  openRead(storageKey: string): Readable {
    if (!/^assets\/[a-f0-9]{64}$/.test(storageKey)) {
      throw new Error(`INVALID_STORAGE_KEY ${storageKey}`);
    }
    const sha256 = storageKey.slice('assets/'.length);
    const client = this.client;
    const bucket = this.bucket;

    // Lazy: fetch on first read(), buffer, then serve from memory.
    let fetched = false;
    let bodyBuffer: Buffer | null = null;
    let fetchError: Error | null = null;

    const readable = new Readable({
      async read() {
        if (!fetched) {
          fetched = true;
          try {
          const resp = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: sha256 }),
          );
          if (resp.Body) {
            const bytes = await resp.Body.transformToByteArray();
            bodyBuffer = Buffer.from(bytes);
          } else {
            bodyBuffer = Buffer.alloc(0);
          }
          } catch (err) {
            fetchError = err as Error;
          }
        }
        if (fetchError) {
          readable.destroy(fetchError);
          return;
        }
        if (bodyBuffer && bodyBuffer.length > 0) {
          readable.push(bodyBuffer);
          bodyBuffer = null;
        } else {
          readable.push(null);
        }
      },
    });

    return readable;
  }

  async head(storageKey: string): Promise<{ byteSize: number } | null> {
    if (!/^assets\/[a-f0-9]{64}$/.test(storageKey)) return null;
    const sha256 = storageKey.slice('assets/'.length);

    try {
      const resp = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: sha256 }),
      );
      return { byteSize: resp.ContentLength ?? 0 };
    } catch (err: unknown) {
      // S3NotFoundError / NotFound from AWS SDK
      if (
        err instanceof Error &&
        (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.name === 'S3NotFound')
      ) {
        return null;
      }
      throw err;
    }
  }
}
