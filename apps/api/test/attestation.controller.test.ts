// apps/api/test/attestation.controller.test.ts
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
// RED: HTTP layer for device attestation. JWT-gated. Two endpoints: nonce issue + verify.
import { describe, it, expect, vi } from 'vitest';
import { AttestationController } from '../src/device/attestation.controller.js';
import type { AttestationService } from '../src/device/attestation.service.js';
import type { AttestationOutcome } from '../src/device/attestation-verification-policy.js';
import type { OperatorContext } from '@fleet/domain';

const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-0000000000a1',
  companyId: '00000000-0000-0000-0000-000000000001',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};

function makeRepo(): { markAttestationVerified: ReturnType<typeof vi.fn> } {
  return { markAttestationVerified: vi.fn().mockResolvedValue(undefined) };
}
function makeNonceStore(): {
  issue: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    issue: vi.fn((op: string) => {
      const n = `nonce-for-${op}`;
      store.set(op, n);
      return Promise.resolve(n);
    }),
    consume: vi.fn((op: string) => Promise.resolve(store.get(op) ?? null)),
    store,
  };
}

describe('AttestationController', () => {
  it('POST /device/attest/nonce returns a fresh nonce bound to the operator', async () => {
    const svc = { verify: vi.fn() } as unknown as AttestationService;
    const nonceStore = makeNonceStore();
    const repo = makeRepo();
    const ctrl = new AttestationController(svc, repo, nonceStore);
    const r = await ctrl.issueNonce(OP);
    expect(r.nonce).toBe(`nonce-for-${OP.operatorId}`);
    expect(nonceStore.issue).toHaveBeenCalledWith(OP.operatorId);
  });

  it('POST /device/attest/verify accepts ok outcome, persists attestation, returns verified', async () => {
    const svc = { verify: vi.fn().mockResolvedValue({ kind: 'ok' } as AttestationOutcome) } as unknown as AttestationService;
    const nonceStore = makeNonceStore();
    await nonceStore.issue(OP.operatorId);
    const repo = makeRepo();
    const ctrl = new AttestationController(svc, repo, nonceStore);
    const r = await ctrl.verify(OP, { platform: 'android', token: 'tok', deviceId: '00000000-0000-0000-0000-0000000000d1' });
    expect(r.verified).toBe(true);
    expect(repo.markAttestationVerified).toHaveBeenCalledWith({
      deviceId: '00000000-0000-0000-0000-0000000000d1',
      platform: 'android',
      tokenHashHex: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('POST /device/attest/verify rejects with ForbiddenException on device-untrusted', async () => {
    const svc = { verify: vi.fn().mockResolvedValue({ kind: 'device-untrusted' } as AttestationOutcome) } as unknown as AttestationService;
    const nonceStore = makeNonceStore();
    await nonceStore.issue(OP.operatorId);
    const repo = makeRepo();
    const ctrl = new AttestationController(svc, repo, nonceStore);
    await expect(ctrl.verify(OP, { platform: 'android', token: 'tok', deviceId: '00000000-0000-0000-0000-0000000000d1' })).rejects.toThrow(/device.untrusted/i);
    expect(repo.markAttestationVerified).not.toHaveBeenCalled();
  });

  it('POST /device/attest/verify rejects with UnauthorizedException when no nonce was issued (replay defense)', async () => {
    const svc = { verify: vi.fn() } as unknown as AttestationService;
    const nonceStore = makeNonceStore();
    const repo = makeRepo();
    const ctrl = new AttestationController(svc, repo, nonceStore);
    await expect(ctrl.verify(OP, { platform: 'android', token: 'tok', deviceId: '00000000-0000-0000-0000-0000000000d1' })).rejects.toThrow(/no nonce/i);
    expect(svc.verify).not.toHaveBeenCalled();
  });

  it('POST /device/attest/verify rejects body missing required fields via zod', async () => {
    const svc = { verify: vi.fn() } as unknown as AttestationService;
    const nonceStore = makeNonceStore();
    await nonceStore.issue(OP.operatorId);
    const repo = makeRepo();
    const ctrl = new AttestationController(svc, repo, nonceStore);
    await expect(ctrl.verify(OP, { platform: 'android' } as never)).rejects.toThrow();
  });

  it('passes expectedNonce from store and token from body into svc.verify', async () => {
    const svc = { verify: vi.fn().mockResolvedValue({ kind: 'ok' }) } as unknown as AttestationService;
    const nonceStore = makeNonceStore();
    await nonceStore.issue(OP.operatorId);
    const repo = makeRepo();
    const ctrl = new AttestationController(svc, repo, nonceStore);
    await ctrl.verify(OP, { platform: 'ios', token: 'der-token', deviceId: '00000000-0000-0000-0000-0000000000d1' });
    expect(svc.verify).toHaveBeenCalledWith({ platform: 'ios', token: 'der-token', expectedNonce: `nonce-for-${OP.operatorId}` });
  });
});
