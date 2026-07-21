// apps/ops-web/src/features/auth/session-refresh-navigation.ts
// Browser-side SSOT for recovering an idle-expired session: full-page
// navigation to /api/auth/refresh?next=<current>, where the server either
// silently re-mints from the httpOnly fleet_refresh cookie and returns the
// dispatcher to the same page, or clears cookies and lands on the
// public-origin /login?error=session_expired. A FULL navigation (not router
// push) is required so the rotated Set-Cookie pair rides a top-level
// document request. isSessionExpired is the one predicate pages branch on;
// the assign/path parameters are injectable for tests (house FetchFn style)
// -- jsdom cannot intercept real window.location writes.
import { ApiProblemError } from '@/features/errors/api-problem-error';

export function isSessionExpired(e: unknown): boolean {
  return e instanceof ApiProblemError && e.status === 401;
}

export type NavigateFn = (url: string) => void;

export function sessionRefreshUrl(currentPath: string): string {
  return '/api/auth/refresh?next=' + encodeURIComponent(currentPath);
}

export function navigateToSessionRefresh(
  navigate: NavigateFn = (url: string): void => { window.location.assign(url); },
  currentPath: string = window.location.pathname + window.location.search,
): void {
  navigate(sessionRefreshUrl(currentPath));
}
