import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { currentPrincipal } from '../tenancy/request-context.als';
import { Roles } from '../auth/roles.decorator';
import { Public as IsPublic } from '../auth/public.decorator';
import { setSessionCookies } from '../auth/session-cookies';
import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { MagicLinksService } from './magic-links.service';

const mintSchema = z.object({
  recipientEmail: z.string().email().optional(),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

const redeemSchema = z.object({ token: z.string().min(20).max(200) });

const listSchema = z.object({
  clientId: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'revoked']).optional(),
});

/** Uniform failure body — unknown/expired/revoked are indistinguishable. */
const INVALID = { statusCode: 401, message: 'INVALID_LINK' };

@Controller()
export class MagicLinksController {
  constructor(
    private readonly magicLinks: MagicLinksService,
    @Inject(CONFIG) private readonly config: Env,
  ) {}

  /** Staff mints a client link; the URL appears exactly once in the response. */
  @Post('clients/:clientId/magic-links')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  async mint(
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; url: string; expiresAt: Date | null }> {
    const input = mintSchema.parse(body ?? {});
    return this.magicLinks.mint(currentPrincipal()!, clientId, input);
  }

  /** Flat listing (PR2) — SUPER_ADMIN/ACCOUNT_MANAGER only, per spec. */
  @Get('magic-links')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  async listAll(@Query() query: unknown) {
    const parsed = listSchema.parse(query);
    return this.magicLinks.listAll(parsed.clientId, parsed.status);
  }

  @Post('magic-links/:id/revoke')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  @HttpCode(200)
  async revoke(@Param('id') id: string): Promise<{ revokedSessions: number }> {
    return this.magicLinks.revoke(currentPrincipal()!, id);
  }

  /**
   * Public redemption surface called by the web `/c/[token]` page through the
   * same-origin proxy. Success sets the CLIENT session cookie pair; every
   * failure mode is the same generic body with NO Set-Cookie headers.
   */
  @IsPublic()
  @Post('magic-links/redeem')
  @HttpCode(200)
  async redeem(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException(INVALID);
    const redeemed = await this.magicLinks.redeem(parsed.data.token);
    if (!redeemed) throw new UnauthorizedException(INVALID);

    setSessionCookies(res, this.config, {
      rawToken: redeemed.rawToken,
      csrfToken: redeemed.csrfToken,
    });
    return { ok: true };
  }
}
