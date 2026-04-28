// apps/api/src/sync/sync.controller.ts
// POST /sync endpoint per PDF "Sync wire protocol". Pilot scope: ok status only.
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SyncRequestDto, type SyncRequestInput } from './sync.dto.js';
import { SyncService, type SyncResponseOutput, type OperatorContext } from './sync.service.js';
import { JwtGuard } from '../auth/jwt.guard.js';

@Controller('sync')
@UseGuards(JwtGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  async post(@Body() body: unknown): Promise<SyncResponseOutput> {
    const req: SyncRequestInput = SyncRequestDto.parse(body);
    // Pilot scope: pull tenant from a fixed test context. Real version pulls from
    // request.identity (set by JwtGuard) + device_session lookup. Wire-up week 4+.
    const op: OperatorContext = {
      operatorId: '00000000-0000-0000-0000-000000000002',
      companyId: '00000000-0000-0000-0000-000000000003',
      businessUnitId: '00000000-0000-0000-0000-000000000004',
      depotId: '00000000-0000-0000-0000-000000000005',
      legalEntityId: '00000000-0000-0000-0000-000000000006',
    };
    return this.sync.processSync(req, op);
  }
}
