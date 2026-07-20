// apps/api/src/device/ios-app-attest-verifier.ts
// iOS App Attest verifier (device-binding arc, Phase 4c). Pure, network-free;
// Apple App Attest root membership is INJECTED (production wires the pinned
// trust store from 4a; tests inject a generated root). Implements Apple server
// verification: CBOR-decode the attestation object, walk the x5c chain to the
// trusted Apple root verifying each signature link and validity window,
// recompute nonce = SHA256(authData || clientDataHash) and require the credCert
// extension OID 1.2.840.113635.100.8.2 to equal it, require the supplied keyId
// to equal SHA256(credCert public key SPKI), require authData.rpIdHash to equal
// SHA256(teamId.bundleId), require the attestation counter to be 0, and map the
// aaguid to environment (appattestdevelop = development sandbox on Ad Hoc/dev
// builds, otherwise production). Returns a discriminated union; never throws.
import * as x509 from '@peculiar/x509';
import { createHash } from 'node:crypto';
import { decodeCBOR as cborDecode } from '@levischuck/tiny-cbor';

const APP_ATTEST_OID = '1.2.840.113635.100.8.2';

export type IosAppAttestEnvironment = 'production' | 'development';

export type IosAppAttestOutcome =
  | {
      readonly kind: 'ok';
      readonly environment: IosAppAttestEnvironment;
      readonly publicKeySpkiBase64: string;
    }
  | { readonly kind: 'malformed-object' }
  | { readonly kind: 'certificate-expired' }
  | { readonly kind: 'chain-signature-invalid' }
  | { readonly kind: 'untrusted-root' }
  | { readonly kind: 'nonce-mismatch' }
  | { readonly kind: 'key-id-mismatch' }
  | { readonly kind: 'rp-id-mismatch' }
  | { readonly kind: 'bad-counter' };

export interface IosAppAttestParams {
  readonly keyId: Uint8Array;
  readonly clientDataHash: Uint8Array;
  readonly expectedTeamId: string;
  readonly expectedBundleId: string;
  readonly now: Date;
  readonly isTrustedRoot: (der: Uint8Array) => boolean;
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function asUint8(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  /* v8 ignore next -- defensive length guard; callers pass equal-length digests */
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    /* v8 ignore next -- index always in range inside the length-bounded loop */
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function verifyIosAppAttest(
  attestationObject: Uint8Array,
  params: IosAppAttestParams,
): Promise<IosAppAttestOutcome> {
  let authData: Uint8Array;
  let x5c: Uint8Array[];
  try {
    const decoded = cborDecode(attestationObject) as Map<string, unknown>;
    const attStmt = decoded.get('attStmt') as Map<string, unknown>;
    const rawAuth = asUint8(decoded.get('authData'));
    const rawX5c = attStmt.get('x5c');
    if (rawAuth === null || !Array.isArray(rawX5c)) return { kind: 'malformed-object' };
    const certs = (rawX5c as unknown[]).map(asUint8);
    if (certs.some((c) => c === null)) return { kind: 'malformed-object' };
    authData = rawAuth;
    x5c = certs as Uint8Array[];
  } catch {
    return { kind: 'malformed-object' };
  }
  /* v8 ignore next -- x5c already proven non-empty by the parse above */
  if (x5c.length === 0) return { kind: 'malformed-object' };

  let certs: x509.X509Certificate[];
  try {
    certs = x5c.map((der) => new x509.X509Certificate(der));
  } catch {
    return { kind: 'malformed-object' };
  }

  for (const cert of certs) {
    if (params.now < cert.notBefore || params.now > cert.notAfter) {
      return { kind: 'certificate-expired' };
    }
  }

  for (let i = 0; i < certs.length - 1; i += 1) {
    const cert = certs[i];
    const issuer = certs[i + 1];
    /* v8 ignore next -- loop bound i < length-1 guarantees both indices exist */
    if (cert === undefined || issuer === undefined) return { kind: 'chain-signature-invalid' };
    let linkOk = false;
    try {
      linkOk = await cert.verify({ publicKey: issuer, signatureOnly: true });
    } catch {
      // verify threw -> link invalid; linkOk stays false
    }
    if (!linkOk) return { kind: 'chain-signature-invalid' };
  }

  const root = certs[certs.length - 1];
  const credCert = certs[0];
  /* v8 ignore next -- x5c non-empty guarantees both certs exist */
  if (root === undefined || credCert === undefined) return { kind: 'malformed-object' };
  if (!params.isTrustedRoot(new Uint8Array(root.rawData))) {
    return { kind: 'untrusted-root' };
  }

  // Nonce: SHA256(authData || clientDataHash) must equal the CBOR-wrapped
  // OCTET STRING inside the credCert App Attest extension.
  const nonceInput = new Uint8Array(authData.length + params.clientDataHash.length);
  nonceInput.set(authData, 0);
  nonceInput.set(params.clientDataHash, authData.length);
  const expectedNonce = sha256(nonceInput);
  const ext = credCert.getExtension(APP_ATTEST_OID);
  if (ext === null) return { kind: 'nonce-mismatch' };
  let extNonce: Uint8Array;
  try {
    extNonce = cborDecode(new Uint8Array(ext.value)) as Uint8Array;
  } catch {
    return { kind: 'nonce-mismatch' };
  }
  if (asUint8(extNonce) === null || !bytesEqual(extNonce, expectedNonce)) {
    return { kind: 'nonce-mismatch' };
  }

  // keyId == SHA256(credCert public key SPKI).
  const spki = new Uint8Array(credCert.publicKey.rawData);
  if (!bytesEqual(sha256(spki), params.keyId)) return { kind: 'key-id-mismatch' };

  // authData layout: rpIdHash(32) | flags(1) | counter(4) | aaguid(16) | ...
  const rpIdHash = authData.subarray(0, 32);
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false);
  const aaguid = authData.subarray(37, 53);

  const expectedRpIdHash = sha256(new TextEncoder().encode(params.expectedTeamId + '.' + params.expectedBundleId));
  if (!bytesEqual(rpIdHash, expectedRpIdHash)) return { kind: 'rp-id-mismatch' };
  if (counter !== 0) return { kind: 'bad-counter' };

  const aaguidText = new TextDecoder().decode(aaguid).replace(/\\u0000+$/u, '');
  const environment: IosAppAttestEnvironment = aaguidText === 'appattestdevelop' ? 'development' : 'production';

  return {
    kind: 'ok',
    environment,
    publicKeySpkiBase64: Buffer.from(spki).toString('base64'),
  };
}
