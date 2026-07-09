// apps/driver-app/test/api-url.test.ts
// getApiUrl centralizes EXPO_PUBLIC_API_URL resolution so all driver screens
// + clients share one source of truth (env-read + localhost dev fallback).
//
// Phase 5 (driver-app-security arc): a PRODUCTION build (__DEV__ === false)
// must fail CLOSED on any non-HTTPS base URL -- a cleartext endpoint on a
// real device is a MASVS-NETWORK violation and must crash loudly at
// resolution time, never silently ship. In dev (__DEV__ !== false) the
// localhost + emulator fallbacks stay untouched.
import { describe, it, expect, afterEach } from 'vitest';
import { getApiUrl } from '../src/config/api-url.js';

interface DevGlobal { __DEV__?: boolean }
function setDev(value: boolean | undefined): void {
  const g = globalThis as unknown as DevGlobal;
  if (value === undefined) delete g.__DEV__;
  else g.__DEV__ = value;
}

describe('getApiUrl', () => {
  const original = process.env['EXPO_PUBLIC_API_URL'];
  const originalDev = (globalThis as unknown as DevGlobal).__DEV__;
  afterEach(() => {
    // Literal key (not a variable) to satisfy no-dynamic-delete.
    if (original === undefined) delete process.env['EXPO_PUBLIC_API_URL'];
    else process.env['EXPO_PUBLIC_API_URL'] = original;
    setDev(originalDev);
  });
  it('returns the EXPO_PUBLIC_API_URL value when it is set', () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'https://api.fleet.example.com';
    expect(getApiUrl()).toBe('https://api.fleet.example.com');
  });
  it('falls back to the localhost dev URL when the env var is unset', () => {
    delete process.env['EXPO_PUBLIC_API_URL'];
    expect(getApiUrl()).toBe('http://localhost:3000');
  });
  it('falls back to the localhost dev URL when the env var is an empty string', () => {
    process.env['EXPO_PUBLIC_API_URL'] = '';
    expect(getApiUrl()).toBe('http://localhost:3000');
  });
  it('in dev (__DEV__ true) still allows the localhost cleartext fallback', () => {
    setDev(true);
    delete process.env['EXPO_PUBLIC_API_URL'];
    expect(getApiUrl()).toBe('http://localhost:3000');
  });
  it('in production (__DEV__ false) accepts an https url unchanged', () => {
    setDev(false);
    process.env['EXPO_PUBLIC_API_URL'] = 'https://xe.vominhchau.com';
    expect(getApiUrl()).toBe('https://xe.vominhchau.com');
  });
  it('in production (__DEV__ false) THROWS on an http (cleartext) url', () => {
    setDev(false);
    process.env['EXPO_PUBLIC_API_URL'] = 'http://xe.vominhchau.com';
    expect(() => getApiUrl()).toThrow(/https/i);
  });
  it('in production (__DEV__ false) THROWS when the env var is unset (would fall back to cleartext localhost)', () => {
    setDev(false);
    delete process.env['EXPO_PUBLIC_API_URL'];
    expect(() => getApiUrl()).toThrow(/https/i);
  });
});
