// apps/api/test/ios-app-attest-verifier.test.ts
// RED (device-binding arc, Phase 4c): iOS App Attest verifier. Pure, no
// network. Apple App Attest attestation object is CBOR:
//   { fmt: apple-appattest, attStmt: { x5c: [credCert, caCert], receipt },
//     authData: <rpIdHash|flags|counter|aaguid|credIdLen|credId|COSEkey> }.
// Server verification (Apple docs): (1) walk x5c to the pinned Apple App
// Attest root (membership INJECTED as a port); (2) recompute
// nonce = SHA256(authData || SHA256(clientData)) and require the credCert
// extension OID 1.2.840.113635.100.8.2 to equal it; (3) keyId ==
// SHA256(credCert public key); (4) rpIdHash == SHA256(teamId.bundleId);
// (5) counter == 0 at attestation; (6) aaguid identifies the environment
// (appattestdevelop = sandbox on Ad Hoc/dev builds, appattest = production).
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto, createHash, type webcrypto as WebCryptoNs } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { encodeCBOR as cborEncode, type CBORType } from '@levischuck/tiny-cbor';
import {
  verifyIosAppAttest,
  type IosAppAttestOutcome,
} from '../src/device/ios-app-attest-verifier.js';

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

const APP_ATTEST_OID = '1.2.840.113635.100.8.2';
const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const TEAM_ID = 'ABCDE12345';
const BUNDLE_ID = 'com.vominhchau.fleet.driver';
const RP_ID = TEAM_ID + '.' + BUNDLE_ID;

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

let appleRootKeys: WebCryptoNs.CryptoKeyPair;
let appleRootCert: x509.X509Certificate;
let wrongRootKeys: WebCryptoNs.CryptoKeyPair;
let wrongRootCert: x509.X509Certificate;

const PROD_AAGUID = new TextEncoder().encode('appattest');
const SANDBOX_AAGUID = new TextEncoder().encode('appattestdevelop');

function padAaguid(seed: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  out.set(seed.subarray(0, 16));
  return out;
}

function buildAuthData(counter: number, aaguidSeed: Uint8Array, credId: Uint8Array): Uint8Array {
  const rpIdHash = sha256(new TextEncoder().encode(RP_ID));
  const flags = new Uint8Array([0x40]);
  const counterBytes = new Uint8Array(4);
  new DataView(counterBytes.buffer).setUint32(0, counter, false);
  const aaguid = padAaguid(aaguidSeed);
  const credIdLen = new Uint8Array(2);
  new DataView(credIdLen.buffer).setUint16(0, credId.length, false);
  const coseKey = new Uint8Array([0xa0]);
  const parts = [rpIdHash, flags, counterBytes, aaguid, credIdLen, credId, coseKey];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

interface AttestOptions {
  challenge: string;
  counter: number;
  aaguidSeed: Uint8Array;
  root: x509.X509Certificate;
  rootKeys: WebCryptoNs.CryptoKeyPair;
  tamperNonce: boolean;
  wrongKeyId: boolean;
}

interface AttestArtifacts {
  attestationObject: Uint8Array;
  keyId: Uint8Array;
  clientDataHash: Uint8Array;
}

async function buildAttestation(opts: AttestOptions): Promise<AttestArtifacts> {
  const credKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', credKeys.publicKey));
  const realKeyId = sha256(spki);
  const keyId = opts.wrongKeyId ? sha256(new TextEncoder().encode('not-the-key')) : realKeyId;
  const authData = buildAuthData(opts.counter, opts.aaguidSeed, realKeyId);
  const clientDataHash = sha256(new TextEncoder().encode(opts.challenge));
  const nonceInput = new Uint8Array(authData.length + clientDataHash.length);
  nonceInput.set(authData, 0);
  nonceInput.set(clientDataHash, authData.length);
  const nonce = sha256(nonceInput);
  const nonceForExt = opts.tamperNonce ? sha256(new TextEncoder().encode('wrong')) : nonce;
  const credCert = await x509.X509CertificateGenerator.create({
    serialNumber: '02',
    subject: 'CN=App Attest Credential',
    issuer: opts.root.subject,
    notBefore: new Date('2024-06-01T00:00:00Z'),
    notAfter: new Date('2035-01-01T00:00:00Z'),
    signingAlgorithm: ALG,
    publicKey: credKeys.publicKey,
    signingKey: opts.rootKeys.privateKey,
    extensions: [new x509.Extension(APP_ATTEST_OID, false, cborEncode(nonceForExt))],
  });
  const x5c = [new Uint8Array(credCert.rawData), new Uint8Array(opts.root.rawData)];
  const attStmt = new Map<string, CBORType>([['x5c', x5c as unknown as CBORType], ['receipt', new Uint8Array(0)]]);
  const obj = new Map<string, CBORType>([
    ['fmt', 'apple-appattest'],
    ['attStmt', attStmt as unknown as CBORType],
    ['authData', authData],
  ]);
  return { attestationObject: cborEncode(obj), keyId, clientDataHash };
}

const NOW = new Date('2026-07-09T00:00:00Z');

function run(a: AttestArtifacts, trusted: (der: Uint8Array) => boolean): Promise<IosAppAttestOutcome> {
  return verifyIosAppAttest(a.attestationObject, {
    keyId: a.keyId,
    clientDataHash: a.clientDataHash,
    expectedTeamId: TEAM_ID,
    expectedBundleId: BUNDLE_ID,
    now: NOW,
    isTrustedRoot: trusted,
  });
}

function trustOnly(root: x509.X509Certificate): (der: Uint8Array) => boolean {
  const want = Buffer.from(root.rawData).toString('base64');
  return (der: Uint8Array) => Buffer.from(der).toString('base64') === want;
}

beforeAll(async () => {
  appleRootKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  appleRootCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Apple App Attest Test Root',
    notBefore: new Date('2024-01-01T00:00:00Z'),
    notAfter: new Date('2044-01-01T00:00:00Z'),
    signingAlgorithm: ALG,
    keys: appleRootKeys,
    extensions: [new x509.BasicConstraintsExtension(true, 1, true)],
  });
  wrongRootKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  wrongRootCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Wrong Root',
    notBefore: new Date('2024-01-01T00:00:00Z'),
    notAfter: new Date('2044-01-01T00:00:00Z'),
    signingAlgorithm: ALG,
    keys: wrongRootKeys,
    extensions: [new x509.BasicConstraintsExtension(true, 1, true)],
  });
});

