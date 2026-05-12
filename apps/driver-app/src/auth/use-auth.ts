// apps/driver-app/src/auth/use-auth.ts
// PKCE OIDC auth hook with SecureStore-backed token persistence.
// RFC 8252 + RFC 7636: system browser, PKCE, no client secret, encrypted storage.
import { useCallback, useEffect, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { isTokenExpired, type AuthTokens } from './auth-flow.js';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'fleet.driver.auth.tokens';

const ISSUER =
  (process.env['EXPO_PUBLIC_OIDC_ISSUER'] as string | undefined) ??
  'https://mock-oauth2-production.up.railway.app/fleet';
const CLIENT_ID =
  (process.env['EXPO_PUBLIC_OIDC_CLIENT_ID'] as string | undefined) ?? 'fleet-pilot';

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${ISSUER}/authorize`,
  tokenEndpoint: `${ISSUER}/token`,
  revocationEndpoint: `${ISSUER}/revoke`,
  endSessionEndpoint: `${ISSUER}/endsession`,
};

export interface AuthState {
  readonly status: 'loading' | 'authenticated' | 'unauthenticated';
  readonly tokens: AuthTokens | null;
  readonly error: string | null;
}

export interface UseAuthResult extends AuthState {
  readonly login: () => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly getAccessToken: () => Promise<string>;
}

async function loadTokens(): Promise<AuthTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

async function saveTokens(t: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(t));
}

async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
  const res = await fetch((discovery.tokenEndpoint ?? ""), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Refresh failed: HTTP ${String(res.status)}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

export function useAuth(): UseAuthResult {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    tokens: null,
    error: null,
  });

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'fleetdriver', path: 'auth' });
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      redirectUri,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    },
    discovery,
  );

  useEffect(() => {
    void (async () => {
      const t = await loadTokens();
      if (t === null) {
        setState({ status: 'unauthenticated', tokens: null, error: null });
        return;
      }
      setState({ status: 'authenticated', tokens: t, error: null });
    })();
  }, []);

  const login = useCallback(async (): Promise<void> => {
    if (request === null) return;
    try {
      const result = await promptAsync();
      if (result.type !== 'success' || result.params['code'] === undefined) {
        setState((s) => ({ ...s, error: result.type === 'error' ? (result.error?.message ?? 'login failed') : 'login cancelled' }));
        return;
      }
      const code = result.params['code'];
      const codeVerifier = request.codeVerifier;
      if (codeVerifier === undefined) throw new Error('PKCE code_verifier missing');
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      const res = await fetch((discovery.tokenEndpoint ?? ""), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(`Token exchange HTTP ${String(res.status)}`);
      const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };
      const tokens: AuthTokens = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
      };
      await saveTokens(tokens);
      setState({ status: 'authenticated', tokens, error: null });
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'login error' }));
    }
  }, [request, promptAsync, redirectUri]);

  const logout = useCallback(async (): Promise<void> => {
    await clearTokens();
    setState({ status: 'unauthenticated', tokens: null, error: null });
  }, []);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const t = await loadTokens();
    if (t === null) throw new Error('Not authenticated');
    const now = Math.floor(Date.now() / 1000);
    if (!isTokenExpired(t, now)) return t.accessToken;
    if (t.refreshToken === null) {
      await clearTokens();
      setState({ status: 'unauthenticated', tokens: null, error: 'session expired' });
      throw new Error('Session expired and no refresh token');
    }
    const refreshed = await refreshAccessToken(t.refreshToken);
    await saveTokens(refreshed);
    setState({ status: 'authenticated', tokens: refreshed, error: null });
    return refreshed.accessToken;
  }, []);

  return { ...state, login, logout, getAccessToken };
}
