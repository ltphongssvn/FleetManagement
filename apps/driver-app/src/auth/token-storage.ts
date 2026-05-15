// apps/driver-app/src/auth/token-storage.ts
// Platform-aware persistence for the driver auth token.
//   - iOS / Android: expo-secure-store (Keychain / Keystore).
//   - Web: localStorage (good-enough for the Docker Compose web preview;
//     the production app ships native binaries, never the web bundle).
// Centralising this avoids ExpoSecureStore throwing on web at first render,
// which used to leave the auth state pinned to 'loading' (a spinner with
// no login screen visible).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const TOKEN_KEY = 'fleet.driver.auth.token';

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
  const raw: string | null = Platform.OS === 'web'
    ? webStorage()?.getItem(TOKEN_KEY) ?? null
    : await SecureStore.getItemAsync(TOKEN_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredToken;
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
