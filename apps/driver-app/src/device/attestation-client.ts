// apps/driver-app/src/device/attestation-client.ts
// Device attestation handshake client (device-binding arc, P6 s2). Steps:
//   1. GET /device/attest/nonce  -> a fresh server challenge.
//   2. Produce the platform proof via the injected app-integrity port:
//      Android -> prepare an attested key, read its base64 DER cert chain
//        (leaf-first) and join with newlines (the token format the API
//        AttestationService decodes).
//      iOS -> prepare a key, attest it against the nonce, send the resulting
//        attestationObject as the token plus the keyId.
//   3. POST /device/attest/verify -> the API verifies + flips binding to
//      pending. A rejection surfaces as a thrown error the caller maps to
//      Vietnamese via presentApiError.
// The native module and fetch are injected so this is unit-testable with no
// device and no network.
export type FetchFn = typeof globalThis.fetch;

// Port over @expo/app-integrity. platform selects the proof path; the four
// methods wrap the native calls (prepareKey/attestKey/getCertificateChain).
export interface AppIntegrityPort {
  readonly platform: 'ios' | 'android';
  isAvailable(): Promise<boolean>;
  prepareKey(): Promise<string>;
  attestKey(keyId: string, challenge: string): Promise<string | undefined>;
  getCertificateChain(keyId: string): Promise<string[]>;
}

export interface AttestationClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly integrity: AppIntegrityPort;
  readonly deviceId: string;
  readonly fetchFn?: FetchFn;
}

export type AttestationResult =
  | { readonly verified: true }
  | { readonly verified: false; readonly reason: 'unavailable' };

export class AttestationClient {
  constructor(private readonly config: AttestationClientConfig) {}
  private fetchFn(): FetchFn {
    return this.config.fetchFn ?? globalThis.fetch;
  }
  private async getNonce(token: string): Promise<string> {
    const res = await this.fetchFn()(this.config.apiUrl + '/device/attest/nonce', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) {
      throw new Error('/device/attest/nonce HTTP ' + String(res.status) + ' ' + res.statusText);
    }
    const body = (await res.json()) as { nonce?: unknown };
    if (typeof body.nonce !== 'string') throw new Error('nonce response missing nonce');
    return body.nonce;
  }
  async attest(): Promise<AttestationResult> {
    if (!(await this.config.integrity.isAvailable())) {
      return { verified: false, reason: 'unavailable' };
    }
    const bearer = await this.config.bearerToken();
    const nonce = await this.getNonce(bearer);
    const keyId = await this.config.integrity.prepareKey();
    let token: string;
    let keyIdForBody: string | undefined;
    if (this.config.integrity.platform === 'android') {
      const chain = await this.config.integrity.getCertificateChain(keyId);
      token = chain.join(String.fromCharCode(10));
    } else {
      const attestationObject = await this.config.integrity.attestKey(keyId, nonce);
      if (attestationObject === undefined) throw new Error('iOS attestation produced no object');
      token = attestationObject;
      keyIdForBody = keyId;
    }
    const payload: Record<string, unknown> = {
      platform: this.config.integrity.platform,
      token,
      deviceId: this.config.deviceId,
    };
    if (keyIdForBody !== undefined) payload['keyId'] = keyIdForBody;
    const res = await this.fetchFn()(this.config.apiUrl + '/device/attest/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error('/device/attest/verify HTTP ' + String(res.status) + ' ' + res.statusText);
    }
    return { verified: true };
  }
}
