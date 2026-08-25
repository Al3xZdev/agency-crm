import { Body, Controller, Param, Post } from '@nestjs/common';
import { castDecisionSchema } from '@agency-crm/shared';

import { Roles } from '../auth/roles.decorator';
import { currentPrincipal } from '../tenancy/request-context.als';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('versions/:versionId/decision')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  castDecision(@Param('versionId') versionId: string, @Body() body: unknown) {
    const dto = castDecisionSchema.parse(body);
    const principal = currentPrincipal()!;
    return this.reviews.castDecision(versionId, dto, principal);
  }
}
