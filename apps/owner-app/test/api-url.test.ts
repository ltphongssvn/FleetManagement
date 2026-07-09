// apps/owner-app/test/api-url.test.ts
// TDD RED: getApiUrl centralizes EXPO_PUBLIC_API_URL resolution so all
// driver screens + clients share one source of truth instead of each
// re-implementing the env-read + localhost dev fallback.
import { describe, it, expect, afterEach } from 'vitest';
import { getApiUrl } from '../src/config/api-url.js';
describe('getApiUrl', () => {
  const original = process.env['EXPO_PUBLIC_API_URL'];
  afterEach(() => {
    // Literal key (not a variable) to satisfy no-dynamic-delete.
    if (original === undefined) delete process.env['EXPO_PUBLIC_API_URL'];
    else process.env['EXPO_PUBLIC_API_URL'] = original;
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
});
