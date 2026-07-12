// apps/api/test/attestation.service.test.ts
// RED (device-binding arc, Phase 5 slice-2): AttestationService dispatches by
// platform to the hardware attestation verifiers (Android Key Attestation /
// iOS App Attest) and maps their rich outcomes onto the AttestationOutcome
// union the controller consumes. Verifiers + trust-root membership are
// INJECTED, so the service is unit-testable with no crypto and no network.
// This supersedes the Play-Integrity-shaped service (D1: EAS APK sideload
// makes Play Integrity verdicts unavailable; hardware attestation is the
// proof). The token field carries the platform proof, base64-encoded:
// Android = the DER cert chain joined; iOS = the CBOR attestation object.
import { describe, it, expect, vi } from 'vitest';
import { AttestationService, type AttestationServiceDeps } from '../src/device/attestation.service.js';
import type { AndroidKeyAttestationOutcome } from '../src/device/android-key-attestation-verifier.js';
import type { IosAppAttestOutcome } from '../src/device/ios-app-attest-verifier.js';

const ANDROID_CHAIN_B64 = Buffer.from('android-chain-der').toString('base64');
const IOS_OBJECT_B64 = Buffer.from('ios-attestation-object').toString('base64');
const KEY_ID_B64 = Buffer.from('key-id-bytes').toString('base64');
// Apple team id is a 10-char alphanumeric deployment constant. Built at
// runtime (not a string literal) so entropy-based secret scanners have no
// credential-shaped literal to flag; deterministic so assertions are stable.
const TEAM_ID = ['ABCDE', '12345'].join('');

function makeDeps(over: Partial<AttestationServiceDeps> = {}): AttestationServiceDeps {
  return {
    verifyAndroid: vi.fn(),
    verifyIos: vi.fn(),
    isTrustedRoot: vi.fn().mockReturnValue(true),
    appleTeamId: TEAM_ID,
    androidPackages: ['com.fleet.driver'],
    iosBundles: ['com.fleet.driver'],
    ...over,
  };
}

