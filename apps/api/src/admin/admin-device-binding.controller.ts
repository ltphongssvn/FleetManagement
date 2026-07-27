// apps/api/src/admin/admin-device-binding.controller.ts
// Admin devices surface (device-binding arc; P7 slice-A evolves GET). JWT-gated.
//   GET   /admin/devices?status=&page=&pageSize= -> filtered, paginated device list
//   PATCH /admin/devices/:deviceId/binding        -> activate | revoke
// Query params + body + :deviceId are all validated by SSOT schemas at the trust
// boundary (Axis 1). Company scoping comes from the authenticated OperatorContext,
// never the client.
import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import {
  AdminDeviceListQuerySchema,
  DeviceBindingPatchRequestSchema,
  type AdminDeviceListResponse,
  type DeviceBindingPatchRequest,
} from '@fleet/sync-protocol';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { AdminDeviceBindingService } from './admin-device-binding.service.js';

const DeviceIdParamSchema = z.guid();

@UseGuards(JwtGuard)
@Controller('admin/devices')
export class AdminDeviceBindingController {
  constructor(private readonly service: AdminDeviceBindingService) {}

  @Get()
  async list(
    @CurrentOperator() op: OperatorContext,
    @Query() rawQuery: unknown,
  ): Promise<AdminDeviceListResponse> {
    const query = AdminDeviceListQuerySchema.parse(rawQuery);
    return this.service.list(op.companyId, query);
  }

  @Patch(':deviceId/binding')
  async patch(
    @CurrentOperator() op: OperatorContext,
    @Param('deviceId') deviceId: string,
    @Body() body: DeviceBindingPatchRequest,
  ): Promise<{ ok: true }> {
    const id = DeviceIdParamSchema.parse(deviceId);
    const parsed = DeviceBindingPatchRequestSchema.parse(body);
    await this.service.setBinding(op.companyId, id, parsed);
    return { ok: true };
  }
}
