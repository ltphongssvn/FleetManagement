// apps/driver-app/src/device/device-enroll-client.ts
// Self-enrollment client (device-binding arc, P6 s3). POSTs the device
// platform + appVersion (JWT-gated) to /devices/enroll and returns the
// server-minted deviceId, which the attestation handshake then binds. This
// replaces the removed admin manual-UDID pre-enrollment: the device enrolls
// ITSELF on first authenticated launch. fetch + bearer token are injected so
// the client is unit-testable with no device and no network.
export type FetchFn = typeof globalThis.fetch;
export interface DeviceEnrollClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly platform: 'ios' | 'android';
  readonly appVersion: string;
  readonly expoPushToken?: string;
  readonly fetchFn?: FetchFn;
}
export class DeviceEnrollClient {
  constructor(private readonly config: DeviceEnrollClientConfig) {}
  async enroll(): Promise<string> {
    const token = await this.config.bearerToken();
    const fetchFn: FetchFn = this.config.fetchFn ?? globalThis.fetch;
    const payload: Record<string, unknown> = {
      platform: this.config.platform,
      appVersion: this.config.appVersion,
    };
    if (this.config.expoPushToken !== undefined) payload['expoPushToken'] = this.config.expoPushToken;
    const res = await fetchFn(this.config.apiUrl + '/devices/enroll', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error('/devices/enroll HTTP ' + String(res.status) + ' ' + res.statusText);
    }
    const body = (await res.json()) as { deviceId?: unknown };
    if (typeof body.deviceId !== 'string') throw new Error('enroll response missing deviceId');
    return body.deviceId;
  }
}
