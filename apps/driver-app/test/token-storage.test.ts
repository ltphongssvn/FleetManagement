// apps/driver-app/test/token-storage.test.ts
// TDD RED: token storage must work on BOTH native (expo-secure-store) and
// web (localStorage). The original use-auth.ts called SecureStore directly,
// and on web ExpoSecureStore.getValueWithKeyAsync is undefined, throwing
// at first render and pinning auth state to 'loading' (the spinner).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TOKEN_KEY = 'fleet.driver.auth.token';
const sample = { accessToken: 'abc.def.ghi', issuedAt: 1700000000 };

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
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(async () => { throw new Error('SecureStore not available on web'); }),
      setItemAsync: vi.fn(async () => { throw new Error('SecureStore not available on web'); }),
      deleteItemAsync: vi.fn(async () => { throw new Error('SecureStore not available on web'); }),
    }));
    (globalThis as unknown as { localStorage: MemStore }).localStorage = makeMemStore();
  });

  it('saveToken + loadToken round-trips via localStorage', async () => {
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
    (globalThis as unknown as { localStorage: MemStore }).localStorage.setItem(TOKEN_KEY, '{not json');
    const mod = await import('../src/auth/token-storage.js');
    expect(await mod.loadToken()).toBeNull();
  });
});

describe('token-storage on native (ios/android)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('saveToken delegates to SecureStore.setItemAsync', async () => {
    const setItemAsync = vi.fn(async () => undefined);
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(async () => null),
      setItemAsync,
      deleteItemAsync: vi.fn(async () => undefined),
    }));
    const mod = await import('../src/auth/token-storage.js');
    await mod.saveToken(sample);
    expect(setItemAsync).toHaveBeenCalledWith(TOKEN_KEY, JSON.stringify(sample));
  });

  it('loadToken delegates to SecureStore.getItemAsync and parses JSON', async () => {
    vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(async () => JSON.stringify(sample)),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    }));
    const mod = await import('../src/auth/token-storage.js');
    expect(await mod.loadToken()).toEqual(sample);
  });

  it('clearToken delegates to SecureStore.deleteItemAsync', async () => {
    const deleteItemAsync = vi.fn(async () => undefined);
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(async () => null),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync,
    }));
    const mod = await import('../src/auth/token-storage.js');
    await mod.clearToken();
    expect(deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
  });
});
