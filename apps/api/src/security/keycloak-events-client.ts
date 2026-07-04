// apps/api/src/security/keycloak-events-client.ts
// Outbound client for the Keycloak master-realm login-events API, used by the
// break-glass monitor. Two calls: POST the token endpoint with client_credentials
// (confidential fleet-breakglass-monitor client), then GET the admin events endpoint
// (type=LOGIN, dateFrom=cursor ms, direction=asc) with the bearer token. Events are
// parsed with KeycloakLoginEventSchema (loose/forward-compatible). fetchFn is an
// injected seam (globalThis.fetch fallback), mirroring FetchErpClient.
import { KeycloakLoginEventSchema, type KeycloakLoginEvent } from '@fleet/sync-protocol';

export interface KeycloakEventsClientConfig {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchFn?: typeof globalThis.fetch;
}

export class KeycloakEventsClient {
  constructor(private readonly config: KeycloakEventsClientConfig) {}

  async fetchLoginEventsSince(sinceMs: number): Promise<KeycloakLoginEvent[]> {
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const token = await this.fetchToken(fetchFn);
    return this.fetchEvents(fetchFn, token, sinceMs);
  }

  private async fetchToken(fetchFn: typeof globalThis.fetch): Promise<string> {
    const url = `${this.config.baseUrl}/realms/${this.config.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }).toString();
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Keycloak token HTTP ${String(res.status)} ${res.statusText} ${detail}`);
    }
    const json = (await res.json()) as { access_token?: unknown };
    if (typeof json.access_token !== 'string') {
      throw new Error('Keycloak token response missing access_token');
    }
    return json.access_token;
  }

  private async fetchEvents(
    fetchFn: typeof globalThis.fetch,
    token: string,
    sinceMs: number,
  ): Promise<KeycloakLoginEvent[]> {
    const url = new URL(`${this.config.baseUrl}/admin/realms/${this.config.realm}/events`);
    url.searchParams.set('type', 'LOGIN');
    url.searchParams.set('dateFrom', String(sinceMs));
    url.searchParams.set('direction', 'asc');
    const res = await fetchFn(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Keycloak events HTTP ${String(res.status)} ${res.statusText} ${detail}`);
    }
    const json = await res.json();
    return KeycloakLoginEventSchema.array().parse(json);
  }
}