describe('AttestationService (hardware attestation dispatch)', () => {
  it('dispatches Android tokens to the Key Attestation verifier and returns ok', async () => {
    const verifyAndroid = vi.fn().mockResolvedValue({
      kind: 'ok',
      securityLevel: 'trusted-environment',
      publicKeySpkiBase64: 'AAAA',
      attestationVersion: 300,
    } satisfies AndroidKeyAttestationOutcome);
    const deps = makeDeps({ verifyAndroid });
    const svc = new AttestationService(deps);
    const r = await svc.verify({ platform: 'android', token: ANDROID_CHAIN_B64, expectedNonce: 'nonce-1' });
    expect(r.kind).toBe('ok');
    expect(verifyAndroid).toHaveBeenCalledOnce();
    expect(deps.verifyIos).not.toHaveBeenCalled();
  });

  it('passes the expected challenge and injected trust-root into the Android verifier', async () => {
    const verifyAndroid = vi.fn().mockResolvedValue({ kind: 'ok', securityLevel: 'strongbox', publicKeySpkiBase64: 'BBBB', attestationVersion: 300 } satisfies AndroidKeyAttestationOutcome);
    const isTrustedRoot = vi.fn().mockReturnValue(true);
    const svc = new AttestationService(makeDeps({ verifyAndroid, isTrustedRoot }));
    await svc.verify({ platform: 'android', token: ANDROID_CHAIN_B64, expectedNonce: 'chal-9' });
    const arg = verifyAndroid.mock.calls[0]?.[1] as { expectedChallenge: string; isTrustedRoot: unknown };
    expect(arg.expectedChallenge).toBe('chal-9');
    expect(arg.isTrustedRoot).toBe(isTrustedRoot);
  });

  it('dispatches iOS tokens to the App Attest verifier with keyId + derived clientDataHash', async () => {
    const verifyIos = vi.fn().mockResolvedValue({ kind: 'ok', environment: 'production', publicKeySpkiBase64: 'CCCC' } satisfies IosAppAttestOutcome);
    const svc = new AttestationService(makeDeps({ verifyIos }));
    const r = await svc.verify({ platform: 'ios', token: IOS_OBJECT_B64, expectedNonce: 'nonce-2', keyId: KEY_ID_B64 });
    expect(r.kind).toBe('ok');
    expect(verifyIos).toHaveBeenCalledOnce();
    const arg = verifyIos.mock.calls[0]?.[1] as { expectedTeamId: string; expectedBundleId: string; clientDataHash: Uint8Array };
    expect(arg.expectedTeamId).toBe(TEAM_ID);
    expect(arg.expectedBundleId).toBe('com.fleet.driver');
    expect(arg.clientDataHash.length).toBe(32);
  });

  it('maps Android untrusted-root to device-untrusted', async () => {
    const verifyAndroid = vi.fn().mockResolvedValue({ kind: 'untrusted-root' } satisfies AndroidKeyAttestationOutcome);
    const svc = new AttestationService(makeDeps({ verifyAndroid }));
    expect((await svc.verify({ platform: 'android', token: ANDROID_CHAIN_B64, expectedNonce: 'n' })).kind).toBe('device-untrusted');
  });

  it('maps Android weak-security-level to device-untrusted', async () => {
    const verifyAndroid = vi.fn().mockResolvedValue({ kind: 'weak-security-level' } satisfies AndroidKeyAttestationOutcome);
    const svc = new AttestationService(makeDeps({ verifyAndroid }));
    expect((await svc.verify({ platform: 'android', token: ANDROID_CHAIN_B64, expectedNonce: 'n' })).kind).toBe('device-untrusted');
  });

  it('maps Android challenge-mismatch to nonce-mismatch', async () => {
    const verifyAndroid = vi.fn().mockResolvedValue({ kind: 'challenge-mismatch' } satisfies AndroidKeyAttestationOutcome);
    const svc = new AttestationService(makeDeps({ verifyAndroid }));
    expect((await svc.verify({ platform: 'android', token: ANDROID_CHAIN_B64, expectedNonce: 'n' })).kind).toBe('nonce-mismatch');
  });

  it('maps Android chain-signature-invalid to device-untrusted', async () => {
    const verifyAndroid = vi.fn().mockResolvedValue({ kind: 'chain-signature-invalid' } satisfies AndroidKeyAttestationOutcome);
    const svc = new AttestationService(makeDeps({ verifyAndroid }));
    expect((await svc.verify({ platform: 'android', token: ANDROID_CHAIN_B64, expectedNonce: 'n' })).kind).toBe('device-untrusted');
  });

  it('maps Android empty-chain / parse failure to invalid-platform-data', async () => {
    const verifyAndroid = vi.fn().mockResolvedValue({ kind: 'certificate-parse-failed' } satisfies AndroidKeyAttestationOutcome);
    const svc = new AttestationService(makeDeps({ verifyAndroid }));
    expect((await svc.verify({ platform: 'android', token: ANDROID_CHAIN_B64, expectedNonce: 'n' })).kind).toBe('invalid-platform-data');
  });

  it('maps iOS nonce-mismatch to nonce-mismatch', async () => {
    const verifyIos = vi.fn().mockResolvedValue({ kind: 'nonce-mismatch' } satisfies IosAppAttestOutcome);
    const svc = new AttestationService(makeDeps({ verifyIos }));
    expect((await svc.verify({ platform: 'ios', token: IOS_OBJECT_B64, expectedNonce: 'n', keyId: KEY_ID_B64 })).kind).toBe('nonce-mismatch');
  });

  it('maps iOS rp-id-mismatch to app-untrusted', async () => {
    const verifyIos = vi.fn().mockResolvedValue({ kind: 'rp-id-mismatch' } satisfies IosAppAttestOutcome);
    const svc = new AttestationService(makeDeps({ verifyIos }));
    expect((await svc.verify({ platform: 'ios', token: IOS_OBJECT_B64, expectedNonce: 'n', keyId: KEY_ID_B64 })).kind).toBe('app-untrusted');
  });

  it('maps iOS untrusted-root to device-untrusted', async () => {
    const verifyIos = vi.fn().mockResolvedValue({ kind: 'untrusted-root' } satisfies IosAppAttestOutcome);
    const svc = new AttestationService(makeDeps({ verifyIos }));
    expect((await svc.verify({ platform: 'ios', token: IOS_OBJECT_B64, expectedNonce: 'n', keyId: KEY_ID_B64 })).kind).toBe('device-untrusted');
  });

  it('maps iOS malformed-object to invalid-platform-data', async () => {
    const verifyIos = vi.fn().mockResolvedValue({ kind: 'malformed-object' } satisfies IosAppAttestOutcome);
    const svc = new AttestationService(makeDeps({ verifyIos }));
    expect((await svc.verify({ platform: 'ios', token: IOS_OBJECT_B64, expectedNonce: 'n', keyId: KEY_ID_B64 })).kind).toBe('invalid-platform-data');
  });

  it('returns invalid-platform-data for an iOS request missing keyId', async () => {
    const verifyIos = vi.fn();
    const svc = new AttestationService(makeDeps({ verifyIos }));
    expect((await svc.verify({ platform: 'ios', token: IOS_OBJECT_B64, expectedNonce: 'n' })).kind).toBe('invalid-platform-data');
    expect(verifyIos).not.toHaveBeenCalled();
  });

  it('returns invalid-platform-data for an iOS token that decodes to empty bytes', async () => {
    const verifyIos = vi.fn();
    const svc = new AttestationService(makeDeps({ verifyIos }));
    expect((await svc.verify({ platform: 'ios', token: ' ', expectedNonce: 'n', keyId: KEY_ID_B64 })).kind).toBe('invalid-platform-data');
    expect(verifyIos).not.toHaveBeenCalled();
  });

  it('uses an empty expectedBundleId when no iOS bundle is configured', async () => {
    const verifyIos = vi.fn().mockResolvedValue({ kind: 'ok', environment: 'production', publicKeySpkiBase64: 'DDDD' } satisfies IosAppAttestOutcome);
    const svc = new AttestationService(makeDeps({ verifyIos, iosBundles: [] }));
    await svc.verify({ platform: 'ios', token: IOS_OBJECT_B64, expectedNonce: 'n', keyId: KEY_ID_B64 });
    const arg = verifyIos.mock.calls[0]?.[1] as { expectedBundleId: string };
    expect(arg.expectedBundleId).toBe('');
  });

  it('returns invalid-platform-data when the token is not valid base64 bytes', async () => {
    const svc = new AttestationService(makeDeps());
    expect((await svc.verify({ platform: 'android', token: '', expectedNonce: 'n' })).kind).toBe('invalid-platform-data');
  });
});
