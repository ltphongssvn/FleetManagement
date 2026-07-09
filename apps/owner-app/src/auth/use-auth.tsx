// apps/owner-app/src/auth/use-auth.tsx
// Keycloak Authorization Code + PKCE auth (RFC 8252 native-app pattern) via
// expo-auth-session, exposed as a React Context so every screen shares one
// auth state. Unlike driver-app (phone+password POST to the API), the owner
// is a privileged Keycloak realm user: login opens the system browser to the
// realm authorize endpoint (PKCE S256), exchanges the returned code for tokens
// at the token endpoint, and persists the access token in SecureStore. The
// OIDC config (discovery URL, client id, native redirect, scopes) comes from
// the validated buildOwnerOidcConfig SSOT; the API trusts these Keycloak
// tokens directly (dual-issuer verifier), and the fleet-owner realm role gates
// the dashboard endpoint. Excluded from unit coverage (native/browser session);
// verified in the manual UI step.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type JSX,
} from 'react';
import { useAuthRequest, exchangeCodeAsync } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { loadToken, saveToken, clearToken, type StoredToken } from './token-storage.js';
import { buildOwnerOidcConfig } from './oidc-config.js';

WebBrowser.maybeCompleteAuthSession();

export interface AuthState {
  readonly status: 'loading' | 'authenticated' | 'unauthenticated';
  readonly error: string | null;
}
export interface UseAuthResult extends AuthState {
  readonly login: () => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly getAccessToken: () => Promise<string>;
}
const AuthContext = createContext<UseAuthResult | null>(null);

// Read env through an unknown boundary + typeof narrowing: in a pnpm monorepo
// projectService can type process.env as any in a clean CI program, so a direct
// read trips no-unsafe-assignment. Assigning any to unknown is safe and typeof
// narrows to string (matches sentry-bootstrap.ts readEnv).
function readEnv(name: string): string | undefined {
  const raw: unknown = process.env[name];
  return typeof raw === 'string' ? raw : undefined;
}
function readOidcConfig(): ReturnType<typeof buildOwnerOidcConfig> {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const extraStr = (key: string): string | undefined => {
    const v = extra[key];
    return typeof v === 'string' ? v : undefined;
  };
  return buildOwnerOidcConfig({
    EXPO_PUBLIC_OIDC_ISSUER: readEnv('EXPO_PUBLIC_OIDC_ISSUER') ?? extraStr('oidcIssuer'),
    EXPO_PUBLIC_OIDC_CLIENT_ID: readEnv('EXPO_PUBLIC_OIDC_CLIENT_ID') ?? extraStr('oidcClientId'),
    EXPO_PUBLIC_OWNER_APP_SCHEME: readEnv('EXPO_PUBLIC_OWNER_APP_SCHEME') ?? 'fleetowner',
  });
}

function useAuthEngine(): UseAuthResult {
  const [state, setState] = useState<AuthState>({ status: 'loading', error: null });
  const cfg = readOidcConfig();

  const [request, , promptAsync] = useAuthRequest(
    {
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      scopes: [...cfg.scopes],
      usePKCE: cfg.usePKCE,
    },
    { authorizationEndpoint: cfg.discoveryUrl.replace('/.well-known/openid-configuration', '/protocol/openid-connect/auth'), tokenEndpoint: cfg.discoveryUrl.replace('/.well-known/openid-configuration', '/protocol/openid-connect/token') },
  );

  useEffect(() => {
    void (async () => {
      try {
        const t = await loadToken();
        setState({ status: t === null ? 'unauthenticated' : 'authenticated', error: null });
      } catch {
        setState({ status: 'unauthenticated', error: null });
      }
    })();
  }, []);

  const login = useCallback(async (): Promise<void> => {
    try {
      const result = await promptAsync();
      if (result.type !== 'success' || result.params['code'] === undefined) {
        setState({ status: 'unauthenticated', error: 'Đăng nhập bị hủy' });
        return;
      }
      const tokenEndpoint = cfg.discoveryUrl.replace('/.well-known/openid-configuration', '/protocol/openid-connect/token');
      const tokenResult = await exchangeCodeAsync(
        {
          clientId: cfg.clientId,
          code: result.params['code'],
          redirectUri: cfg.redirectUri,
          extraParams: request?.codeVerifier ? { code_verifier: request.codeVerifier } : {},
        },
        { tokenEndpoint },
      );
      const stored: StoredToken = { accessToken: tokenResult.accessToken, issuedAt: Math.floor(Date.now() / 1000) };
      await saveToken(stored);
      setState({ status: 'authenticated', error: null });
    } catch (e) {
      setState({ status: 'unauthenticated', error: e instanceof Error ? e.message : 'Lỗi đăng nhập' });
    }
  }, [promptAsync, cfg, request]);

  const logout = useCallback(async (): Promise<void> => {
    await clearToken();
    setState({ status: 'unauthenticated', error: null });
  }, []);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const t = await loadToken();
    if (t === null) throw new Error('Not authenticated');
    return t.accessToken;
  }, []);

  return useMemo(
    () => ({ ...state, login, logout, getAccessToken }),
    [state, login, logout, getAccessToken],
  );
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useAuthEngine();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): UseAuthResult {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
