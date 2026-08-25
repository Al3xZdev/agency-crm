import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { currentPrincipal } from '../tenancy/request-context.als';
import { AuthService } from './auth.service';
import { clearSessionCookies, setSessionCookies } from './session-cookies';
import { Public } from './public.decorator';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Env,
  ) {}

  /** Generic 401 for unknown email AND wrong password (spec Cap 1). */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const { email, password } = loginSchema.parse(body);
    const { rawToken, csrfToken } = await this.auth.login(email, password, this.config.SESSION_TTL_DAYS);
    setSessionCookies(res, this.config, { rawToken, csrfToken });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() _req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const sessionId = currentPrincipal()?.sessionId;
    if (sessionId) await this.auth.logout(sessionId);
    clearSessionCookies(res, this.config);
  }
}
