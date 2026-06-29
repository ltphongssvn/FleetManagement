// apps/ops-web/src/features/dispatch/load-board-page.ts
// Server-only RSC loader for the PAGINATED + status-partitioned dispatch board.
// Sibling of load-board.ts: same auth model (JWT from the fleet_session httpOnly
// cookie, never exposed to client JS), same prod-vs-dev failure policy (throw /
// redirect in production; PILOT fallback only in non-production), but targets
// GET /dispatch/board/page?group=&page=&pageSize=&search= and parses the SSOT
// paginated envelope DispatchBoardPageResponseSchema from @fleet/sync-protocol
// (tolerant client view of the rows; full page metadata). There is NO
// loader-local schema; api and ops-web parse/produce the same contract.
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DispatchBoardPageResponseSchema, type DispatchBoardPageResponse, type RoadRunStatusGroup } from '@fleet/sync-protocol';

// Loader params (all optional; defaults mirror the API's RoadRunPageQuerySchema:
// group=active, page=1, pageSize=20). Kept loose here because values originate
// from URL search params; the API is the validating authority.
export interface DispatchBoardPageParams {
  readonly group?: RoadRunStatusGroup;
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
}

const DEFAULT_PAGE_SIZE = 20;

// Empty fallback page for non-production when the API is unreachable / invalid:
// an empty active page keeps the dispatcher UI rendering (mirrors load-board's
// PILOT fallback intent, but pagination has no meaningful fake rows to invent).
function emptyPage(params: DispatchBoardPageParams): DispatchBoardPageResponse {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  return { data: [], page, pageSize, total: 0, totalPages: 0, hasMore: false };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function loadDispatchBoardPage(params: DispatchBoardPageParams): Promise<DispatchBoardPageResponse> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) {
    if (isProduction()) {
      throw new Error('FLEET_API_URL must be set in production');
    }
    return emptyPage(params);
  }
  const cookieStore = await cookies();
  const authToken = cookieStore.get('fleet_session')?.value;
  if (!authToken) {
    if (isProduction()) {
      redirect('/login');
    }
    return emptyPage(params);
  }
  const group: RoadRunStatusGroup = params.group ?? 'active';
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const qs = new URLSearchParams();
  qs.set('group', group);
  qs.set('page', String(page));
  qs.set('pageSize', String(pageSize));
  if (params.search !== undefined && params.search !== '') {
    qs.set('search', params.search);
  }
  const res = await fetch(apiUrl + '/dispatch/board/page?' + qs.toString(), {
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + authToken },
  });
  if (!res.ok) {
    if (res.status === 401) {
      if (isProduction()) {
        redirect('/login');
      }
      return emptyPage(params);
    }
    if (isProduction()) {
      throw new Error('Dispatch board page fetch failed: ' + String(res.status) + ' ' + res.statusText);
    }
    return emptyPage(params);
  }
  const json = (await res.json()) as unknown;
  const parsed = DispatchBoardPageResponseSchema.safeParse(json);
  if (!parsed.success) {
    if (isProduction()) {
      throw new Error('Dispatch board page response shape invalid: ' + parsed.error.message);
    }
    return emptyPage(params);
  }
  return parsed.data;
}
