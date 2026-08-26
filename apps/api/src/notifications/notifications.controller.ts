import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';

@Controller('emails')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  list(
    @Query('status') status?: string,
    @Query('template') template?: string,
  ) {
    return this.notifications.listEmails({ status, template });
  }

  @Patch(':id/handle')
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER')
  markHandled(@Param('id') id: string) {
    return this.notifications.markHandled(id);
  }
}
