import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { requestAls, type RequestContext } from '../tenancy/request-context.als';

/**
 * Opens the AsyncLocalStorage context around the route handler chain
 * (task 2.5). Guards run before interceptors and cannot wrap downstream
 * execution, so SessionGuard stashes the context on the request and this
 * interceptor is what actually scopes it for controllers and services.
 */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { __requestContext?: RequestContext }>();
    const store = req.__requestContext;
    if (!store) return next.handle();
    return requestAls.run(store, () => next.handle());
  }
}
