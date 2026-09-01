import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // Accepts both `/media/<sha256>` (single segment) and the storageKey form
  // `/media/assets/<sha256>` the web builds from `asset.storageKey`.
  @Get('*')
  async getAsset(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = decodeURIComponent((req.path ?? '').replace(/^\/media\/?/, ''));
    if (!key) throw new NotFoundException();
    await this.media.stream(key, req, res);
  }
}
