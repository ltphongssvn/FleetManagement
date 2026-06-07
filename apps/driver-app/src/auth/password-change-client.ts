// apps/driver-app/src/auth/password-change-client.ts
// Self-service password change client. POSTs currentPassword + newPassword to
// /driver/me/password with the bearer token. The endpoint returns 204 on
// success (no body). A 401 means the supplied current password was wrong; we
// throw a distinct error so the UI can show "current password incorrect"
// instead of a generic failure. Identity is the JWT, never the body.
export interface PasswordChangeClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string;
  readonly fetchFn?: typeof globalThis.fetch;
}
export class PasswordChangeClient {
  private readonly apiUrl: string;
  private readonly bearerToken: () => string;
  private readonly fetchFn: typeof globalThis.fetch;
  constructor(config: PasswordChangeClientConfig) {
    this.apiUrl = config.apiUrl;
    this.bearerToken = config.bearerToken;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await this.fetchFn(`${this.apiUrl}/driver/me/password`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearerToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.status === 401) {
      throw new Error('Current password is incorrect');
    }
    if (!res.ok) {
      throw new Error(`Password change HTTP ${String(res.status)} ${res.statusText}`);
    }
  }
}
