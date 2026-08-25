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

const createClientSchema = z.object({
  name: z.string().min(1).max(120),
  contact: z.string().max(200).optional(),
});

const updateClientSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  contact: z.string().max(200).nullable().optional(),
});

/**
 * Client management (task 5a.2). Reads are open to all staff roles; writes
 * are SUPER_ADMIN/ACCOUNT_MANAGER only (spec Cap 3 — CREATIVE is denied
 * client management). All persistence goes through the tenancy-scoped
 * client, so cross-agency rows simply do not exist (404 convention).
 */
@Injectable()
export class ClientsService {
  constructor(private readonly tenancy: TenancyService) {}

  async list() {
    return this.tenancy.scoped().client.findMany({
      select: { id: true, name: true, contact: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(body: unknown): Promise<{ id: string }> {
    const data = createClientSchema.parse(body);
    const principal = currentPrincipal();
    if (!principal) throw new NotFoundException();
    return this.tenancy.scoped().client.create({
      data: { agencyId: principal.agencyId, name: data.name, contact: data.contact ?? null },
      select: { id: true },
    });
  }

  async update(id: string, body: unknown) {
    const data = updateClientSchema.parse(body);
    const db = this.tenancy.scoped();
    const row = await db.client.findFirst({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException();
    return db.client.update({
      where: { id },
      data,
      select: { id: true, name: true, contact: true },
    });
  }

  /** Deleting a client with any content is blocked (409), mirroring campaigns. */
  async remove(id: string): Promise<{ ok: true }> {
    const db = this.tenancy.scoped();
    const row = await db.client.findFirst({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException();
    const blocked = await db.$transaction(async (tx) => {
      const campaignCount = await tx.campaign.count({ where: { clientId: id } });
      const creativeCount = await tx.creative.count({ where: { clientId: id } });
      return campaignCount + creativeCount > 0;
    });
    if (blocked) throw new ConflictException('CLIENT_HAS_CONTENT');
    await db.client.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  list() {
    return this.clients.list();
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  create(@Body() body: unknown) {
    return this.clients.create(body);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.clients.update(id, body);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  remove(@Param('id') id: string) {
    return this.clients.remove(id);
  }
}

@Module({
  providers: [ClientsService],
  controllers: [ClientsController],
  exports: [ClientsService],
})
export class ClientsModule {}
