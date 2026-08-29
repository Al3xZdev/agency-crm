import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(80),
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

  private currentProfileSelect = {
    id: true,
    email: true,
    displayName: true,
    role: true,
    agencyId: true,
  } as const;

  private resolveCurrentUser() {
    const principal = currentPrincipal();
    const userId = principal?.userId;
    if (!userId) throw new HttpException({ statusCode: 401 }, 401);
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: this.currentProfileSelect,
    });
  }

  @Get('session')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  async session() {
    const user = await this.resolveCurrentUser();
    if (!user) throw new NotFoundException();
    return user;
  }

  @Post('change-password')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  @HttpCode(200)
  async changePassword(@Body() body: unknown): Promise<{ success: true }> {
    const data = changePasswordSchema.parse(body);
    const principal = currentPrincipal();
    const userId = principal?.userId;
    if (!userId) throw new HttpException({ statusCode: 401 }, 401);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new NotFoundException();

    const ok = await verify(user.passwordHash, data.currentPassword);
    if (!ok) throw new UnauthorizedException();

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(data.newPassword) },
      select: { id: true },
    });
    return { success: true };
  }

  @Patch('me')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  async updateMe(@Body() body: unknown) {
    const data = updateMeSchema.parse(body);
    const principal = currentPrincipal();
    const userId = principal?.userId;
    if (!userId) throw new HttpException({ statusCode: 401 }, 401);
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: this.currentProfileSelect,
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
