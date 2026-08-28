import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';

import { Roles } from '../auth/roles.decorator';
import { currentPrincipal } from '../tenancy/request-context.als';
import { TenancyService } from '../tenancy/tenancy.service';

const createCampaignSchema = z.object({
  name: z.string().min(1).max(120),
});

const updateCampaignSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, {
    message: 'at least one of name or status is required',
  });

/**
 * Campaign management (task 5a.3) — nested under the owning client.
 * Deleting a campaign that still has creatives is blocked in a transaction
 * (409 CAMPAIGN_NOT_EMPTY, spec Cap 4 "Delete campaign with creatives").
 */
@Injectable()
export class CampaignsService {
  constructor(private readonly tenancy: TenancyService) {}

  async create(clientId: string, body: unknown): Promise<{ id: string }> {
    const data = createCampaignSchema.parse(body);
    const principal = currentPrincipal();
    if (!principal) throw new NotFoundException();
    const db = this.tenancy.scoped();
    // Parent ownership check: tenancy makes foreign-agency clients invisible.
    const parent = await db.client.findFirst({ where: { id: clientId }, select: { id: true } });
    if (!parent) throw new NotFoundException();
    return db.campaign.create({
      data: { agencyId: principal.agencyId, clientId, name: data.name },
      select: { id: true },
    });
  }

  async listByClient(clientId: string) {
    const db = this.tenancy.scoped();
    const parent = await db.client.findFirst({ where: { id: clientId }, select: { id: true } });
    if (!parent) throw new NotFoundException();
    return db.campaign.findMany({
      where: { clientId },
      select: { id: true, clientId: true, name: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, body: unknown) {
    const data = updateCampaignSchema.parse(body);
    const db = this.tenancy.scoped();
    const row = await db.campaign.findFirst({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!row) throw new NotFoundException();
    return db.campaign.update({
      where: { id },
      data,
      select: { id: true, name: true, status: true },
    });
  }

  async remove(id: string): Promise<{ ok: true }> {
    const db = this.tenancy.scoped();
    await db.$transaction(async (tx) => {
      const row = await tx.campaign.findFirst({ where: { id }, select: { id: true } });
      if (!row) throw new NotFoundException();
      const creativeCount = await tx.creative.count({ where: { campaignId: id } });
      if (creativeCount > 0) throw new ConflictException('CAMPAIGN_NOT_EMPTY');
      await tx.campaign.delete({ where: { id } });
    });
    return { ok: true };
  }
}

@Controller()
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post('clients/:clientId/campaigns')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  create(@Param('clientId') clientId: string, @Body() body: unknown) {
    return this.campaigns.create(clientId, body);
  }

  @Get('clients/:clientId/campaigns')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  list(@Param('clientId') clientId: string) {
    return this.campaigns.listByClient(clientId);
  }

  @Patch('campaigns/:id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.campaigns.update(id, body);
  }

  @Delete('campaigns/:id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }
}

@Module({
  providers: [CampaignsService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
