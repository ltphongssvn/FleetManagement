// apps/api/test/device.service.test.ts
// Pure-branch tests only. DB behavior covered in device.service.integration.test.ts.
// Removes chain-mock anti-pattern (critique #1, #9).
import { describe, it, expect } from 'vitest';
import { DeviceService } from '../src/device/device.service.js';
import { SESSION_MODES } from '@fleet/domain';

describe('@fleet/api - DeviceService Zod validation', () => {
  it('rejects invalid surface via Zod schema', async () => {
    const svc = new DeviceService(null as never);
    await expect(svc.issueSession({
      deviceId: '00000000-0000-0000-0000-000000000001',
      operatorId: '00000000-0000-0000-0000-000000000002',
      surface: 'invalid' as never,
      sessionMode: 'mutating',
      companyId: '00000000-0000-0000-0000-000000000003',
      businessUnitId: '00000000-0000-0000-0000-000000000004',
      depotId: '00000000-0000-0000-0000-000000000005',
      legalEntityId: '00000000-0000-0000-0000-000000000006',
    })).rejects.toThrow();
  });

  it('rejects invalid revocation reason via Zod', async () => {
    const svc = new DeviceService(null as never);
    await expect(svc.revokeSession(
      '00000000-0000-0000-0000-00000000000a',
      'not-a-valid-reason' as never,
    )).rejects.toThrow();
  });
});

describe('@fleet/api - DeviceService constants', () => {
  it('exposes domain SESSION_MODES', () => {
    expect(SESSION_MODES).toContain('mutating');
    expect(SESSION_MODES).toContain('shadow');
  });
});
