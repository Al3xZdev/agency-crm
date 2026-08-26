import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { createCommentSchema, castDecisionSchema } from '@agency-crm/shared';

import { currentPrincipal } from '../tenancy/request-context.als';
import { CommentsService } from '../comments/comments.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ClientService } from './client.service';

@Controller('c')
export class ClientController {
  constructor(
    private readonly client: ClientService,
    private readonly comments: CommentsService,
    private readonly reviews: ReviewsService,
  ) {}

  private requireClient() {
    const principal = currentPrincipal();
    if (!principal || principal.kind !== 'CLIENT') throw new ForbiddenException();
    return principal;
  }

  @Get('me')
  me() {
    const principal = this.requireClient();
    return this.client.getClientInfo(principal.clientId!);
  }

  @Get('creatives')
  listCreatives() {
    this.requireClient();
    return this.client.listCreatives();
  }

  @Get('versions/:versionId')
  getVersion(@Param('versionId') versionId: string) {
    const principal = this.requireClient();
    return this.client.getVersionDetail(versionId, principal.clientId!);
  }

  @Post('versions/:versionId/comments')
  postComment(@Param('versionId') versionId: string, @Body() body: unknown) {
    const principal = this.requireClient();
    const dto = createCommentSchema.parse(body);
    return this.comments.create(versionId, dto, principal);
  }

  @Post('versions/:versionId/decision')
  castDecision(@Param('versionId') versionId: string, @Body() body: unknown) {
    const principal = this.requireClient();
    const dto = castDecisionSchema.parse(body);
    return this.reviews.castDecision(versionId, dto, principal);
  }
}
