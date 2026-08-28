import { Body, Controller, Get, Patch } from '@nestjs/common';

import { Roles } from '../auth/roles.decorator';
import { AgencyService } from './agency.service';

@Controller('agency')
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  get() {
    return this.agency.get();
  }

  @Patch()
  @Roles('SUPER_ADMIN', 'ACCOUNT_MANAGER', 'CREATIVE')
  update(@Body() body: unknown) {
    return this.agency.update(body);
  }
}
