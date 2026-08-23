// apps/api/test/device-registry-audit.test.ts
// RED-first spec for the manual-device-UDID fabrication classifier (P2).
// Fixtures model the exact prod fabrication signature observed this session:
//   three udid strings each shared by two driver devices (CFA204/206/207),
//   every row platform='ios', appVersion placeholder '0.0.0'.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { auditDeviceRegistry } from '../src/admin/device-registry-audit.js';

// House pattern: randomUUID() mints RFC-valid v4 ids (Zod v4 .uuid() enforces
// version/variant nibbles). Tests assert on counts and pairing, never on
// specific id VALUES, so per-call random ids are safe and deterministic here.
const OP = (_n: number): string => randomUUID();
const DEV = (_n: number): string => randomUUID();

// Six fabricated rows: three udids shared across driver pairs, all ios/0.0.0.
const fabricated = [
  { deviceId: DEV(1), operatorId: OP(1), platform: 'ios', appVersion: '0.0.0', udid: 'CFA204' },
  { deviceId: DEV(2), operatorId: OP(2), platform: 'ios', appVersion: '0.0.0', udid: 'CFA204' },
  { deviceId: DEV(3), operatorId: OP(3), platform: 'ios', appVersion: '0.0.0', udid: 'CFA206' },
  { deviceId: DEV(4), operatorId: OP(4), platform: 'ios', appVersion: '0.0.0', udid: 'CFA206' },
  { deviceId: DEV(5), operatorId: OP(5), platform: 'ios', appVersion: '0.0.0', udid: 'CFA207' },
  { deviceId: DEV(6), operatorId: OP(6), platform: 'ios', appVersion: '0.0.0', udid: 'CFA207' },
];

describe('auditDeviceRegistry — fabrication detection', () => {
  it('detects all three shared-udid collision groups', () => {
    const report = auditDeviceRegistry(fabricated);
    expect(report.duplicateUdids).toHaveLength(3);
    const udids = report.duplicateUdids.map((d) => d.udid).sort();
    expect(udids).toEqual(['CFA204', 'CFA206', 'CFA207']);
    for (const group of report.duplicateUdids) {
      expect(group.deviceIds).toHaveLength(2);
    }
  });

  it('flags every placeholder-version row', () => {
    const report = auditDeviceRegistry(fabricated);
    expect(report.placeholderVersionDeviceIds).toHaveLength(6);
  });

  it('detects ios platform monoculture', () => {
    const report = auditDeviceRegistry(fabricated);
    expect(report.isPlatformMonoculture).toBe(true);
    expect(report.platformCounts).toEqual({ ios: 6 });
    expect(report.totalDevices).toBe(6);
  });

  it('reports a clean bill for a healthy mixed fleet', () => {
    const healthy = [
      {
        deviceId: DEV(10),
        operatorId: OP(10),
        platform: 'ios',
        appVersion: '2.27.0',
        udid: 'REAL-UDID-A',
      },
      {
        deviceId: DEV(11),
        operatorId: OP(11),
        platform: 'android',
        appVersion: '2.27.0',
        udid: null,
      },
      {
        deviceId: DEV(12),
        operatorId: OP(12),
        platform: 'android',
        appVersion: '2.27.0',
        udid: null,
      },
    ];
    const report = auditDeviceRegistry(healthy);
    expect(report.duplicateUdids).toHaveLength(0);
    expect(report.placeholderVersionDeviceIds).toHaveLength(0);
    expect(report.isPlatformMonoculture).toBe(false);
    expect(report.platformCounts).toEqual({ ios: 1, android: 2 });
  });

  it('does not treat two null udids as a collision', () => {
    const twoNull = [
      {
        deviceId: DEV(20),
        operatorId: OP(20),
        platform: 'android',
        appVersion: '2.27.0',
        udid: null,
      },
      {
        deviceId: DEV(21),
        operatorId: OP(21),
        platform: 'android',
        appVersion: '2.27.0',
        udid: null,
      },
    ];
    const report = auditDeviceRegistry(twoNull);
    expect(report.duplicateUdids).toHaveLength(0);
  });
});
