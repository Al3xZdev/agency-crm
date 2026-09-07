import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { createCommentSchema } from '@agency-crm/shared';

import { Roles } from '../auth/roles.decorator';
import { currentPrincipal } from '../tenancy/request-context.als';
import { CommentsService } from './comments.service';

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('versions/:versionId/comments')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  create(@Param('versionId') versionId: string, @Body() body: unknown) {
    const dto = createCommentSchema.parse(body);
    const principal = currentPrincipal()!;
    return this.comments.create(versionId, dto, principal);
  }

  @Get('versions/:versionId/comments')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  list(@Param('versionId') versionId: string) {
    return this.comments.listByVersion(versionId, currentPrincipal());
  }
}
