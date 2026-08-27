// apps/driver-app/src/auth/use-auth.tsx
// Phone + password auth as a React Context: one shared auth state for every
// screen. All token logic (rotated-pair persistence, skew-aware single-flight
// refresh, fail-closed expiry, best-effort logout revoke) lives in the
// framework-free SessionManager; this file is thin wiring. getAccessToken now
// delegates to the manager, so any screen's next API call transparently
// refreshes a near-expired token -- and a server-side reuse/expiry (401)
// clears storage and flips the gate to unauthenticated exactly once.
//
// The API base URL resolves through the single source of truth getApiUrl()
// (api-url.ts) so web (RN-Web E2E) and native share one resolution path.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type JSX,
} from 'react';
import { loadToken, saveToken, clearToken } from './token-storage.js';
import { SessionManager, NotAuthenticatedError, SessionExpiredError } from './session-manager.js';
import { getApiUrl } from '../config/api-url.js';
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
function useAuthEngine(): UseAuthResult {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    error: null,
  });
  // One SessionManager for the provider's lifetime. The storage port adapts
  // the platform-aware token-storage module; fetch is the platform global.
  const managerRef = useRef<SessionManager | null>(null);
  managerRef.current ??= new SessionManager({
    apiUrl: getApiUrl(),
    fetchFn: (input, init) => fetch(input, init),
    storage: { load: loadToken, save: saveToken, clear: clearToken },
  });
  const manager = managerRef.current;
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
  const login = useCallback(
    async (phone: string, password: string): Promise<void> => {
      try {
        const result = await manager.login(phone, password);
        switch (result.kind) {
          case 'ok':
            setState({ status: 'authenticated', error: null });
            return;
          case 'invalid-credentials':
            setState({ status: 'unauthenticated', error: 'Sai số điện thoại hoặc mật khẩu' });
            return;
          case 'protocol-error':
            setState({ status: 'unauthenticated', error: 'Lỗi máy chủ: phản hồi không hợp lệ' });
            return;
          case 'http-error':
            setState({
              status: 'unauthenticated',
              error: 'Lỗi đăng nhập (HTTP ' + String(result.status) + ')',
            });
            return;
        }
      } catch (e) {
        setState({
          status: 'unauthenticated',
          error: e instanceof Error ? e.message : 'login error',
        });
      }
    },
    [manager],
  );
  const logout = useCallback(async (): Promise<void> => {
    await manager.logout();
    setState({ status: 'unauthenticated', error: null });
  }, [manager]);
  const getAccessToken = useCallback(async (): Promise<string> => {
    try {
      return await manager.getAccessToken();
    } catch (e) {
      // A dead session (nothing stored, or refresh rejected server-side) must
      // flip the shared gate so the app redirects to login.
      if (e instanceof NotAuthenticatedError || e instanceof SessionExpiredError) {
        setState({ status: 'unauthenticated', error: null });
      }
      throw e;
    }
  }, [manager]);
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
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
