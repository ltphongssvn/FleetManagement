// apps/ops-web/test/oidc-pkce.test.ts
// RED-first spec for the pure PKCE authorization-request builder. Deterministic
// via an injected random source; the S256 challenge is checked against an
// independently computed SHA-256 so the encoding is pinned, not assumed.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fc from 'fast-check';

// Repo convention: neutralize the 'server-only' import guard under jsdom.
vi.mock('server-only', () => ({}));
import { AuthorizationRequestConfigSchema } from '../src/features/auth/oidc-authorization.schema';
import {
  buildAuthorizationRequest,
  deriveCodeChallenge,
  type PkceRandomSource,
} from '../src/features/auth/oidc-pkce';

const ENDPOINT = 'https://kc.example.com/realms/fleet/protocol/openid-connect/auth';

// Returns fixed values in call order: verifier, state, nonce.
function fixedRandom(values: string[]): PkceRandomSource {
  let i = 0;
  return { randomBase64Url: (): string => values[i++] ?? 'x' };
}

const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

describe('@fleet/ops-web - PKCE authorization request', () => {
  it('deriveCodeChallenge is base64url(SHA-256(verifier))', async () => {
    const verifier = 'fixed-code-verifier-value';
    await expect(deriveCodeChallenge(verifier)).resolves.toBe(s256(verifier));
  });

  it('builds an authorize URL with response_type=code and S256 challenge', async () => {
    const req = await buildAuthorizationRequest(
      {
        authorizationEndpoint: ENDPOINT,
        clientId: 'ops-web',
        redirectUri: 'https://ops.example.com/api/auth/callback',
      },
      fixedRandom(['verifier-1', 'state-1', 'nonce-1']),
    );
    const url = new URL(req.authorizeUrl);
    expect(url.origin + url.pathname).toBe(ENDPOINT);
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('ops-web');
    expect(p.get('redirect_uri')).toBe('https://ops.example.com/api/auth/callback');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe(s256('verifier-1'));
    expect(p.get('state')).toBe('state-1');
    expect(p.get('nonce')).toBe('nonce-1');
    expect(req.codeVerifier).toBe('verifier-1');
    expect(req.state).toBe('state-1');
    expect(req.nonce).toBe('nonce-1');
  });

  it('defaults scope to openid profile fleet, space-delimited', async () => {
    const req = await buildAuthorizationRequest(
      {
        authorizationEndpoint: ENDPOINT,
        clientId: 'ops-web',
        redirectUri: 'https://ops.example.com/cb',
      },
      fixedRandom(['v', 's', 'n']),
    );
    expect(new URL(req.authorizeUrl).searchParams.get('scope')).toBe('openid profile fleet');
  });

  it('includes acr_values only when configured (drives dispatcher step-up at login)', async () => {
    const without = await buildAuthorizationRequest(
      {
        authorizationEndpoint: ENDPOINT,
        clientId: 'ops-web',
        redirectUri: 'https://ops.example.com/cb',
      },
      fixedRandom(['v', 's', 'n']),
    );
    expect(new URL(without.authorizeUrl).searchParams.has('acr_values')).toBe(false);

    const withAcr = await buildAuthorizationRequest(
      {
        authorizationEndpoint: ENDPOINT,
        clientId: 'ops-web',
        redirectUri: 'https://ops.example.com/cb',
        acrValues: 'aal2',
      },
      fixedRandom(['v', 's', 'n']),
    );
    expect(new URL(withAcr.authorizeUrl).searchParams.get('acr_values')).toBe('aal2');
  });

  it('rejects an invalid config via the schema (non-url endpoint)', () => {
    expect(() =>
      AuthorizationRequestConfigSchema.parse({
        authorizationEndpoint: 'not-a-url',
        clientId: 'x',
        redirectUri: 'https://o/cb',
      }),
    ).toThrow();
  });

  it('property: code_challenge is URL-safe base64 with no padding', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 43, maxLength: 128 }), async (verifier) => {
        const challenge = await deriveCodeChallenge(verifier);
        return /^[A-Za-z0-9_-]+$/.test(challenge);
      }),
      { numRuns: 25 },
    );
  });
});
