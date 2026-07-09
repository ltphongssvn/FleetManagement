// apps/owner-app/test/query-client.test.ts
// TDD RED: createQueryClient builds the app-wide TanStack Query client with
// the owner-app defaults — bounded retries and a stale window so a screen
// revisited within the window does not hard-refetch.
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createQueryClient } from '../src/data/query-client.js';
describe('createQueryClient', () => {
  it('returns a QueryClient instance', () => {
    expect(createQueryClient()).toBeInstanceOf(QueryClient);
  });
  it('applies a finite query retry count (not infinite)', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(typeof defaults.queries?.retry).toBe('number');
    expect(defaults.queries?.retry as number).toBeGreaterThan(0);
  });
  it('applies a non-zero staleTime so recent data is reused', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(typeof defaults.queries?.staleTime).toBe('number');
    expect(defaults.queries?.staleTime as number).toBeGreaterThan(0);
  });
  it('returns a fresh client per call (no shared singleton state)', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
