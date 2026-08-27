import { Readable } from 'node:stream';

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the AWS SDK before importing the driver
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((input) => input),
  GetObjectCommand: vi.fn().mockImplementation((input) => input),
  HeadObjectCommand: vi.fn().mockImplementation((input) => input),
}));

const { S3StorageDriver } = await import('../../src/storage/s3.driver');

function streamFrom(buf: Buffer): Readable {
  return new Readable({
    read() {
      this.push(buf);
      this.push(null);
    },
  });
}

describe('S3StorageDriver', () => {
  let driver: S3StorageDriver;

  beforeEach(() => {
    mockSend.mockReset();
    driver = new S3StorageDriver({
      endpoint: 'http://localhost:3900',
      bucket: 'test-bucket',
      accessKey: 'test-key',
      secretKey: 'test-secret',
    });
  });

  describe('admit', () => {
    it('uploads and returns correct sha256 and storageKey', async () => {
      const data = Buffer.from('hello world');
      const expectedSha256 = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

      mockSend.mockResolvedValueOnce({});

      const result = await driver.admit(streamFrom(data), data.length);

      expect(result.sha256).toBe(expectedSha256);
      expect(result.byteSize).toBe(11);
      expect(result.storageKey).toBe(`assets/${expectedSha256}`);
      expect(mockSend).toHaveBeenCalledOnce();
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.Bucket).toBe('test-bucket');
      expect(cmd.Key).toBe(expectedSha256);
    });

    it('rejects on SIZE_MISMATCH', async () => {
      const data = Buffer.from('hello');
      mockSend.mockResolvedValueOnce({});

      await expect(driver.admit(streamFrom(data), 999)).rejects.toThrow(
        'SIZE_MISMATCH declared=999 actual=5',
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('works without declaredByteSize', async () => {
      const data = Buffer.from('test');
      mockSend.mockResolvedValueOnce({});

      const result = await driver.admit(streamFrom(data));

      expect(result.sha256).toBe(
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      );
      expect(result.byteSize).toBe(4);
    });
  });

  describe('openRead', () => {
    it('throws on invalid storageKey', () => {
      expect(() => driver.openRead('invalid')).toThrow('INVALID_STORAGE_KEY');
      expect(() => driver.openRead('assets/../../etc/passwd')).toThrow('INVALID_STORAGE_KEY');
    });

    it('streams S3 object body on read', async () => {
      const content = Buffer.from('file content');
      const key = 'assets/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

      mockSend.mockResolvedValueOnce({
        Body: {
          transformToByteArray: async () => content,
        },
      });

      const readable = driver.openRead(key);
      const chunks: Buffer[] = [];
      for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('file content');
    });
  });

  describe('head', () => {
    it('returns null for invalid key', async () => {
      expect(await driver.head('invalid')).toBeNull();
    });

    it('returns byteSize on success', async () => {
      const key = 'assets/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
      mockSend.mockResolvedValueOnce({ ContentLength: 1234 });

      const result = await driver.head(key);
      expect(result).toEqual({ byteSize: 1234 });
    });

    it('returns null on NotFoundError', async () => {
      const key = 'assets/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
      const notFound = new Error('not found');
      notFound.name = 'NotFound';
      mockSend.mockRejectedValueOnce(notFound);

      const result = await driver.head(key);
      expect(result).toBeNull();
    });
  });
});
