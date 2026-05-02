// apps/api/test/config-client.controller.test.ts
import { describe, it, expect } from 'vitest';
import { ConfigClientController } from '../src/config-client/config-client.controller.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';

const op: OperatorContext = createOperatorContext();

describe('@fleet/api - ConfigClientController', () => {
  it('returns full pilot config taxonomy', () => {
    const ctl = new ConfigClientController();
    const cfg = ctl.get(op);
    expect(cfg.configVersion).toBeGreaterThanOrEqual(1);
    expect(cfg.softGraceSeconds).toBe(120);
    expect(cfg.hardGraceSeconds).toBe(10);
    expect(cfg.geofenceToleranceMeters).toBeGreaterThan(0);
    expect(cfg.capabilityFlags).toBeDefined();
    expect(cfg.capabilityFlags.enableChunkChecksums).toBe(false);
    expect(cfg.retryPolicy['command_accept']).toBeDefined();
  });

  it('config_flag_version monotonically increases when bumped', () => {
    const ctl = new ConfigClientController();
    const v1 = ctl.get(op).configFlagVersion;
    expect(v1).toBeGreaterThanOrEqual(1);
  });
});
