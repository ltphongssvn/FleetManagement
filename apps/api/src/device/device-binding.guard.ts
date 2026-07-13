// apps/api/src/device/device-binding.guard.ts
// Denies driver requests unless the operator hardware-device binding is active
// (device-binding arc, P5 slice-2d). Binding status is read via an injected
// port (DB-free guard); each non-active state maps to its RFC 9457 code so the
// global problem-details filter emits application/problem+json that driver-app
// presents as Vietnamese copy. TOFU lifecycle: unknown -> DEVICE_NOT_REGISTERED,
// pending -> DEVICE_PENDING_APPROVAL, revoked -> DEVICE_REVOKED (terminal).
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { DeviceBindingStatusSchema, type DeviceBindingStatus } from '@fleet/sync-protocol';

export const DEVICE_BINDING_STATUS_PORT = Symbol.for('DeviceBindingStatusPort');

// Port: resolve the current binding status for an operator device, or null when
// no binding row exists (never enrolled). Implemented by a Drizzle-backed
// adapter in the module; injected so the guard stays unit-testable.
export interface DeviceBindingStatusPort {
  statusForOperator(operatorId: string): Promise<DeviceBindingStatus | null>;
}

// Only the operatorId is needed off the authenticated identity; validated at the
// trust boundary (the identity object is populated upstream by the JWT guard).
const GuardClaimsSchema = z.object({ operatorId: z.string().min(1) });

@Injectable()
export class DeviceBindingGuard implements CanActivate {
  constructor(
    @Inject(DEVICE_BINDING_STATUS_PORT) private readonly port: DeviceBindingStatusPort,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const identity: unknown = ctx.switchToHttp().getRequest<{ identity?: unknown }>().identity;
    const parsed = GuardClaimsSchema.safeParse(identity);
    if (!parsed.success) {
      throw new ForbiddenException({ code: 'DEVICE_NOT_REGISTERED', message: 'Authentication required' });
    }
    const status = await this.port.statusForOperator(parsed.data.operatorId);
    if (status === null) {
      throw new ForbiddenException({ code: 'DEVICE_NOT_REGISTERED', message: 'Device is not registered' });
    }
    const known: DeviceBindingStatus = DeviceBindingStatusSchema.parse(status);
    if (known === 'active') return true;
    if (known === 'pending') {
      throw new ForbiddenException({ code: 'DEVICE_PENDING_APPROVAL', message: 'Device is awaiting approval' });
    }
    throw new ForbiddenException({ code: 'DEVICE_REVOKED', message: 'Device access has been revoked' });
  }
}
