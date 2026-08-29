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
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import { Roles } from '../auth/roles.decorator';
import { currentPrincipal } from '../tenancy/request-context.als';
import { TenancyService } from '../tenancy/tenancy.service';

const CREATIVE_KINDS = ['IMAGE', 'VIDEO', 'TEXT'] as const;
const CREATIVE_STATUSES = ['DRAFT', 'PROCESSING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'UPLOAD_FAILED'] as const;

const listAllQuerySchema = z.object({
  search: z.string().max(160).optional(),
  status: z.enum(CREATIVE_STATUSES).optional(),
  kind: z.enum(CREATIVE_KINDS).optional(),
});

const createCreativeSchema = z.object({
  title: z.string().min(1).max(160),
  kind: z.enum(CREATIVE_KINDS),
});

const updateCreativeSchema = z.object({
  // NOTE: kind is deliberately absent — fixed at creation (gates comment
  // anchors later); update attempts silently ignore any `kind` in the body.
  title: z.string().min(1).max(160).optional(),
});

/**
 * Creative management (task 5a.4) — nested under the owning campaign.
 * New creatives start DRAFT until the first version exists (rollup takes
 * over in slice 5b).
 */
@Injectable()
export class CreativesService {
  constructor(private readonly tenancy: TenancyService) {}

  async create(campaignId: string, body: unknown): Promise<{ id: string; kind: string; status: string }> {
    const data = createCreativeSchema.parse(body);
    const principal = currentPrincipal();
    if (!principal) throw new NotFoundException();
    const db = this.tenancy.scoped();
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId },
      select: { id: true, clientId: true },
    });
    if (!campaign) throw new NotFoundException();
    const created = await db.creative.create({
      data: {
        agencyId: principal.agencyId,
        clientId: campaign.clientId,
        campaignId,
        title: data.title,
        kind: data.kind,
        status: 'DRAFT',
        createdById: principal.userId ?? '',
      },
      select: { id: true, kind: true, status: true },
    });
    return created;
  }

  async listByCampaign(campaignId: string) {
    const db = this.tenancy.scoped();
    const campaign = await db.campaign.findFirst({ where: { id: campaignId }, select: { id: true } });
    if (!campaign) throw new NotFoundException();
    return db.creative.findMany({
      where: { campaignId },
      select: { id: true, title: true, kind: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listAll(query: unknown) {
    const data = listAllQuerySchema.parse(query);
    const where: Record<string, unknown> = {};
    if (data.status) where.status = data.status;
    if (data.kind) where.kind = data.kind;
    if (data.search?.trim()) where.title = { contains: data.search.trim(), mode: 'insensitive' };

    const rows = await this.tenancy.scoped().creative.findMany({
      where,
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { name: true } },
        campaign: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      status: r.status,
      clientName: r.client.name,
      campaignName: r.campaign.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async get(id: string) {
    const row = await this.tenancy.scoped().creative.findFirst({
      where: { id },
      select: { id: true, clientId: true, campaignId: true, title: true, kind: true, status: true, createdAt: true },
    });
    if (!row) throw new NotFoundException();
    return row;
  }

  async update(id: string, body: unknown) {
    const data = updateCreativeSchema.parse(body);
    const db = this.tenancy.scoped();
    const row = await db.creative.findFirst({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException();
    return db.creative.update({
      where: { id },
      data,
      select: { id: true, title: true, kind: true, status: true },
    });
  }

  /** Versions arrive in 5b; the guard is already here so the contract holds. */
  async remove(id: string): Promise<{ ok: true }> {
    const db = this.tenancy.scoped();
    await db.$transaction(async (tx) => {
      const row = await tx.creative.findFirst({ where: { id }, select: { id: true } });
      if (!row) throw new NotFoundException();
      const versionCount = await tx.creativeVersion.count({ where: { creativeId: id } });
      if (versionCount > 0) throw new ConflictException('CREATIVE_HAS_VERSIONS');
      await tx.creative.delete({ where: { id } });
    });
    return { ok: true };
  }
}

@Controller()
export class CreativesController {
  constructor(private readonly creatives: CreativesService) {}

  @Post('campaigns/:campaignId/creatives')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  create(@Param('campaignId') campaignId: string, @Body() body: unknown) {
    return this.creatives.create(campaignId, body);
  }

  @Get('campaigns/:campaignId/creatives')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  list(@Param('campaignId') campaignId: string) {
    return this.creatives.listByCampaign(campaignId);
  }

  @Get('creatives')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  listAll(@Query() query: unknown) {
    return this.creatives.listAll(query);
  }

  @Get('creatives/:id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  get(@Param('id') id: string) {
    return this.creatives.get(id);
  }

  @Patch('creatives/:id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.creatives.update(id, body);
  }

  @Delete('creatives/:id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  remove(@Param('id') id: string) {
    return this.creatives.remove(id);
  }
}

@Module({
  providers: [CreativesService],
  controllers: [CreativesController],
  exports: [CreativesService],
})
export class CreativesModule {}
