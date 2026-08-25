import { Controller, Get, Param } from '@nestjs/common';

import { Roles } from '../auth/roles.decorator';
import { VersionsService } from './versions.service';

@Controller()
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Get('creatives/:creativeId/versions')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  listByCreative(@Param('creativeId') creativeId: string) {
    return this.versions.listByCreative(creativeId);
  }

  @Get('versions/:versionId')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  getDetail(@Param('versionId') versionId: string) {
    return this.versions.getDetail(versionId);
  }
}
