import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { MagicLinksModule } from './magic-links/magic-links.module';
import { ClientsModule } from './clients/clients.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CreativesModule } from './creatives/creatives.module';
import { UploadsModule } from './uploads/uploads.module';
import { JobsModule } from './jobs/jobs.module';
import { MediaModule } from './media/media.module';
import { VersionsModule } from './versions/versions.module';
import { CommentsModule } from './comments/comments.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ClientModule } from './client/client.module';
import { SessionGuard } from './auth/session.guard';
import { CsrfGuard } from './auth/csrf.guard';
import { RolesGuard } from './auth/roles.guard';
import { ContextInterceptor } from './auth/context.interceptor';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { AppHeadersModule } from './common/app-headers.module';

/**
 * Global gate order (spec Cap 1 / Cap 3):
 *   SessionGuard → CsrfGuard → RolesGuard → ContextInterceptor(ALS) → handler
 * Guards cannot wrap downstream execution in ALS (no `next`), so the
 * interceptor is what scopes the principal for controllers and services.
 */
@Module({
  imports: [ConfigModule, PrismaModule, TenancyModule, AppHeadersModule, HealthModule, AuthModule, MagicLinksModule, StaffModule, ClientsModule, CampaignsModule, CreativesModule, UploadsModule, JobsModule, MediaModule, VersionsModule, CommentsModule, ReviewsModule, ClientModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ContextInterceptor },
  ],
})
export class AppModule {}
