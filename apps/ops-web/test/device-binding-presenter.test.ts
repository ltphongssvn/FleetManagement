// apps/ops-web/test/device-binding-presenter.test.ts
// RED (P7 slice-C): device binding-status presenter. The SSOT contract code
// (@fleet/sync-protocol DeviceBindingStatus) maps to an immutable Vietnamese
// label + semantic badge tone, mirroring co-so-du-lieu.presenter exactly:
// LOOSE string input so an older UI never crashes on a newer producer code
// (generic fallback instead), STRICT Record over the contract union so adding a
// binding status upstream fails typecheck until a label exists here.
// Labels/tones are presentation; the codes are contract.
import { describe, it, expect } from 'vitest';
import {
  presentDeviceBindingStatus,
  DEVICE_BINDING_STATUS_FALLBACK,
} from '@/features/admin/device-binding.presenter';

describe('presentDeviceBindingStatus', () => {
  it('presents pending as the review-queue state (warning tone)', () => {
    const p = presentDeviceBindingStatus('pending');
    expect(p.label).toBe('Chờ duyệt');
    expect(p.tone).toBe('warning');
  });
  it('presents active as approved (success tone)', () => {
    const p = presentDeviceBindingStatus('active');
    expect(p.label).toBe('Đã duyệt');
    expect(p.tone).toBe('success');
  });
  it('presents revoked as terminal (neutral tone)', () => {
    const p = presentDeviceBindingStatus('revoked');
    expect(p.label).toBe('Đã thu hồi');
    expect(p.tone).toBe('neutral');
  });
  it('falls back generically for an unknown code (forward compatible)', () => {
    expect(presentDeviceBindingStatus('quarantined')).toEqual(DEVICE_BINDING_STATUS_FALLBACK);
  });
  it('falls back for an empty code', () => {
    expect(presentDeviceBindingStatus('')).toEqual(DEVICE_BINDING_STATUS_FALLBACK);
  });
  it('never returns a raw code as the label', () => {
    for (const code of ['pending', 'active', 'revoked']) {
      expect(presentDeviceBindingStatus(code).label).not.toBe(code);
    }
  });
  it('returns frozen presentations (immutable Vietnamese copy)', () => {
    expect(Object.isFrozen(presentDeviceBindingStatus('pending'))).toBe(true);
    expect(Object.isFrozen(DEVICE_BINDING_STATUS_FALLBACK)).toBe(true);
  });
});
