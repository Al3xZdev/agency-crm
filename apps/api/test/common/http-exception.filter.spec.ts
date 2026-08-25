import { describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AllExceptionsFilter } from '../../src/common/http-exception.filter';
import { TenancyViolation } from '../../src/tenancy/tenancy.rules';

function harness() {
  const responses: Array<{ code: number; body: unknown }> = [];
  const res = {
    status: (code: number) => ({
      json: (body: unknown) => responses.push({ code, body }),
    }),
  };
  const filter = new AllExceptionsFilter();
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as never;
  return { filter, host, responses };
}

function prismaKnown(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('msg', { code, clientVersion: 'test' });
}

describe('AllExceptionsFilter', () => {
  it('passes HttpException bodies through untouched', () => {
    const { filter, host, responses } = harness();
    filter.catch(new BadRequestException({ statusCode: 400, message: 'EMAIL_TAKEN' }), host);
    expect(responses).toEqual([{ code: 400, body: { statusCode: 400, message: 'EMAIL_TAKEN' } }]);
    void ForbiddenException;
  });

  it('maps ZodError to 400 VALIDATION_ERROR', () => {
    const { filter, host, responses } = harness();
    filter.catch(z.object({ email: z.string().email() }).safeParse({ email: 'x' }).error!, host);
    expect(responses).toEqual([{ code: 400, body: { statusCode: 400, message: 'VALIDATION_ERROR' } }]);
  });

  it('maps P2002 to 409 and P2025 to 404', () => {
    const { filter, host, responses } = harness();
    filter.catch(prismaKnown('P2002'), host);
    filter.catch(prismaKnown('P2025'), host);
    expect(responses.map((r) => r.code)).toEqual([409, 404]);
  });

  it('maps TenancyViolation to a defensive 404 (never confirms existence)', () => {
    const { filter, host, responses } = harness();
    filter.catch(new TenancyViolation('create on Campaign denied for CLIENT'), host);
    expect(responses).toEqual([{ code: 404, body: { statusCode: 404, message: 'NOT_FOUND' } }]);
  });

  it('maps unknown errors to a fixed generic 500 without leaking details', () => {
    const { filter, host, responses } = harness();
    filter.catch(new Error('super-secret-internal-detail'), host);
    expect(responses).toEqual([{ code: 500, body: { statusCode: 500, message: 'INTERNAL_SERVER_ERROR' } }]);
    void HttpException;
  });
});
