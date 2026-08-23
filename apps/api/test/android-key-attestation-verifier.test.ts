// apps/api/test/android-key-attestation-verifier.test.ts
// RED (device-binding arc, Phase 4b): Android hardware Key Attestation chain
// verifier. Pure function, no network: walks a leaf-first DER chain, verifies
// every signature link, requires the terminal cert to be a trusted Android
// attestation root (membership INJECTED as a port -- production wires the
// pinned trust store; tests inject their own generated root), parses the
// KeyDescription extension (OID 1.3.6.1.4.1.11129.2.1.17), and enforces:
// attestationChallenge equals the server nonce, security level is
// TrustedEnvironment or StrongBox (Software rejected), key purpose includes
// SIGN, and validity windows contain now. Fleet ships via EAS APK sideload,
// so Key Attestation (not Play Integrity) is the Android proof (D1).
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto, type webcrypto as WebCryptoNs } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  AuthorizationList,
  IntegerSet,
  KeyDescription,
  SecurityLevel,
} from '@peculiar/asn1-android';
import {
  verifyAndroidKeyAttestation,
  type AndroidKeyAttestationOutcome,
} from '../src/device/android-key-attestation-verifier.js';

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

const KEY_DESCRIPTION_OID = '1.3.6.1.4.1.11129.2.1.17';
const KM_PURPOSE_SIGN = 2;
const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

interface ChainOptions {
  challenge: string;
  securityLevel: SecurityLevel;
  purposes: number[];
  includeKeyDescription: boolean;
  leafExpired: boolean;
}

let rootKeys: WebCryptoNs.CryptoKeyPair;
let rootCert: x509.X509Certificate;
let otherRootKeys: WebCryptoNs.CryptoKeyPair;
let otherRootCert: x509.X509Certificate;

function keyDescriptionExtension(
  challenge: string,
  level: SecurityLevel,
  purposes: number[],
): x509.Extension {
  const teeEnforced = new AuthorizationList();
  if (purposes.length > 0) {
    teeEnforced.purpose = new IntegerSet(purposes);
  }
  const kd = new KeyDescription({
    attestationVersion: 300,
    attestationSecurityLevel: level,
    keymasterVersion: 300,
    keymasterSecurityLevel: level,
    attestationChallenge: new OctetString(new TextEncoder().encode(challenge)),
    uniqueId: new OctetString(new Uint8Array(0)),
    softwareEnforced: new AuthorizationList(),
    teeEnforced,
  });
  return new x509.Extension(KEY_DESCRIPTION_OID, false, AsnConvert.serialize(kd));
}

async function makeRoot(
  name: string,
  keys: WebCryptoNs.CryptoKeyPair,
): Promise<x509.X509Certificate> {
  return x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name,
    notBefore: new Date('2024-01-01T00:00:00Z'),
    notAfter: new Date('2044-01-01T00:00:00Z'),
    signingAlgorithm: ALG,
    keys,
    extensions: [new x509.BasicConstraintsExtension(true, 1, true)],
  });
}

async function makeChain(opts: ChainOptions): Promise<Uint8Array[]> {
  const leafKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const notAfter = opts.leafExpired
    ? new Date('2025-01-01T00:00:00Z')
    : new Date('2035-01-01T00:00:00Z');
  const extensions: x509.Extension[] = [];
  if (opts.includeKeyDescription) {
    extensions.push(keyDescriptionExtension(opts.challenge, opts.securityLevel, opts.purposes));
  }
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: '02',
    subject: 'CN=Android Keystore Key',
    issuer: rootCert.subject,
    notBefore: new Date('2024-06-01T00:00:00Z'),
    notAfter,
    signingAlgorithm: ALG,
    publicKey: leafKeys.publicKey,
    signingKey: rootKeys.privateKey,
    extensions,
  });
  return [new Uint8Array(leaf.rawData), new Uint8Array(rootCert.rawData)];
}

function trustOnly(root: x509.X509Certificate): (der: Uint8Array) => boolean {
  const want = Buffer.from(root.rawData).toString('base64');
  return (der: Uint8Array) => Buffer.from(der).toString('base64') === want;
}

const NOW = new Date('2026-07-09T00:00:00Z');

function run(
  chain: Uint8Array[],
  challenge: string,
  trusted: (der: Uint8Array) => boolean,
): Promise<AndroidKeyAttestationOutcome> {
  return verifyAndroidKeyAttestation(chain, {
    expectedChallenge: challenge,
    now: NOW,
    isTrustedRoot: trusted,
  });
}

beforeAll(async () => {
  rootKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  rootCert = await makeRoot('CN=Test Attestation Root', rootKeys);
  otherRootKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  otherRootCert = await makeRoot('CN=Wrong Root', otherRootKeys);
});

