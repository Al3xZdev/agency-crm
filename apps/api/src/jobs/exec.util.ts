import { execFile, type ExecFileOptions } from 'node:child_process';

export interface ExecResult {
  stdout: Buffer;
  stderr: Buffer;
}

export function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<ExecResult> {
  const options: ExecFileOptions = {
    shell: false,
    timeout: opts.timeoutMs ?? 30_000,
    maxBuffer: 50 * 1024 * 1024,
  };

  return new Promise<ExecResult>((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
        stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
      });
    });
  });
}
