// apps/driver-app/src/auth/use-auth.ts
// Phone + password auth hook. Calls POST /auth/login, persists JWT in SecureStore.
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'fleet.driver.auth.token';

const API_URL =
  (process.env['EXPO_PUBLIC_API_URL'] as string | undefined) ??
  'https://api-production-fd42.up.railway.app';

interface StoredToken {
  readonly accessToken: string;
  readonly issuedAt: number;
}

export interface AuthState {
  readonly status: 'loading' | 'authenticated' | 'unauthenticated';
  readonly error: string | null;
}

export interface UseAuthResult extends AuthState {
  readonly login: (phone: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly getAccessToken: () => Promise<string>;
}

async function loadToken(): Promise<StoredToken | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

async function saveToken(t: StoredToken): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(t));
}

async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function useAuth(): UseAuthResult {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    error: null,
  });

  useEffect(() => {
    void (async () => {
      const t = await loadToken();
      setState({ status: t === null ? 'unauthenticated' : 'authenticated', error: null });
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
      await saveToken({ accessToken: json.accessToken, issuedAt: Math.floor(Date.now() / 1000) });
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
