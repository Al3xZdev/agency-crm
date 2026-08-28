import { Controller, Get, Query } from '@nestjs/common';

import { Roles } from '../auth/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/stats')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  stats() {
    return this.dashboard.getStats();
  }

  @Get('dashboard/activity')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  activity(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.dashboard.getActivity(limit ? Number(limit) : undefined, cursor);
  }
}
