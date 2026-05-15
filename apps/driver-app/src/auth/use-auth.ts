// apps/driver-app/src/auth/use-auth.ts
// Phone + password auth hook. Calls POST /auth/login, persists JWT via
// the platform-aware token-storage module (SecureStore on native,
// localStorage on web).
import { useCallback, useEffect, useState } from 'react';
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

export function useAuth(): UseAuthResult {
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
  return { ...state, login, logout, getAccessToken };
}
