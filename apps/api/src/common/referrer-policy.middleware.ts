import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Token-leak hygiene (task 4.5): magic-link URLs must never leak through the
 * Referer header when a client surface links outward. Registered globally in
 * AppModule (not main.ts) so the integration suite asserts it too.
 */
@Injectable()
export class ReferrerPolicyMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  }
}
