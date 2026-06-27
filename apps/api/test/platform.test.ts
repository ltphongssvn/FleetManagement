// apps/api/test/platform.test.ts
// RED-first (P1-#6, 2026): single-source-of-truth for the device platform enum.
// The full set ['ios','android','web'] was inlined in TWO enrollment controllers
// (admin-device-enroll, device-enrollment), and attestation independently inlined
// the NARROWER ['android','ios'] -- which is NOT drift but an intentional subset:
// device attestation (Apple App Attest / Google Play Integrity) is mobile-only;
// there is no web attestation token, and the AttestationRepository interface types
// platform as 'android' | 'ios'. So the fix is one PlatformSchema (SSOT) plus an
// AttestationPlatformSchema derived as PlatformSchema.exclude(['web']) -- keeping
// the subset in lockstep with the base (a new platform flows to attestation minus
// web) instead of re-listing values. This is api-internal (no cross-package wire),
// so it lives in apps/api, NOT in @fleet/sync-protocol.
//
// Written before apps/api/src/device/platform.ts exists -> fails at import
// resolution until the module lands.
import { describe, it, expect } from 'vitest';
import {
  PlatformSchema,
  AttestationPlatformSchema,
  type Platform,
  type AttestationPlatform,
} from '../src/device/platform.js';

describe('@fleet/api - PlatformSchema (full device platform set)', () => {
  it('accepts every platform', () => {
    for (const p of ['ios', 'android', 'web']) {
      expect(PlatformSchema.parse(p)).toBe(p);
    }
  });
  it('rejects an unknown platform', () => {
    expect(PlatformSchema.safeParse('blackberry').success).toBe(false);
  });
  it('infers the literal union', () => {
    const p: Platform = 'web';
    expect(p).toBe('web');
  });
});

describe('@fleet/api - AttestationPlatformSchema (mobile-only subset)', () => {
  it('accepts the mobile platforms', () => {
    for (const p of ['ios', 'android']) {
      expect(AttestationPlatformSchema.parse(p)).toBe(p);
    }
  });
  it('REJECTS web (proves .exclude([web]) -- there is no web attestation)', () => {
    expect(AttestationPlatformSchema.safeParse('web').success).toBe(false);
  });
  it('rejects an unknown platform', () => {
    expect(AttestationPlatformSchema.safeParse('symbian').success).toBe(false);
  });
  it('infers the narrowed union assignable to a mobile-only value', () => {
    const p: AttestationPlatform = 'android';
    expect(p).toBe('android');
  });
});
