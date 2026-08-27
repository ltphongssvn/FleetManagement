// packages/sync-protocol/test/keycloak-event-types.test.ts
import { describe, expect, it } from 'vitest';
import { KeycloakLoginEventSchema } from '../src/keycloak-event-types.js';

// A representative master-realm successful LOGIN event as emitted by Keycloak's
// events API. Extra fields (auth_method, etc.) are intentionally present to prove
// the loose (forward-compatible) contract PRESERVES them for the Sentry forensic
// payload rather than dropping or rejecting them.
const loginEvent = {
  time: 1_751_500_000_000,
  type: 'LOGIN',
  realmId: 'master',
  userId: '0f724014-d3c8-4f9e-8720-9a0b1c2d3e4f',
  clientId: 'security-admin-console',
  ipAddress: '203.0.113.7',
  sessionId: 'a1b2c3d4-e5f6-4708-9a0b-1c2d3e4f5a6b',
  details: { username: 'fleet-breakglass-1', auth_method: 'openid-connect' },
};

const ok = (b: unknown): boolean => KeycloakLoginEventSchema.safeParse(b).success;

describe('KeycloakLoginEventSchema', () => {
  it('accepts a valid master-realm LOGIN event', () => {
    expect(ok(loginEvent)).toBe(true);
  });

  it('preserves unknown top-level keys (loose: forward-compatible across Keycloak versions)', () => {
    const parsed = KeycloakLoginEventSchema.safeParse({
      ...loginEvent,
      brandNewKeycloakField: 'v27-only',
    });
    expect(parsed.success).toBe(true);
    expect(
      parsed.success && (parsed.data as Record<string, unknown>)['brandNewKeycloakField'],
    ).toBe('v27-only');
  });

  it('captures details.username (the field the break-glass classifier matches on)', () => {
    const parsed = KeycloakLoginEventSchema.safeParse(loginEvent);
    expect(parsed.success && parsed.data.details?.username).toBe('fleet-breakglass-1');
  });

  it('preserves unknown keys inside details too', () => {
    const parsed = KeycloakLoginEventSchema.safeParse(loginEvent);
    expect(
      parsed.success &&
        (parsed.data.details as Record<string, unknown> | undefined)?.['auth_method'],
    ).toBe('openid-connect');
  });

  it('accepts a LOGIN_ERROR event carrying an error code and no userId', () => {
    const errEvent = {
      time: 1_751_500_001_000,
      type: 'LOGIN_ERROR',
      realmId: 'master',
      error: 'invalid_user_credentials',
      details: { username: 'fleet-breakglass-2' },
    };
    expect(ok(errEvent)).toBe(true);
  });

  it('accepts an event without details (details is optional)', () => {
    const { details: _details, ...noDetails } = loginEvent;
    expect(ok(noDetails)).toBe(true);
  });

  it('rejects a missing required field (type)', () => {
    const { type: _type, ...noType } = loginEvent;
    expect(ok(noType)).toBe(false);
  });

  it('rejects a non-numeric time', () => {
    expect(ok({ ...loginEvent, time: 'yesterday' })).toBe(false);
  });

  it('rejects a missing realmId', () => {
    const { realmId: _realmId, ...noRealm } = loginEvent;
    expect(ok(noRealm)).toBe(false);
  });
});
