import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';

import { updateCommentSchema } from '@agency-crm/shared';
import { Roles } from '../auth/roles.decorator';
import { currentPrincipal } from '../tenancy/request-context.als';
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

  @Delete('versions/:versionId/comments/:commentId')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  removeComment(@Param('versionId') versionId: string, @Param('commentId') commentId: string) {
    return this.versions.removeComment(versionId, commentId, currentPrincipal()!);
  }

  @Patch('versions/:versionId/comments/:commentId')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  updateComment(
    @Param('versionId') versionId: string,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ) {
    const dto = updateCommentSchema.parse(body);
    return this.versions.updateComment(versionId, commentId, dto, currentPrincipal()!);
  }

  @Delete('versions/:versionId')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  remove(@Param('versionId') versionId: string) {
    return this.versions.remove(versionId);
  }
}
