// apps/api/src/device/device-binding.guard.ts
// Denies driver requests unless the operator hardware-device binding is active
// (device-binding arc). Binding status is read via an injected port (DB-free
// guard); each non-active state maps to its RFC 9457 code so the global
// problem-details filter emits application/problem+json that driver-app
// presents as Vietnamese copy.
//
// SAFE ROLLOUT (a production driver lockout is impossible by construction):
// enforcement is mode-driven via injected config (sourced from the
// DEVICE_BINDING_ENFORCEMENT env var), following 2026 Conditional-Access
// practice of observing before enforcing:
//   off     -> guard is inert; every request passes (fail-safe DEFAULT).
//   monitor -> evaluate and emit a structured would-reject audit event, but
//              ALLOW the request. Surfaces the real blast radius so operators
//              can drive drivers to enrollment before enforcing.
//   enforce -> reject non-active devices (the terminal state, turned on only
//              after monitor logs prove no legitimate driver is affected).
// Break-glass: exemptOperatorIds are ALWAYS allowed in every mode and are not
// even evaluated -- an emergency escape hatch so a named driver can never be
// locked out.
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { z } from 'zod';
import {
  DeviceBindingStatusSchema,
  type DeviceBindingStatus,
  type DeviceBindingEnforcementMode,
  type DeviceBindingProblemCode,
} from '@fleet/sync-protocol';
export const DEVICE_BINDING_STATUS_PORT = Symbol.for('DeviceBindingStatusPort');
export const DEVICE_BINDING_ENFORCEMENT_CONFIG = Symbol.for('DeviceBindingEnforcementConfig');
export const DEVICE_BINDING_AUDIT_LOGGER = Symbol.for('DeviceBindingAuditLogger');
// Port: resolve the current binding status for an operator device, or null
// when no binding row exists (never enrolled). Injected -> unit-testable.
export interface DeviceBindingStatusPort {
  statusForOperator(operatorId: string): Promise<DeviceBindingStatus | null>;
}
// Injected enforcement policy. Internal, single-use shape (crosses no trust
// boundary as an object; the mode STRING is validated at the env boundary via
// DeviceBindingEnforcementModeSchema) -> plain TS per the two-axis rule.
export interface DeviceBindingEnforcementConfig {
  readonly mode: DeviceBindingEnforcementMode;
  readonly exemptOperatorIds: ReadonlySet<string>;
}
// Structured audit sink for monitor mode. The guard emits only an operator id
// + problem code (Factor XI: no secrets, no request bodies). Injected so the
// adapter can route to the app logger / Sentry / metrics.
export interface DeviceBindingAuditLogger {
  wouldReject(event: { operatorId: string; code: DeviceBindingProblemCode }): void;
}
// Fail-safe default: absent config -> off (inert). A missing or misconfigured
// enforcement wiring can therefore never lock drivers out.
const OFF_CONFIG: DeviceBindingEnforcementConfig = {
  mode: 'off',
  exemptOperatorIds: new Set<string>(),
};
// Only the operatorId is needed off the authenticated identity; validated at
// the trust boundary (identity is populated upstream by the JWT guard).
const GuardClaimsSchema = z.object({ operatorId: z.string().min(1) });
@Injectable()
export class DeviceBindingGuard implements CanActivate {
  private readonly config: DeviceBindingEnforcementConfig;
  constructor(
    @Inject(DEVICE_BINDING_STATUS_PORT) private readonly port: DeviceBindingStatusPort,
    @Optional() @Inject(DEVICE_BINDING_ENFORCEMENT_CONFIG) config?: DeviceBindingEnforcementConfig,
    @Optional()
    @Inject(DEVICE_BINDING_AUDIT_LOGGER)
    private readonly logger?: DeviceBindingAuditLogger,
  ) {
    this.config = config ?? OFF_CONFIG;
  }
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // off: fully inert -- never read identity, never call the port, always allow.
    if (this.config.mode === 'off') return true;
    const identity: unknown = ctx.switchToHttp().getRequest<{ identity?: unknown }>().identity;
    const parsed = GuardClaimsSchema.safeParse(identity);
    if (!parsed.success) {
      return this.decide(undefined, 'DEVICE_NOT_REGISTERED', 'Authentication required');
    }
    const operatorId = parsed.data.operatorId;
    // Break-glass: exempt operators are always allowed and never evaluated.
    if (this.config.exemptOperatorIds.has(operatorId)) return true;
    const status = await this.port.statusForOperator(operatorId);
    if (status === null) {
      return this.decide(operatorId, 'DEVICE_NOT_REGISTERED', 'Device is not registered');
    }
    const known: DeviceBindingStatus = DeviceBindingStatusSchema.parse(status);
    if (known === 'active') return true;
    if (known === 'pending') {
      return this.decide(operatorId, 'DEVICE_PENDING_APPROVAL', 'Device is awaiting approval');
    }
    return this.decide(operatorId, 'DEVICE_REVOKED', 'Device access has been revoked');
  }
  // Central decision for a would-be rejection. In monitor mode the request is
  // ALLOWED and the event logged; in enforce mode it is rejected.
  private decide(
    operatorId: string | undefined,
    code: DeviceBindingProblemCode,
    message: string,
  ): boolean {
    if (this.config.mode === 'monitor') {
      if (operatorId !== undefined) this.logger?.wouldReject({ operatorId, code });
      return true;
    }
    throw new ForbiddenException({ code, message });
  }
}
