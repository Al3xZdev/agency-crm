import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';
import { currentPrincipal } from '../tenancy/request-context.als';

const updateAgencySchema = z.object({
  name: z.string().min(1).max(120),
});

@Injectable()
export class AgencyService {
  constructor(private readonly prisma: PrismaService) {}

  private agencyId(): string {
    const principal = currentPrincipal();
    if (!principal?.agencyId) throw new NotFoundException();
    return principal.agencyId;
  }

  async get() {
    const agency = await this.prisma.agency.findFirst({
      where: { id: this.agencyId() },
      select: { id: true, name: true, createdAt: true },
    });
    if (!agency) throw new NotFoundException();
    return agency;
  }

  async update(body: unknown) {
    const data = updateAgencySchema.parse(body);
    const agency = await this.prisma.agency.update({
      where: { id: this.agencyId() },
      data,
      select: { id: true, name: true, createdAt: true },
    });
    return agency;
  }
}
