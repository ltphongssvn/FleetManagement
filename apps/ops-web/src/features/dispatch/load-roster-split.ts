// apps/ops-web/src/features/dispatch/load-roster-split.ts
// Server-only RSC loader for the dispatched-vs-idle roster panel.
// GET /dispatch/roster-split. Same auth model as its siblings: the JWT comes
// from the fleet_session httpOnly cookie and is never exposed to client JS.
//
// DELIBERATE DIVERGENCE FROM load-board-page.ts. That loader THROWS in
// production on API failure, which is right for it: with no board rows there
// is no page worth rendering. This panel is ADDITIVE to the dispatcher primary
// work surface, so the same policy would take the entire board down over a
// glance widget and stop dispatchers creating orders. Instead this returns
// null on every failure and the page renders the board WITHOUT the panel.
// Degrade the widget, never the page.
//
// 401 is the one exception: an expired session invalidates everything on the
// page, so it still redirects to /login in production like the siblings.
//
// The response is parsed against the SSOT DispatchRosterSplitSchema via the
// contract lenient parse helper. There is NO loader-local schema.
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseDispatchRosterSplit } from '@fleet/sync-protocol';
import type { DispatchRosterSplit } from '@fleet/sync-protocol';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function loadRosterSplit(): Promise<DispatchRosterSplit | null> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) return null;

  const cookieStore = await cookies();
  const authToken = cookieStore.get('fleet_session')?.value;
  if (!authToken) return null;

  let res: Response;
  try {
    res = await fetch(apiUrl + '/dispatch/roster-split', {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + authToken },
    });
  } catch {
    // Network failure: the board itself may still render fine, so swallow.
    return null;
  }

  if (!res.ok) {
    // An expired session is not a panel-local problem - the whole page is
    // unauthenticated - so this one case still redirects.
    if (res.status === 401 && isProduction()) {
      redirect('/login');
    }
    return null;
  }

  let json: unknown;
  try {
    json = (await res.json()) as unknown;
  } catch {
    return null;
  }

  // Lenient SSOT parse: null on any mismatch, never throws.
  return parseDispatchRosterSplit(json);
}
