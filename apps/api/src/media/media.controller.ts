import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':key')
  async getAsset(
    @Param('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.media.stream(key, req, res);
  }
}
