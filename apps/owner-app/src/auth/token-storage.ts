// apps/owner-app/src/auth/token-storage.ts
// Platform-aware persistence for the owner auth token.
//   - iOS / Android: expo-secure-store (Keychain / Keystore).
//   - Web: localStorage (Docker Compose web preview only; production ships
//     native binaries). Centralising avoids ExpoSecureStore throwing on web
//     at first render, which would pin auth state to 'loading'.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
export const TOKEN_KEY = 'fleet.owner.auth.token';
export interface StoredToken {
  readonly accessToken: string;
  readonly issuedAt: number;
}
interface WebStorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
function webStorage(): WebStorageLike | null {
  const g = globalThis as unknown as { localStorage?: WebStorageLike };
  return g.localStorage ?? null;
}
export async function loadToken(): Promise<StoredToken | null> {
  let raw: string | null;
  if (Platform.OS === 'web') {
    /* c8 ignore next -- defensive null guard for non-browser web envs */
    raw = webStorage()?.getItem(TOKEN_KEY) ?? null;
  } else {
    raw = await SecureStore.getItemAsync(TOKEN_KEY);
  }
  // EQUIVALENT MUTANT. Removing this guard is harmless: the next statement is
  // JSON.parse(raw), and JSON.parse(null) coerces to 'null' and returns null --
  // the exact value this line returns. Both variants yield null on every input,
  // so no assertion can separate them. The guard stays because relying on that
  // coercion would be a trap for the next reader.
  // Stryker disable next-line ConditionalExpression: equivalent, see above
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredToken;
    /* c8 ignore next 3 -- defensive: corrupted storage payload */
  } catch {
    return null;
  }
}
export async function saveToken(t: StoredToken): Promise<void> {
  const payload = JSON.stringify(t);
  if (Platform.OS === 'web') {
    webStorage()?.setItem(TOKEN_KEY, payload);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, payload);
}
export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    webStorage()?.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