describe('verifyIosAppAttest', () => {
  it('accepts a valid production attestation and reports environment + key', async () => {
    const a = await buildAttestation({ challenge: 'nonce-1', counter: 0, aaguidSeed: PROD_AAGUID, root: appleRootCert, rootKeys: appleRootKeys, tamperNonce: false, wrongKeyId: false });
    const out = await run(a, trustOnly(appleRootCert));
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.environment).toBe('production');
      expect(out.publicKeySpkiBase64.length).toBeGreaterThan(0);
    }
  });

  it('reports development environment for the sandbox aaguid', async () => {
    const a = await buildAttestation({ challenge: 'n', counter: 0, aaguidSeed: SANDBOX_AAGUID, root: appleRootCert, rootKeys: appleRootKeys, tamperNonce: false, wrongKeyId: false });
    const out = await run(a, trustOnly(appleRootCert));
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.environment).toBe('development');
  });

  it('rejects an untrusted root', async () => {
    const a = await buildAttestation({ challenge: 'n', counter: 0, aaguidSeed: PROD_AAGUID, root: wrongRootCert, rootKeys: wrongRootKeys, tamperNonce: false, wrongKeyId: false });
    const out = await run(a, trustOnly(appleRootCert));
    expect(out.kind).toBe('untrusted-root');
  });

  it('rejects a nonce that does not match the credCert extension', async () => {
    const a = await buildAttestation({ challenge: 'n', counter: 0, aaguidSeed: PROD_AAGUID, root: appleRootCert, rootKeys: appleRootKeys, tamperNonce: true, wrongKeyId: false });
    const out = await run(a, trustOnly(appleRootCert));
    expect(out.kind).toBe('nonce-mismatch');
  });

  it('rejects a keyId that is not the sha-256 of the public key', async () => {
    const a = await buildAttestation({ challenge: 'n', counter: 0, aaguidSeed: PROD_AAGUID, root: appleRootCert, rootKeys: appleRootKeys, tamperNonce: false, wrongKeyId: true });
    const out = await run(a, trustOnly(appleRootCert));
    expect(out.kind).toBe('key-id-mismatch');
  });

  it('rejects a non-zero counter at attestation', async () => {
    const a = await buildAttestation({ challenge: 'n', counter: 5, aaguidSeed: PROD_AAGUID, root: appleRootCert, rootKeys: appleRootKeys, tamperNonce: false, wrongKeyId: false });
    const out = await run(a, trustOnly(appleRootCert));
    expect(out.kind).toBe('bad-counter');
  });

  it('rejects an rpIdHash from the wrong team/bundle', async () => {
    const a = await buildAttestation({ challenge: 'n', counter: 0, aaguidSeed: PROD_AAGUID, root: appleRootCert, rootKeys: appleRootKeys, tamperNonce: false, wrongKeyId: false });
    const out = await verifyIosAppAttest(a.attestationObject, { keyId: a.keyId, clientDataHash: a.clientDataHash, expectedTeamId: 'ZZZZZ99999', expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('rp-id-mismatch');
  });

  it('rejects an object whose attStmt has no x5c', async () => {
    const attStmt = new Map<string, CBORType>([['receipt', new Uint8Array(0)]]);
    const obj = new Map<string, CBORType>([['fmt', 'apple-appattest'], ['attStmt', attStmt as unknown as CBORType], ['authData', new Uint8Array(60)]]);
    const bytes = cborEncode(obj);
    const out = await verifyIosAppAttest(bytes, { keyId: new Uint8Array(32), clientDataHash: new Uint8Array(32), expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('malformed-object');
  });

  it('rejects an x5c entry that is not bytes', async () => {
    const attStmt = new Map<string, CBORType>([['x5c', ['not-bytes'] as unknown as CBORType], ['receipt', new Uint8Array(0)]]);
    const obj = new Map<string, CBORType>([['fmt', 'apple-appattest'], ['attStmt', attStmt as unknown as CBORType], ['authData', new Uint8Array(60)]]);
    const bytes = cborEncode(obj);
    const out = await verifyIosAppAttest(bytes, { keyId: new Uint8Array(32), clientDataHash: new Uint8Array(32), expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('malformed-object');
  });

  it('rejects a credCert extension whose CBOR is not an octet string', async () => {
    const credKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const authData = buildAuthData(0, PROD_AAGUID, new Uint8Array(32));
    const nonNumberCbor = cborEncode(42 as unknown as CBORType);
    const credCert = await x509.X509CertificateGenerator.create({ serialNumber: '02', subject: 'CN=Cred', issuer: appleRootCert.subject, notBefore: new Date('2024-06-01T00:00:00Z'), notAfter: new Date('2035-01-01T00:00:00Z'), signingAlgorithm: ALG, publicKey: credKeys.publicKey, signingKey: appleRootKeys.privateKey, extensions: [new x509.Extension(APP_ATTEST_OID, false, nonNumberCbor)] });
    const x5c = [new Uint8Array(credCert.rawData), new Uint8Array(appleRootCert.rawData)];
    const attStmt = new Map<string, CBORType>([['x5c', x5c as unknown as CBORType], ['receipt', new Uint8Array(0)]]);
    const obj = new Map<string, CBORType>([['fmt', 'apple-appattest'], ['attStmt', attStmt as unknown as CBORType], ['authData', authData]]);
    const bytes = cborEncode(obj);
    const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', credKeys.publicKey));
    const out = await verifyIosAppAttest(bytes, { keyId: sha256(spki), clientDataHash: sha256(new TextEncoder().encode('x')), expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('nonce-mismatch');
  });

  it('rejects an x5c entry that is bytes but not a valid certificate', async () => {
    const bogusCert = new Uint8Array(64).fill(7);
    const attStmt = new Map<string, CBORType>([['x5c', [bogusCert] as unknown as CBORType], ['receipt', new Uint8Array(0)]]);
    const obj = new Map<string, CBORType>([['fmt', 'apple-appattest'], ['attStmt', attStmt as unknown as CBORType], ['authData', new Uint8Array(60)]]);
    const out = await verifyIosAppAttest(cborEncode(obj), { keyId: new Uint8Array(32), clientDataHash: new Uint8Array(32), expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('malformed-object');
  });

  it('rejects an expired certificate in the chain', async () => {
    const a = await buildAttestation({ challenge: 'n', counter: 0, aaguidSeed: PROD_AAGUID, root: appleRootCert, rootKeys: appleRootKeys, tamperNonce: false, wrongKeyId: false });
    const future = new Date('2050-01-01T00:00:00Z');
    const out = await verifyIosAppAttest(a.attestationObject, { keyId: a.keyId, clientDataHash: a.clientDataHash, expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: future, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('certificate-expired');
  });

  it('rejects a credCert extension whose bytes are not decodable CBOR', async () => {
    const credKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const authData = buildAuthData(0, PROD_AAGUID, new Uint8Array(32));
    const undecodable = new Uint8Array([0xff, 0xff, 0xff]);
    const credCert = await x509.X509CertificateGenerator.create({ serialNumber: '02', subject: 'CN=Cred', issuer: appleRootCert.subject, notBefore: new Date('2024-06-01T00:00:00Z'), notAfter: new Date('2035-01-01T00:00:00Z'), signingAlgorithm: ALG, publicKey: credKeys.publicKey, signingKey: appleRootKeys.privateKey, extensions: [new x509.Extension(APP_ATTEST_OID, false, undecodable)] });
    const x5c = [new Uint8Array(credCert.rawData), new Uint8Array(appleRootCert.rawData)];
    const attStmt = new Map<string, CBORType>([['x5c', x5c as unknown as CBORType], ['receipt', new Uint8Array(0)]]);
    const obj = new Map<string, CBORType>([['fmt', 'apple-appattest'], ['attStmt', attStmt as unknown as CBORType], ['authData', authData]]);
    const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', credKeys.publicKey));
    const out = await verifyIosAppAttest(cborEncode(obj), { keyId: sha256(spki), clientDataHash: sha256(new TextEncoder().encode('x')), expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('nonce-mismatch');
  });

  it('rejects a chain whose leaf signature does not verify against the issuer', async () => {
    const credKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const authData = buildAuthData(0, PROD_AAGUID, new Uint8Array(32));
    const clientDataHash = sha256(new TextEncoder().encode('n'));
    const nonceInput = new Uint8Array(authData.length + clientDataHash.length);
    nonceInput.set(authData, 0);
    nonceInput.set(clientDataHash, authData.length);
    const nonce = sha256(nonceInput);
    const credCert = await x509.X509CertificateGenerator.create({ serialNumber: '02', subject: 'CN=Cred', issuer: appleRootCert.subject, notBefore: new Date('2024-06-01T00:00:00Z'), notAfter: new Date('2035-01-01T00:00:00Z'), signingAlgorithm: ALG, publicKey: credKeys.publicKey, signingKey: wrongRootKeys.privateKey, extensions: [new x509.Extension(APP_ATTEST_OID, false, cborEncode(nonce as unknown as CBORType))] });
    const x5c = [new Uint8Array(credCert.rawData), new Uint8Array(appleRootCert.rawData)];
    const attStmt = new Map<string, CBORType>([['x5c', x5c as unknown as CBORType], ['receipt', new Uint8Array(0)]]);
    const obj = new Map<string, CBORType>([['fmt', 'apple-appattest'], ['attStmt', attStmt as unknown as CBORType], ['authData', authData]]);
    const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', credKeys.publicKey));
    const out = await verifyIosAppAttest(cborEncode(obj), { keyId: sha256(spki), clientDataHash, expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('chain-signature-invalid');
  });

  it('rejects a credCert that has no App Attest extension', async () => {
    const credKeys = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const authData = buildAuthData(0, PROD_AAGUID, new Uint8Array(32));
    const credCert = await x509.X509CertificateGenerator.create({ serialNumber: '02', subject: 'CN=NoExt', issuer: appleRootCert.subject, notBefore: new Date('2024-06-01T00:00:00Z'), notAfter: new Date('2035-01-01T00:00:00Z'), signingAlgorithm: ALG, publicKey: credKeys.publicKey, signingKey: appleRootKeys.privateKey, extensions: [] });
    const x5c = [new Uint8Array(credCert.rawData), new Uint8Array(appleRootCert.rawData)];
    const attStmt = new Map<string, CBORType>([['x5c', x5c as unknown as CBORType], ['receipt', new Uint8Array(0)]]);
    const obj = new Map<string, CBORType>([['fmt', 'apple-appattest'], ['attStmt', attStmt as unknown as CBORType], ['authData', authData]]);
    const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', credKeys.publicKey));
    const out = await verifyIosAppAttest(cborEncode(obj), { keyId: sha256(spki), clientDataHash: sha256(new TextEncoder().encode('x')), expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('nonce-mismatch');
  });

  it('rejects malformed cbor', async () => {
    const out = await verifyIosAppAttest(new Uint8Array([0xff, 0x00, 0x13]), { keyId: new Uint8Array(32), clientDataHash: new Uint8Array(32), expectedTeamId: TEAM_ID, expectedBundleId: BUNDLE_ID, now: NOW, isTrustedRoot: trustOnly(appleRootCert) });
    expect(out.kind).toBe('malformed-object');
  });
});
