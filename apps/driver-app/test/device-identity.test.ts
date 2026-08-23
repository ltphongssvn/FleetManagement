// apps/driver-app/test/device-identity.test.ts
// RED (device-binding arc, P6 s1): getOrCreateInstallationId persists a
// generated installation id in SecureStore once and returns the same value
// thereafter. This is a CORRELATION key only (never proof; trust comes from
// attestation). Format: a 36-char UUID validated on read (SecureStore is a
// trust boundary -- a malformed/foreign value is replaced, not trusted).
import { describe, it, expect, beforeEach, vi } from 'vitest';
const KEY = 'fleet.driver.device.installationId';
describe('device-identity on native', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it('generates and persists an installation id on first call', async () => {
    const setItemAsync = vi.fn(() => Promise.resolve(undefined));
    vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve(null)),
      setItemAsync,
      deleteItemAsync: vi.fn(() => Promise.resolve(undefined)),
    }));
    const mod = await import('../src/device/device-identity.js');
    const id = await mod.getOrCreateInstallationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(setItemAsync).toHaveBeenCalledWith(KEY, id);
  });
  it('returns the existing id without regenerating', async () => {
    const existing = '018f6b2a-1111-7000-8000-000000000001';
    const setItemAsync = vi.fn(() => Promise.resolve(undefined));
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve(existing)),
      setItemAsync,
      deleteItemAsync: vi.fn(() => Promise.resolve(undefined)),
    }));
    const mod = await import('../src/device/device-identity.js');
    expect(await mod.getOrCreateInstallationId()).toBe(existing);
    expect(setItemAsync).not.toHaveBeenCalled();
  });
  it('replaces a malformed stored value with a fresh id', async () => {
    const setItemAsync = vi.fn(() => Promise.resolve(undefined));
    vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve('not-a-uuid')),
      setItemAsync,
      deleteItemAsync: vi.fn(() => Promise.resolve(undefined)),
    }));
    const mod = await import('../src/device/device-identity.js');
    const id = await mod.getOrCreateInstallationId();
    expect(id).toMatch(/^[0-9a-f]{8}-/i);
    expect(setItemAsync).toHaveBeenCalledWith(KEY, id);
  });
});
