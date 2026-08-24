import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/roles.decorator';
import { currentPrincipal } from '../tenancy/request-context.als';

const createStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  displayName: z.string().min(1).max(80),
  role: z.enum(['SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE']),
});

const updateStaffSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE']).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Staff management (task 2.7) — SUPER_ADMIN only.
 * Soft-deactivation keeps the audit trail intact: deactivated users cannot
 * log in, and their live sessions are revoked immediately.
 */
@Controller('staff')
export class StaffController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  async list() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  @Roles('SUPER_ADMIN')
  async create(@Body() body: unknown): Promise<{ id: string }> {
    const data = createStaffSchema.parse(body);
    const agencyId = currentPrincipal()?.agencyId;
    if (!agencyId) throw new HttpException({ statusCode: 403 }, 403);

    try {
      return await this.prisma.user.create({
        data: {
          agencyId,
          email: data.email.toLowerCase(),
          passwordHash: await hash(data.password),
          displayName: data.displayName,
          role: data.role,
        },
        select: { id: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new HttpException({ statusCode: 409, message: 'EMAIL_TAKEN' }, 409);
      }
      throw e;
    }
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const data = updateStaffSchema.parse(body);
    if (data.isActive === false) await this.revokeSessions(id);
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, role: true, isActive: true },
    });
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  async deactivate(@Param('id') id: string) {
    await this.revokeSessions(id);
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, isActive: true },
    });
  }

  private revokeSessions(userId: string) {
    return this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
