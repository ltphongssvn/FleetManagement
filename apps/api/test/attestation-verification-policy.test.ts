// apps/api/test/attestation-verification-policy.test.ts
// RED: Pure policy decides whether a device attestation result should be accepted.
// Inputs are normalized across platforms (Android Play Integrity verdicts +
// iOS App Attest verification results). No I/O, no crypto here.
//
// Rules (per Google Play Integrity API + Apple App Attest 2026 guidance):
//   - device integrity verdict must include MEETS_DEVICE_INTEGRITY (Android)
//     or App Attest verification must have passed (iOS)
//   - app must be unmodified (PLAY_RECOGNIZED on Android; bundle id match on iOS)
//   - nonce must match the server-issued challenge (replay protection)
//   - attestation must be fresh (timestamp within 5 minutes)
//   - aaguid / package name must be one of the allow-listed app identifiers
import { describe, it, expect } from 'vitest';
import {
  decideAttestationOutcome,
  type AttestationCandidate,
  type AttestationOutcome,
} from '../src/device/attestation-verification-policy.js';

const ANDROID_OK: AttestationCandidate = {
  platform: 'android',
  packageName: 'com.fleet.driver',
  deviceIntegrity: ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'],
  appIntegrity: 'PLAY_RECOGNIZED',
  nonceMatches: true,
  ageMs: 60_000,
  bundleId: null,
};

const IOS_OK: AttestationCandidate = {
  platform: 'ios',
  packageName: null,
  deviceIntegrity: [],
  appIntegrity: null,
  nonceMatches: true,
  ageMs: 60_000,
  bundleId: 'com.fleet.driver',
};

const ALLOWED = { android: ['com.fleet.driver'], ios: ['com.fleet.driver'] };
const MAX_AGE = 5 * 60 * 1000;

describe('decideAttestationOutcome', () => {
  it('returns ok for valid Android attestation', () => {
    const r: AttestationOutcome = decideAttestationOutcome(ANDROID_OK, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('ok');
  });

  it('returns ok for valid iOS attestation', () => {
    const r = decideAttestationOutcome(IOS_OK, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('ok');
  });

  it('returns nonce-mismatch when nonce check fails (replay protection)', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, nonceMatches: false }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('nonce-mismatch');
  });

  it('returns stale when ageMs exceeds maxAgeMs', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, ageMs: 6 * 60_000 }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('stale');
  });

  it('returns device-untrusted when Android lacks MEETS_DEVICE_INTEGRITY (rooted/emulator)', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, deviceIntegrity: ['MEETS_BASIC_INTEGRITY'] }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('device-untrusted');
  });

  it('returns app-untrusted when Android appIntegrity is not PLAY_RECOGNIZED', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, appIntegrity: 'UNRECOGNIZED_VERSION' }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('app-untrusted');
  });

  it('returns app-untrusted when package name not on allow list (Android)', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, packageName: 'com.attacker.app' }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('app-untrusted');
  });

  it('returns app-untrusted when bundle id not on allow list (iOS)', () => {
    const r = decideAttestationOutcome({ ...IOS_OK, bundleId: 'com.attacker.app' }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('app-untrusted');
  });

  it('returns invalid-platform-data when Android candidate missing packageName', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, packageName: null }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('invalid-platform-data');
  });

  it('returns invalid-platform-data when iOS candidate missing bundleId', () => {
    const r = decideAttestationOutcome({ ...IOS_OK, bundleId: null }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('invalid-platform-data');
  });

  it('checks nonce before device-trust (replay is hard rejection)', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, nonceMatches: false, deviceIntegrity: [] }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('nonce-mismatch');
  });

  it('checks stale before device-trust', () => {
    const r = decideAttestationOutcome({ ...ANDROID_OK, ageMs: 6 * 60_000, deviceIntegrity: [] }, ALLOWED, MAX_AGE);
    expect(r.kind).toBe('stale');
  });
});
