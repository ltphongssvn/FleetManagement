// apps/driver-app/test/token-storage.test.ts
// Phase 4.1 RED (driver-app-security arc): StoredToken becomes the rotated
// pair {accessToken, refreshToken, expiresAt} (schema-validated), replacing
// the legacy {accessToken, issuedAt} shape that silently dropped the refresh
// token. Legacy or malformed payloads must resolve to null AND be cleared
// from storage (fail to re-login exactly once, never crash, never loop on a
// stale legacy value). Platform split preserved: SecureStore native,
// localStorage web.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const TOKEN_KEY = 'fleet.driver.auth.token';
const sample = { accessToken: 'abc.def.ghi', refreshToken: 'r'.repeat(64), expiresAt: 1799999999 };
const legacy = { accessToken: 'abc.def.ghi', issuedAt: 1700000000 };
interface MemStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
function makeMemStore(): MemStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}
describe('token-storage on web', () => {
  let store: MemStore;
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.reject(new Error('SecureStore not available on web'))),
      setItemAsync: vi.fn(() => Promise.reject(new Error('SecureStore not available on web'))),
      deleteItemAsync: vi.fn(() => Promise.reject(new Error('SecureStore not available on web'))),
    }));
    store = makeMemStore();
    (globalThis as unknown as { localStorage: MemStore }).localStorage = store;
  });
  it('saveToken + loadToken round-trips the rotated pair via localStorage', async () => {
    const mod = await import('../src/auth/token-storage.js');
    await mod.saveToken(sample);
    const back = await mod.loadToken();
    expect(back).toEqual(sample);
  });
  it('loadToken returns null when no token stored', async () => {
    const mod = await import('../src/auth/token-storage.js');
    expect(await mod.loadToken()).toBeNull();
  });
  it('clearToken removes the value', async () => {
    const mod = await import('../src/auth/token-storage.js');
    await mod.saveToken(sample);
    await mod.clearToken();
    expect(await mod.loadToken()).toBeNull();
  });
  it('loadToken returns null on malformed JSON instead of throwing', async () => {
    store.setItem(TOKEN_KEY, '{not json');
    const mod = await import('../src/auth/token-storage.js');
    expect(await mod.loadToken()).toBeNull();
  });
  it('loadToken treats the legacy {accessToken, issuedAt} shape as absent AND clears it', async () => {
    store.setItem(TOKEN_KEY, JSON.stringify(legacy));
    const mod = await import('../src/auth/token-storage.js');
    expect(await mod.loadToken()).toBeNull();
    expect(store.getItem(TOKEN_KEY)).toBeNull();
  });
});
describe('token-storage on native (ios/android)', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it('saveToken delegates the rotated pair to SecureStore.setItemAsync', async () => {
    const setItemAsync = vi.fn(() => Promise.resolve(undefined));
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve(null)),
      setItemAsync,
      deleteItemAsync: vi.fn(() => Promise.resolve(undefined)),
    }));
    const mod = await import('../src/auth/token-storage.js');
    await mod.saveToken(sample);
    expect(setItemAsync).toHaveBeenCalledWith(TOKEN_KEY, JSON.stringify(sample));
  });
  it('loadToken delegates to SecureStore.getItemAsync and parses the pair', async () => {
    vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve(JSON.stringify(sample))),
      setItemAsync: vi.fn(() => Promise.resolve(undefined)),
      deleteItemAsync: vi.fn(() => Promise.resolve(undefined)),
    }));
    const mod = await import('../src/auth/token-storage.js');
    expect(await mod.loadToken()).toEqual(sample);
  });
  it('loadToken clears a legacy native payload via deleteItemAsync and returns null', async () => {
    const deleteItemAsync = vi.fn(() => Promise.resolve(undefined));
    vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve(JSON.stringify(legacy))),
      setItemAsync: vi.fn(() => Promise.resolve(undefined)),
      deleteItemAsync,
    }));
    const mod = await import('../src/auth/token-storage.js');
    expect(await mod.loadToken()).toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
  });
  it('clearToken delegates to SecureStore.deleteItemAsync', async () => {
    const deleteItemAsync = vi.fn(() => Promise.resolve(undefined));
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve(null)),
      setItemAsync: vi.fn(() => Promise.resolve(undefined)),
      deleteItemAsync,
    }));
    const mod = await import('../src/auth/token-storage.js');
    await mod.clearToken();
    expect(deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
  });
});
