// apps/api/src/admin/admin-device-binding.controller.ts
// Admin devices surface (device-binding arc, P5 slice-2e). JWT-gated.
//   GET   /admin/devices                     -> company-scoped device list
//   PATCH /admin/devices/:deviceId/binding    -> activate | revoke
// Body validated by the SSOT DeviceBindingPatchRequestSchema; deviceId param
// validated as a guid at the trust boundary. Company scoping comes from the
// authenticated OperatorContext, never the client.
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import { DeviceBindingPatchRequestSchema, type AdminDeviceRow, type DeviceBindingPatchRequest } from '@fleet/sync-protocol';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { AdminDeviceBindingService } from './admin-device-binding.service.js';
const DeviceIdParamSchema = z.guid();
@UseGuards(JwtGuard)
@Controller('admin/devices')
export class AdminDeviceBindingController {
  constructor(private readonly service: AdminDeviceBindingService) {}
  @Get()
  async list(@CurrentOperator() op: OperatorContext): Promise<{ devices: AdminDeviceRow[] }> {
    const devices = await this.service.list(op.companyId);
    return { devices };
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
