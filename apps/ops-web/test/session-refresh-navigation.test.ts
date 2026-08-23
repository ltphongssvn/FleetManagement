// apps/ops-web/test/session-refresh-navigation.test.ts
// Unit coverage for the browser session-refresh navigation SSOT. The page
// suites partial-mock navigateToSessionRefresh, so its real body (URL build +
// window.location.assign default, and the pathname+search default arg) is
// exercised here directly. isSessionExpired is the predicate pages branch on.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isSessionExpired,
  sessionRefreshUrl,
  navigateToSessionRefresh,
} from '@/features/auth/session-refresh-navigation';
import { ApiProblemError } from '@/features/errors/api-problem-error';

describe('isSessionExpired', () => {
  it('is true only for an ApiProblemError with status 401', () => {
    expect(isSessionExpired(new ApiProblemError(401, 'UNAUTHORIZED', '401 x'))).toBe(true);
  });
  it('is false for a non-401 ApiProblemError', () => {
    expect(isSessionExpired(new ApiProblemError(500, 'INTERNAL', '500 x'))).toBe(false);
  });
  it('is false for a plain Error and for non-errors', () => {
    expect(isSessionExpired(new Error('401 nope'))).toBe(false);
    expect(isSessionExpired('401')).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});

describe('sessionRefreshUrl', () => {
  it('builds the refresh route with an encoded next', () => {
    expect(sessionRefreshUrl('/admin/drivers')).toBe('/api/auth/refresh?next=%2Fadmin%2Fdrivers');
  });
  it('encodes query strings in the current path', () => {
    expect(sessionRefreshUrl('/x?a=1&b=2')).toBe('/api/auth/refresh?next=%2Fx%3Fa%3D1%26b%3D2');
  });
});

describe('navigateToSessionRefresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the injected navigate with the built URL for an explicit path', () => {
    const nav = vi.fn();
    navigateToSessionRefresh(nav, '/admin/reference');
    expect(nav).toHaveBeenCalledWith('/api/auth/refresh?next=%2Fadmin%2Freference');
  });

  it('defaults currentPath to window.location pathname + search', () => {
    const nav = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/dispatch/orders/XTT.07-001', search: '?tab=cargo' },
    });
    navigateToSessionRefresh(nav);
    expect(nav).toHaveBeenCalledWith(
      '/api/auth/refresh?next=' + encodeURIComponent('/dispatch/orders/XTT.07-001?tab=cargo'),
    );
  });

  it('defaults navigate to window.location.assign', () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign, pathname: '/x', search: '' } });
    navigateToSessionRefresh();
    expect(assign).toHaveBeenCalledWith('/api/auth/refresh?next=%2Fx');
  });
});