describe('verifyAndroidKeyAttestation', () => {
  it('accepts a valid TEE chain and reports level + leaf public key', async () => {
    const chain = await makeChain({
      challenge: 'nonce-1',
      securityLevel: SecurityLevel.trustedEnvironment,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: true,
      leafExpired: false,
    });
    const out = await run(chain, 'nonce-1', trustOnly(rootCert));
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.securityLevel).toBe('trusted-environment');
      expect(out.publicKeySpkiBase64.length).toBeGreaterThan(0);
    }
  });

  it('accepts StrongBox and reports strongbox level', async () => {
    const chain = await makeChain({
      challenge: 'nonce-sb',
      securityLevel: SecurityLevel.strongBox,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: true,
      leafExpired: false,
    });
    const out = await run(chain, 'nonce-sb', trustOnly(rootCert));
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.securityLevel).toBe('strongbox');
  });

  it('rejects a software-level attestation', async () => {
    const chain = await makeChain({
      challenge: 'n',
      securityLevel: SecurityLevel.software,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: true,
      leafExpired: false,
    });
    const out = await run(chain, 'n', trustOnly(rootCert));
    expect(out.kind).toBe('weak-security-level');
  });

  it('rejects a challenge mismatch', async () => {
    const chain = await makeChain({
      challenge: 'expected',
      securityLevel: SecurityLevel.trustedEnvironment,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: true,
      leafExpired: false,
    });
    const out = await run(chain, 'different', trustOnly(rootCert));
    expect(out.kind).toBe('challenge-mismatch');
  });

  it('rejects a chain whose root is not trusted', async () => {
    const chain = await makeChain({
      challenge: 'n',
      securityLevel: SecurityLevel.trustedEnvironment,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: true,
      leafExpired: false,
    });
    const out = await run(chain, 'n', trustOnly(otherRootCert));
    expect(out.kind).toBe('untrusted-root');
  });

  it('rejects a broken signature link', async () => {
    const chain = await makeChain({
      challenge: 'n',
      securityLevel: SecurityLevel.trustedEnvironment,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: true,
      leafExpired: false,
    });
    const leafDer = chain[0];
    if (leafDer === undefined) throw new Error('expected a leaf cert');
    const forged = [leafDer, new Uint8Array(otherRootCert.rawData)];
    const out = await run(forged, 'n', trustOnly(otherRootCert));
    expect(out.kind).toBe('chain-signature-invalid');
  });

  it('rejects an expired leaf', async () => {
    const chain = await makeChain({
      challenge: 'n',
      securityLevel: SecurityLevel.trustedEnvironment,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: true,
      leafExpired: true,
    });
    const out = await run(chain, 'n', trustOnly(rootCert));
    expect(out.kind).toBe('certificate-expired');
  });

  it('rejects a leaf without the KeyDescription extension', async () => {
    const chain = await makeChain({
      challenge: 'n',
      securityLevel: SecurityLevel.trustedEnvironment,
      purposes: [KM_PURPOSE_SIGN],
      includeKeyDescription: false,
      leafExpired: false,
    });
    const out = await run(chain, 'n', trustOnly(rootCert));
    expect(out.kind).toBe('key-description-missing');
  });

  it('rejects a key whose purposes exclude SIGN', async () => {
    const chain = await makeChain({
      challenge: 'n',
      securityLevel: SecurityLevel.trustedEnvironment,
      purposes: [1],
      includeKeyDescription: true,
      leafExpired: false,
    });
    const out = await run(chain, 'n', trustOnly(rootCert));
    expect(out.kind).toBe('wrong-key-purpose');
  });

  it('rejects a leaf whose KeyDescription extension is not valid ASN.1', async () => {
    const leafKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const leaf = await x509.X509CertificateGenerator.create({
      serialNumber: '02',
      subject: 'CN=Bad KD',
      issuer: rootCert.subject,
      notBefore: new Date('2024-06-01T00:00:00Z'),
      notAfter: new Date('2035-01-01T00:00:00Z'),
      signingAlgorithm: ALG,
      publicKey: leafKeys.publicKey,
      signingKey: rootKeys.privateKey,
      extensions: [new x509.Extension(KEY_DESCRIPTION_OID, false, new Uint8Array([1, 2, 3, 4]))],
    });
    const chain = [new Uint8Array(leaf.rawData), new Uint8Array(rootCert.rawData)];
    const out = await run(chain, 'n', trustOnly(rootCert));
    expect(out.kind).toBe('key-description-missing');
  });

  it('rejects an empty chain', async () => {
    const out = await run([], 'n', trustOnly(rootCert));
    expect(out.kind).toBe('empty-chain');
  });

  it('rejects garbage bytes that do not parse as a certificate', async () => {
    const out = await run([new Uint8Array([1, 2, 3])], 'n', trustOnly(rootCert));
    expect(out.kind).toBe('certificate-parse-failed');
  });
});
