// apps/driver-app/src/auth/token-storage.ts
// Platform-aware persistence for the driver auth session (rotated pair).
//   - iOS / Android: expo-secure-store (Keychain / Keystore).
//   - Web: localStorage (Docker Compose web preview only; production ships
//     native binaries, never the web bundle).
// StoredToken is schema-validated on read: the payload is a trust boundary
// (Keychain contents survive app updates), so unknown, malformed or LEGACY
// shapes -- the pre-rotation {accessToken, issuedAt} -- resolve to null AND
// are cleared, forcing exactly one clean re-login instead of crashing or
// looping on a stale value forever.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
export const TOKEN_KEY = 'fleet.driver.auth.token';
const StoredTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
export type StoredToken = z.infer<typeof StoredTokenSchema>;
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
  if (raw === null) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    await clearToken();
    return null;
  }
  const parsed = StoredTokenSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // Legacy or foreign payload: clear so the next launch starts clean.
    await clearToken();
    return null;
  }
  return parsed.data;
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
