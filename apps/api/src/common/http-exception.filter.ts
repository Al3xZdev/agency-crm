import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { TenancyViolation } from '../tenancy/tenancy.rules';

/**
 * Global exception mapping (hardening pass, audit findings 2/…):
 * - ZodError            -> 400 VALIDATION_ERROR (bodies are developer
 *                          errors, not server errors);
 * - Prisma P2002        -> 409 CONFLICT;
 * - Prisma P2025        -> 404 NOT_FOUND (the tenancy README's
 *                          "scoped miss reads as 404" convention);
 * - TenancyViolation    -> 404 (defensive: scope denials must never confirm
 *                          resource existence; normally the extension already
 *                          collapsed them into empty results);
 * - HttpException       -> passthrough (generic 401/403 bodies preserved);
 * - anything else       -> 500 with a fixed generic body, never leaking
 *                          internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof ZodError || (exception instanceof Error && exception.name === 'ZodError')) {
      res.status(400).json({ statusCode: 400, message: 'VALIDATION_ERROR' });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        res.status(409).json({ statusCode: 409, message: 'CONFLICT' });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(404).json({ statusCode: 404, message: 'NOT_FOUND' });
        return;
      }
    }
    if (exception instanceof TenancyViolation) {
      res.status(404).json({ statusCode: 404, message: 'NOT_FOUND' });
      return;
    }
    console.error('[AllExceptionsFilter] Unhandled error:', exception);
    res.status(500).json({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  }
}
