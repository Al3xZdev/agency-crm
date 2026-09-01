import {
  Body,
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
import type { CampaignStatus, Prisma } from '@prisma/client';
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

const campaignListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  search: z.string().min(1).max(200).optional(),
});

/** Shared projection for every CampaignListItem-shaped response. */
const campaignListItemSelect = {
  id: true,
  clientId: true,
  name: true,
  status: true,
  createdAt: true,
  client: { select: { name: true } },
  _count: { select: { creatives: true } },
} satisfies Prisma.CampaignSelect;

type CampaignListRow = Prisma.CampaignGetPayload<{ select: typeof campaignListItemSelect }>;

export interface CampaignListItem {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  status: CampaignStatus;
  creativesCount: number;
  createdAt: Date;
}

export interface CreativeSummary {
  id: string;
  title: string;
  kind: string;
  status: string;
  currentVersionNo: number;
  updatedAt: Date;
}

export type CampaignDetail = CampaignListItem & { creatives: CreativeSummary[] };

/**
 * Campaign management (task 5a.3) — nested under the owning client.
 * Deleting a campaign cascade-deletes everything nested below it (creatives,
 * versions, comments and review events), temporarily suppressing the
 * append-only triggers inside the deletion transaction.
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

  private mapListItem(row: CampaignListRow): CampaignListItem {
    return {
      id: row.id,
      clientId: row.clientId,
      clientName: row.client?.name ?? 'Unknown client',
      name: row.name,
      status: row.status,
      creativesCount: row._count?.creatives ?? 0,
      createdAt: row.createdAt,
    };
  }

  /** Flat agency-wide listing (PR2): join Client for clientName, count
   * scoped creatives for creativesCount; optional enum status + case-
   * insensitive search over campaign name OR client name. */
  async listAll(status?: string, search?: string): Promise<CampaignListItem[]> {
    const where: Prisma.CampaignWhereInput = {};
    if (status) where.status = status as CampaignStatus;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.tenancy.scoped().campaign.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: campaignListItemSelect,
    });
    return rows.map((row) => this.mapListItem(row));
  }

  /** Campaign detail (PR2): CampaignListItem + creatives with currentVersionNo
   * = max versionNo of each creative (0 when the creative has no versions). */
  async getDetail(id: string): Promise<CampaignDetail> {
    const db = this.tenancy.scoped();
    const row = await db.campaign.findFirst({
      where: { id },
      select: campaignListItemSelect,
    });
    if (!row) throw new NotFoundException();

    const creatives = await db.creative.findMany({
      where: { campaignId: id },
      select: { id: true, title: true, kind: true, status: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const creativeIds = creatives.map((c) => c.id);
    const versions = creativeIds.length
      ? await db.creativeVersion.findMany({
          where: { creativeId: { in: creativeIds } },
          select: { creativeId: true, versionNo: true },
        })
      : [];
    const maxVersionNo = new Map<string, number>();
    for (const v of versions) {
      maxVersionNo.set(v.creativeId, Math.max(maxVersionNo.get(v.creativeId) ?? 0, v.versionNo));
    }

    return {
      ...this.mapListItem(row),
      creatives: creatives.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        status: c.status,
        currentVersionNo: maxVersionNo.get(c.id) ?? 0,
        updatedAt: c.updatedAt,
      })),
    };
  }

  async update(id: string, body: unknown): Promise<CampaignListItem> {
    const data = updateCampaignSchema.parse(body);
    const db = this.tenancy.scoped();
    const row = await db.campaign.findFirst({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!row) throw new NotFoundException();
    await db.campaign.updateMany({ where: { id }, data });
    // Re-read with the list projection so PATCH answers a full
    // CampaignListItem (clientName + creativesCount), per PR2 contract.
    const updated = await db.campaign.findFirst({
      where: { id },
      select: campaignListItemSelect,
    });
    if (!updated) throw new NotFoundException();
    return this.mapListItem(updated);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const db = this.tenancy.scoped();
    await db.$transaction(async (tx) => {
      const row = await tx.campaign.findFirst({ where: { id }, select: { id: true } });
      if (!row) throw new NotFoundException();

      // Collect every id nested below the campaign for cascade deletion.
      const creativeRows = await tx.creative.findMany({
        where: { campaignId: id },
        select: { id: true },
      });
      const creativeIds = creativeRows.map((c) => c.id);
      const versionRows = creativeIds.length
        ? await tx.creativeVersion.findMany({
            where: { creativeId: { in: creativeIds } },
            select: { id: true, assetId: true, posterAssetId: true },
          })
        : [];
      const versionIds = versionRows.map((v) => v.id);
      // Both the main asset and the optional video poster hold one reference each.
      const assetIds = Array.from(
        new Set(
          versionRows
            .flatMap((v) => [v.assetId, v.posterAssetId])
            .filter((a): a is string => a !== null),
        ),
      );

      // The comments and review events are guarded by append-only triggers that
      // REJECT any DELETE. Disable those triggers for the duration of this
      // transaction only, then re-enable in the finally block. Because the whole
      // body runs inside $transaction, an error rolls everything back anyway.
      try {
        await tx.$executeRawUnsafe('ALTER TABLE "Comment" DISABLE TRIGGER USER');
        await tx.$executeRawUnsafe('ALTER TABLE "ReviewEvent" DISABLE TRIGGER USER');

        // Delete in dependency order: comments + review events, then versions,
        // then creatives, then the campaign row.
        if (versionIds.length) {
          await tx.comment.deleteMany({ where: { versionId: { in: versionIds } } });
          await tx.reviewEvent.deleteMany({ where: { versionId: { in: versionIds } } });
        }
        if (creativeIds.length) {
          await tx.creativeVersion.deleteMany({ where: { creativeId: { in: creativeIds } } });
          await tx.creative.deleteMany({ where: { id: { in: creativeIds } } });
        }

        // Assets are content-addressed and shared by sha256. Release one
        // reference per freed slot, then remove assets nobody references any more.
        // Physical blob cleanup is out of scope (storage has no delete method).
        if (assetIds.length) {
          await tx.asset.updateMany({
            where: { id: { in: assetIds } },
            data: { refCount: { decrement: 1 } },
          });
          await tx.asset.deleteMany({ where: { id: { in: assetIds }, refCount: 0 } });
        }

        await tx.campaign.deleteMany({ where: { id } });
      } finally {
        await tx.$executeRawUnsafe('ALTER TABLE "Comment" ENABLE TRIGGER USER');
        await tx.$executeRawUnsafe('ALTER TABLE "ReviewEvent" ENABLE TRIGGER USER');
      }
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

  @Get('campaigns')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  listAll(@Query() query: unknown) {
    const parsed = campaignListQuerySchema.parse(query);
    return this.campaigns.listAll(parsed.status, parsed.search);
  }

  @Get('campaigns/:id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  detail(@Param('id') id: string) {
    return this.campaigns.getDetail(id);
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
