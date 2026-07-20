// apps/api/test/device-binding-guard-modes.test.ts
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
// RED (device-binding arc, safe-rollout): guard enforcement is mode-driven so
// real drivers can NEVER be locked out by a deploy. off -> guard inert;
// monitor -> evaluate + log would-reject but ALLOW; enforce -> reject. Exempt
// operators (break-glass) are always allowed in every mode. Default off
// (fail-safe). Matches 2026 Conditional-Access monitor-mode rollout practice.
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { DeviceBindingStatus } from '@fleet/sync-protocol';
import {
  DeviceBindingGuard,
  type DeviceBindingStatusPort,
  type DeviceBindingEnforcementConfig,
  type DeviceBindingAuditLogger,
} from '../src/device/device-binding.guard.js';
const OPERATOR_ID = '00000000-0000-0000-0000-0000000000a1';
const NO_EXEMPT: ReadonlySet<string> = new Set<string>();
const CLAIMS = { operatorId: OPERATOR_ID };
function ctxFor(identity: unknown): ExecutionContext {
  const req = { identity };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}
function makeGuard(
  status: DeviceBindingStatus | null,
  config: DeviceBindingEnforcementConfig,
  logger?: DeviceBindingAuditLogger,
): DeviceBindingGuard {
  const port: DeviceBindingStatusPort = { statusForOperator: vi.fn(() => Promise.resolve(status)) };
  return new DeviceBindingGuard(port, config, logger);
}
describe('DeviceBindingGuard enforcement modes', () => {
  it('off: allows a pending device (guard inert)', async () => {
    const guard = makeGuard('pending', { mode: 'off', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
  });
  it('off: allows a revoked device (guard inert)', async () => {
    const guard = makeGuard('revoked', { mode: 'off', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
  });
  it('off: allows even with no identity (fully inert)', async () => {
    const guard = makeGuard('active', { mode: 'off', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(undefined))).resolves.toBe(true);
  });
  it('monitor: ALLOWS a pending device but logs would-reject', async () => {
    const logger: DeviceBindingAuditLogger = { wouldReject: vi.fn() };
    const guard = makeGuard('pending', { mode: 'monitor', exemptOperatorIds: NO_EXEMPT }, logger);
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
    expect(logger.wouldReject).toHaveBeenCalledWith({ operatorId: OPERATOR_ID, code: 'DEVICE_PENDING_APPROVAL' });
  });
  it('monitor: ALLOWS an unregistered device but logs would-reject', async () => {
    const logger: DeviceBindingAuditLogger = { wouldReject: vi.fn() };
    const guard = makeGuard(null, { mode: 'monitor', exemptOperatorIds: NO_EXEMPT }, logger);
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
    expect(logger.wouldReject).toHaveBeenCalledWith({ operatorId: OPERATOR_ID, code: 'DEVICE_NOT_REGISTERED' });
  });
  it('monitor: allows an active device without logging', async () => {
    const logger: DeviceBindingAuditLogger = { wouldReject: vi.fn() };
    const guard = makeGuard('active', { mode: 'monitor', exemptOperatorIds: NO_EXEMPT }, logger);
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
    expect(logger.wouldReject).not.toHaveBeenCalled();
  });
  it('monitor: works without a logger injected (no throw)', async () => {
    const guard = makeGuard('pending', { mode: 'monitor', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
  });
  it('enforce: rejects a pending device', async () => {
    const guard = makeGuard('pending', { mode: 'enforce', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(CLAIMS))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('enforce: rejects a revoked device', async () => {
    const guard = makeGuard('revoked', { mode: 'enforce', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(CLAIMS))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('enforce: rejects an unregistered device', async () => {
    const guard = makeGuard(null, { mode: 'enforce', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(CLAIMS))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('enforce: allows an active device', async () => {
    const guard = makeGuard('active', { mode: 'enforce', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
  });
  it('enforce: rejects when no identity is present', async () => {
    const guard = makeGuard('active', { mode: 'enforce', exemptOperatorIds: NO_EXEMPT });
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('break-glass: exempt operator allowed when pending under enforce', async () => {
    const guard = makeGuard('pending', { mode: 'enforce', exemptOperatorIds: new Set([OPERATOR_ID]) });
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
  });
  it('break-glass: exempt operator allowed when revoked under enforce', async () => {
    const guard = makeGuard('revoked', { mode: 'enforce', exemptOperatorIds: new Set([OPERATOR_ID]) });
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
  });
  it('break-glass: exempt operator not even evaluated (port not called)', async () => {
    const port: DeviceBindingStatusPort = { statusForOperator: vi.fn(() => Promise.resolve('revoked' as DeviceBindingStatus)) };
    const guard = new DeviceBindingGuard(port, { mode: 'enforce', exemptOperatorIds: new Set([OPERATOR_ID]) });
    await expect(guard.canActivate(ctxFor(CLAIMS))).resolves.toBe(true);
    expect(port.statusForOperator).not.toHaveBeenCalled();
  });
});
