// apps/api/src/manifest/manifest.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { NegotiateUploadSchema, type NegotiateUploadInput, type NegotiateUploadResponse } from './manifest.dto.js';
import { ManifestService, type OperatorContext } from './manifest.service.js';

@Controller('upload')
@UseGuards(JwtGuard)
export class ManifestController {
  constructor(private readonly manifests: ManifestService) {}

  @Post('negotiate')
  async negotiate(@Body() body: unknown): Promise<NegotiateUploadResponse> {
    const input: NegotiateUploadInput = NegotiateUploadSchema.parse(body);
    // Pilot scope: hard-coded operator context. Real wiring derives from JwtGuard
    // identity + device_session lookup (week 4+ session-binding integration).
    const op: OperatorContext = {
      operatorId: '00000000-0000-0000-0000-000000000002',
      companyId: '00000000-0000-0000-0000-000000000003',
      businessUnitId: '00000000-0000-0000-0000-000000000004',
      depotId: '00000000-0000-0000-0000-000000000005',
      legalEntityId: '00000000-0000-0000-0000-000000000006',
    };
    return this.manifests.negotiateUpload(input, op);
  }
}
