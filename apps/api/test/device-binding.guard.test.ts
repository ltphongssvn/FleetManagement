// apps/api/test/device-binding.guard.test.ts
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
// RED (device-binding arc, P5 slice-2d): DeviceBindingGuard denies driver
// requests unless the operator device binding is active. Reads binding status
// via an injected port (no DB here); maps each non-active state to its RFC 9457
// problem-details code (DEVICE_NOT_REGISTERED / DEVICE_PENDING_APPROVAL /
// DEVICE_REVOKED) via a ForbiddenException carrying { code }. Enforcement model:
// unknown identity enrolls as pending; ops-web admin activates; revoked is
// terminal-rejected.
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import {
  DeviceBindingGuard,
  DEVICE_BINDING_STATUS_PORT,
  type DeviceBindingStatusPort,
} from '../src/device/device-binding.guard.js';

const OPERATOR_ID = '00000000-0000-0000-0000-0000000000a1';

function ctxFor(identity: unknown): ExecutionContext {
  const req = { identity };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

// Enforce mode: this suite pins the terminal rejection behavior. The staged
// off/monitor rollout is covered in device-binding-guard-modes.test.ts.
function makeGuard(port: DeviceBindingStatusPort): DeviceBindingGuard {
  return new DeviceBindingGuard(port, { mode: 'enforce', exemptOperatorIds: new Set<string>() });
}

const CLAIMS = { operatorId: OPERATOR_ID };

describe('DeviceBindingGuard', () => {
  it('allows the request when the binding is active', async () => {
    const port: DeviceBindingStatusPort = {
      statusForOperator: vi.fn().mockResolvedValue('active'),
    };
    const guard = makeGuard(port);
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
    expect(port.statusForOperator).toHaveBeenCalledWith(OPERATOR_ID);
  });

  it('rejects pending with DEVICE_PENDING_APPROVAL', async () => {
    const port: DeviceBindingStatusPort = {
      statusForOperator: vi.fn().mockResolvedValue('pending'),
    };
    const guard = makeGuard(port);
    await expect(guard.canActivate(ctxFor(CLAIMS))).rejects.toBeInstanceOf(ForbiddenException);
    await guard.canActivate(ctxFor(CLAIMS)).catch((e: unknown) => {
      expect(((e as ForbiddenException).getResponse() as { code: string }).code).toBe(
        'DEVICE_PENDING_APPROVAL',
      );
    });
  });

  it('rejects revoked with DEVICE_REVOKED', async () => {
    const port: DeviceBindingStatusPort = {
      statusForOperator: vi.fn().mockResolvedValue('revoked'),
    };
    const guard = makeGuard(port);
    await guard.canActivate(ctxFor(CLAIMS)).catch((e: unknown) => {
      expect(((e as ForbiddenException).getResponse() as { code: string }).code).toBe(
        'DEVICE_REVOKED',
      );
    });
  });

  it('rejects an unknown (no binding row) with DEVICE_NOT_REGISTERED', async () => {
    const port: DeviceBindingStatusPort = { statusForOperator: vi.fn().mockResolvedValue(null) };
    const guard = makeGuard(port);
    await guard.canActivate(ctxFor(CLAIMS)).catch((e: unknown) => {
      expect(((e as ForbiddenException).getResponse() as { code: string }).code).toBe(
        'DEVICE_NOT_REGISTERED',
      );
    });
  });

  it('rejects when no authenticated identity is present', async () => {
    const port: DeviceBindingStatusPort = { statusForOperator: vi.fn() };
    const guard = makeGuard(port);
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(port.statusForOperator).not.toHaveBeenCalled();
  });

  it('exposes the DI token for the status port', () => {
    expect(typeof DEVICE_BINDING_STATUS_PORT).toBe('symbol');
  });
});
