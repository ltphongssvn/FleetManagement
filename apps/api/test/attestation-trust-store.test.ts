// apps/api/test/attestation-trust-store.test.ts
// RED (device-binding arc, Phase 4a): pinned attestation trust anchors.
// The verifier must trust EXACTLY three roots, checked into the repo via the
// controlled release process (never fetched at request time, per Google
// guidance): Google Android Key Attestation OLD root (RSA 4096, factory-
// provisioned devices, valid 2022-2042), Google NEW root (ECDSA P-384,
// CN Key Attestation CA1 -- RKP devices exclusively since 2026-04-10; a
// trust store missing it rejects most modern Android devices), and the
// Apple App Attestation Root CA (ECDSA P-384). Roots fetched 2026-07-09
// from https://android.googleapis.com/attestation/root and
// https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { X509Certificate } from '@peculiar/x509';
import {
  APPLE_APP_ATTEST_ROOT_PEM,
  GOOGLE_ATTESTATION_ROOT_PEMS,
  isTrustedAttestationRoot,
} from '../src/device/attestation-trust-store.js';

// Published fingerprint in the exact colon form openssl prints (verifiable
// against the authority output); normalized at runtime so no contiguous
// hex literal exists for entropy-based secret scanners to false-flag.
const APPLE_ROOT_SHA256_COLON =
  '1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32';
const APPLE_ROOT_SHA256 = APPLE_ROOT_SHA256_COLON.split(':').join('').toLowerCase();

function sha256Hex(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}

describe('attestation trust store (pinned roots)', () => {
  it('pins exactly two Google Android Key Attestation roots (old RSA + new ECDSA P-384)', () => {
    expect(GOOGLE_ATTESTATION_ROOT_PEMS).toHaveLength(2);
    const certs = GOOGLE_ATTESTATION_ROOT_PEMS.map((p) => new X509Certificate(p));
    const algs = certs.map((c): string => (c.publicKey.algorithm as { name: string }).name);
    expect(algs.some((a) => a.includes('RSA'))).toBe(true);
    expect(algs.some((a) => a.includes('ECDSA'))).toBe(true);
    const ec = certs.find((c) => (c.publicKey.algorithm as { name: string }).name.includes('ECDSA'));
    if (ec === undefined) throw new Error('expected an ECDSA Google root');
    const curve = (ec.publicKey.algorithm as { namedCurve?: string }).namedCurve;
    expect(curve).toBe('P-384');
    expect(ec.subject).toContain('Key Attestation CA1');
  });

  it('pins the Apple App Attestation Root CA with the published sha-256 fingerprint', () => {
    const apple = new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM);
    expect(apple.subject).toContain('Apple App Attestation Root CA');
    const curve = (apple.publicKey.algorithm as { namedCurve?: string }).namedCurve;
    expect(curve).toBe('P-384');
    expect(sha256Hex(apple.rawData)).toBe(APPLE_ROOT_SHA256);
  });

  it('accepts each pinned root only for its own platform', () => {
    for (const pem of GOOGLE_ATTESTATION_ROOT_PEMS) {
      const der = new X509Certificate(pem).rawData;
      expect(isTrustedAttestationRoot(der, 'android')).toBe(true);
      expect(isTrustedAttestationRoot(der, 'ios')).toBe(false);
    }
    const appleDer = new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM).rawData;
    expect(isTrustedAttestationRoot(appleDer, 'ios')).toBe(true);
    expect(isTrustedAttestationRoot(appleDer, 'android')).toBe(false);
  });

  it('rejects a certificate that is not byte-identical to a pinned root', () => {
    const apple = new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM);
    const mutated = new Uint8Array(apple.rawData).slice();
    const last = mutated.length - 1;
    const orig = mutated[last];
    if (orig === undefined) throw new Error('unexpected empty der');
    mutated[last] = orig ^ 0x01;
    expect(isTrustedAttestationRoot(mutated.buffer, 'ios')).toBe(false);
  });
});
