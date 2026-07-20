// apps/api/src/device/android-key-attestation-verifier.ts
// Android hardware Key Attestation chain verifier (device-binding arc, 4b).
// Pure and network-free: trust-anchor membership is INJECTED (production
// wires isTrustedAttestationRoot from the pinned trust store; tests inject
// generated roots). Verifies, in order: chain non-empty, every cert parses,
// validity windows contain now, every signature link is valid leaf->root,
// the terminal cert is a trusted Android attestation root, the leaf carries
// the KeyDescription extension (OID 1.3.6.1.4.1.11129.2.1.17), the
// attestationChallenge equals the server nonce, the attestation security
// level is TrustedEnvironment or StrongBox (Software fails closed), and the
// hardware-enforced key purposes include SIGN. Returns a discriminated
// outcome union; never throws (null-never-throw house pattern).
import * as x509 from '@peculiar/x509';
import { AsnConvert } from '@peculiar/asn1-schema';
import { KeyDescription, SecurityLevel } from '@peculiar/asn1-android';

const KEY_DESCRIPTION_OID = '1.3.6.1.4.1.11129.2.1.17';
const KM_PURPOSE_SIGN = 2;

export type AndroidSecurityLevel = 'trusted-environment' | 'strongbox';

export type AndroidKeyAttestationOutcome =
  | {
      readonly kind: 'ok';
      readonly securityLevel: AndroidSecurityLevel;
      readonly publicKeySpkiBase64: string;
      readonly attestationVersion: number;
    }
  | { readonly kind: 'empty-chain' }
  | { readonly kind: 'certificate-parse-failed' }
  | { readonly kind: 'certificate-expired' }
  | { readonly kind: 'chain-signature-invalid' }
  | { readonly kind: 'untrusted-root' }
  | { readonly kind: 'key-description-missing' }
  | { readonly kind: 'challenge-mismatch' }
  | { readonly kind: 'weak-security-level' }
  | { readonly kind: 'wrong-key-purpose' };

export interface AndroidKeyAttestationParams {
  readonly expectedChallenge: string;
  readonly now: Date;
  readonly isTrustedRoot: (der: Uint8Array) => boolean;
}

export async function verifyAndroidKeyAttestation(
  chainDer: readonly Uint8Array[],
  params: AndroidKeyAttestationParams,
): Promise<AndroidKeyAttestationOutcome> {
  if (chainDer.length === 0) return { kind: 'empty-chain' };

  let certs: x509.X509Certificate[];
  try {
    certs = chainDer.map((der) => new x509.X509Certificate(der));
  } catch {
    return { kind: 'certificate-parse-failed' };
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
  /* v8 ignore next -- chain proven non-empty at entry, so root exists */
  if (root === undefined) return { kind: 'empty-chain' };
  if (!params.isTrustedRoot(new Uint8Array(root.rawData))) {
    return { kind: 'untrusted-root' };
  }

  const leaf = certs[0];
  /* v8 ignore next -- chain proven non-empty at entry, so leaf exists */
  if (leaf === undefined) return { kind: 'empty-chain' };
  const ext = leaf.getExtension(KEY_DESCRIPTION_OID);
  if (ext === null) return { kind: 'key-description-missing' };

  let kd: KeyDescription;
  try {
    kd = AsnConvert.parse(ext.value, KeyDescription);
  } catch {
    return { kind: 'key-description-missing' };
  }

  const challenge = new TextDecoder().decode(new Uint8Array(kd.attestationChallenge.buffer));
  if (challenge !== params.expectedChallenge) return { kind: 'challenge-mismatch' };

  let securityLevel: AndroidSecurityLevel;
  if (kd.attestationSecurityLevel === SecurityLevel.trustedEnvironment) {
    securityLevel = 'trusted-environment';
  } else if (kd.attestationSecurityLevel === SecurityLevel.strongBox) {
    securityLevel = 'strongbox';
  } else {
    return { kind: 'weak-security-level' };
  }

  const purposes = kd.teeEnforced.purpose;
  const hasSign = purposes !== undefined && Array.from(purposes).map(Number).includes(KM_PURPOSE_SIGN);
  if (!hasSign) return { kind: 'wrong-key-purpose' };

  return {
    kind: 'ok',
    securityLevel,
    publicKeySpkiBase64: Buffer.from(leaf.publicKey.rawData).toString('base64'),
    attestationVersion: kd.attestationVersion,
  };
}
