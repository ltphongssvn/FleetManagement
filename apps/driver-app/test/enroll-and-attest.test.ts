// apps/driver-app/test/enroll-and-attest.test.ts
// RED (device-binding arc, P6 s3): enrollAndAttest is the keystone entry point
// composing enroll -> attest into one call. Branch-By-Abstraction seam: the
// auth flow integrates device binding via this ONE function (a later one-line
// wiring), never by editing the composed clients. Injected ports keep it
// unit-testable. Returns a discriminated result the caller maps to UI state.
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
import { describe, it, expect, vi } from 'vitest';
import { enrollAndAttest, type EnrollAndAttestPorts } from '../src/device/enroll-and-attest.js';

function ports(over: Partial<EnrollAndAttestPorts> = {}): EnrollAndAttestPorts {
  return {
    enroll: vi.fn(() => Promise.resolve('00000000-0000-0000-0000-0000000000d1')),
    attest: vi.fn(() => Promise.resolve({ verified: true as const })),
    ...over,
  };
}

describe('enrollAndAttest', () => {
  it('enrolls then attests and returns bound', async () => {
    const p = ports();
    const r = await enrollAndAttest(p);
    expect(r).toEqual({ status: 'bound', deviceId: '00000000-0000-0000-0000-0000000000d1' });
    expect(p.enroll).toHaveBeenCalledOnce();
    expect(p.attest).toHaveBeenCalledOnce();
  });

  it('returns attestation-unavailable when the platform cannot attest', async () => {
    const p = ports({
      attest: vi.fn(() =>
        Promise.resolve({ verified: false as const, reason: 'unavailable' as const }),
      ),
    });
    const r = await enrollAndAttest(p);
    expect(r).toEqual({
      status: 'attestation-unavailable',
      deviceId: '00000000-0000-0000-0000-0000000000d1',
    });
  });

  it('enrolls before attesting (order matters: deviceId first)', async () => {
    const calls: string[] = [];
    const p = ports({
      enroll: vi.fn(() => {
        calls.push('enroll');
        return Promise.resolve('00000000-0000-0000-0000-0000000000d1');
      }),
      attest: vi.fn(() => {
        calls.push('attest');
        return Promise.resolve({ verified: true as const });
      }),
    });
    await enrollAndAttest(p);
    expect(calls).toEqual(['enroll', 'attest']);
  });

  it('propagates an enrollment failure as a thrown error', async () => {
    const p = ports({ enroll: vi.fn(() => Promise.reject(new Error('enroll failed'))) });
    await expect(enrollAndAttest(p)).rejects.toThrow(/enroll failed/);
  });
});
