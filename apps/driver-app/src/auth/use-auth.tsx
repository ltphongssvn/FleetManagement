// apps/driver-app/src/auth/use-auth.tsx
// Phone + password auth — now a React Context so a single auth state is
// shared by every screen. Previously useAuth() was a plain hook: each
// caller (home screen, (app) layout, login screen) got its own isolated
// useState, so logout() in one component never updated the auth gate in
// another and the redirect-to-login never fired. AuthProvider holds the
// one source of truth; useAuth() consumes it.
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
import { loadToken, saveToken, clearToken, type StoredToken } from './token-storage.js';
const API_URL =
  (process.env['EXPO_PUBLIC_API_URL'] as string | undefined) ??
  'https://api-production-fd42.up.railway.app';
export interface AuthState {
  readonly status: 'loading' | 'authenticated' | 'unauthenticated';
  readonly error: string | null;
}
export interface UseAuthResult extends AuthState {
  readonly login: (phone: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly getAccessToken: () => Promise<string>;
}
const AuthContext = createContext<UseAuthResult | null>(null);
// Internal: the single auth-state engine. Used once, inside AuthProvider.
function useAuthEngine(): UseAuthResult {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    error: null,
  });
  useEffect(() => {
    void (async () => {
      try {
        const t = await loadToken();
        setState({ status: t === null ? 'unauthenticated' : 'authenticated', error: null });
      } catch {
        // Defensive: any storage failure must not pin status to 'loading'.
        setState({ status: 'unauthenticated', error: null });
      }
    })();
  }, []);
  const login = useCallback(async (phone: string, password: string): Promise<void> => {
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      if (!res.ok) {
        const msg = res.status === 401 ? 'Sai số điện thoại hoặc mật khẩu' : `Lỗi đăng nhập (HTTP ${String(res.status)})`;
        setState({ status: 'unauthenticated', error: msg });
        return;
      }
      const json = (await res.json()) as { accessToken: string };
      const stored: StoredToken = { accessToken: json.accessToken, issuedAt: Math.floor(Date.now() / 1000) };
      await saveToken(stored);
      setState({ status: 'authenticated', error: null });
    } catch (e) {
      setState({ status: 'unauthenticated', error: e instanceof Error ? e.message : 'login error' });
    }
  }, []);
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
// Provider — mount once at the app root so all screens share one auth state.
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useAuthEngine();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
// Consumer hook — every screen calls this; all read the same shared state.
export function useAuth(): UseAuthResult {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
