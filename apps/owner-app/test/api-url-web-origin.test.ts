// apps/owner-app/test/api-url-web-origin.test.ts
// outside-in strict TDD RED (L0): EXPO_PUBLIC_API_URL is build-time inlined, so
// one bundle cannot carry a host reachable from BOTH the Android emulator
// (10.0.2.2) and a host browser (localhost). 10.0.2.2 is an emulator-only alias
// unreachable from a host Chromium (Playwright RN-Web E2E), so the login fetch
// dies silently. Fix: on web, if the inlined host is the emulator alias
// 10.0.2.2, resolve the API host against window.location.hostname. Native (no
// window) keeps the inlined value untouched.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getApiUrl } from '../src/config/api-url.js';
describe('getApiUrl web origin awareness', () => {
  const original = process.env['EXPO_PUBLIC_API_URL'];
  afterEach(() => {
    if (original === undefined) delete process.env['EXPO_PUBLIC_API_URL'];
    else process.env['EXPO_PUBLIC_API_URL'] = original;
    vi.unstubAllGlobals();
  });
  it('rewrites the emulator-only 10.0.2.2 host to the page origin host on web', () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'http://10.0.2.2:3000';
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    expect(getApiUrl()).toBe('http://localhost:3000');
  });
  it('preserves the port when rewriting the emulator host on web', () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'http://10.0.2.2:3000';
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
    expect(getApiUrl()).toBe('http://127.0.0.1:3000');
  });
  it('does NOT rewrite when the env host is not the emulator alias (web)', () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'https://api.fleet.example.com';
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    expect(getApiUrl()).toBe('https://api.fleet.example.com');
  });
  it('does NOT rewrite on native (no window) even for the emulator alias', () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'http://10.0.2.2:3000';
    expect(getApiUrl()).toBe('http://10.0.2.2:3000');
  });
});
