import { Injectable, Logger } from '@nestjs/common';

/**
 * Version post-processing queue port (task 5b.5 "enqueue after commit").
 * The real pg-boss wrapper arrives with slice 6; until then this dev
 * implementation records intent so the transaction boundary (enqueue ONLY
 * after commit) is already structural. Slice 6 swaps the provider, not the
 * call sites.
 */
export interface ProcessVersionJob {
  versionId: string;
}

export interface VersionQueue {
  enqueueProcessVersion(job: ProcessVersionJob): Promise<void>;
}

@Injectable()
export class DevVersionQueue implements VersionQueue {
  private readonly logger = new Logger('DevVersionQueue');

  async enqueueProcessVersion(job: ProcessVersionJob): Promise<void> {
    // Worker processing lands in slice 6; versions stay PROCESSING meanwhile.
    this.logger.log(`process-version requested for ${job.versionId} (worker arrives in S6)`);
  }
}
