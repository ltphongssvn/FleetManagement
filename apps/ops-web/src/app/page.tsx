// apps/ops-web/src/app/page.tsx
// Routing entry — dispatcher home: app shell + create order form + live board.
//
// T3 (2026-Q2): form + board are now owned by a single client component
// DispatchView so they can share React useOptimistic state. When the
// create action returns 'created', DispatchView overlays an optimistic
// row on the table before the eventually-consistent dispatch_board
// projection has caught up. Industry-standard 2026 pattern for CQRS
// read-model lag in Next.js 16 + React 19.
//
// PAGINATION (2026): the board is status-partitioned + offset-paginated. This
// RSC reads ?group=&page= from the URL (shareable/bookmarkable — the offset
// advantage), loads ONE page via loadDispatchBoardPage, and passes the page
// slice (initialRuns) plus the page metadata (pagination prop) to DispatchView,
// which renders the Active/Finished tabs + the bottom pagination control. The
// default view is Active (pending + in-progress); Finished is reached via the
// tab. Page navigation is plain-anchor full navigation, so each click re-enters
// this server component with new searchParams.
export const dynamic = 'force-dynamic';
import type { JSX } from 'react';
import { cookies } from 'next/headers';
import { AppShell } from '@/features/shell/AppShell';
import { loadReferences } from '@/features/dispatch/load-references';
import { loadDispatchBoardPage } from '@/features/dispatch/load-board-page';
import { DispatchView, type BoardStatusGroup } from '@/features/dispatch/DispatchView';

function decodeUsername(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { preferred_username?: string; sub?: string };
    return claims.preferred_username ?? claims.sub;
  } catch {
    return undefined;
  }
}

// Next.js 16 App Router: searchParams is a Promise in async server components.
type SearchParams = Record<string, string | string[] | undefined>;

// Normalize the ?group= param to the allowed union; anything else => active
// (the default view), so a hand-edited/garbage URL never 400s the page.
function parseGroup(raw: string | string[] | undefined): BoardStatusGroup {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'finished' ? 'finished' : 'active';
}
// Parse ?page= to a positive integer; default 1. The API re-validates/caps.
function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

export default async function HomePage(
  { searchParams }: { searchParams?: Promise<SearchParams> },
): Promise<JSX.Element> {
  const cookieStore = await cookies();
  const username = decodeUsername(cookieStore.get('fleet_session')?.value);
  const sp: SearchParams = searchParams ? await searchParams : {};
  const group = parseGroup(sp['group']);
  const page = parsePage(sp['page']);
  const [refs, boardPage] = await Promise.all([
    loadReferences(),
    loadDispatchBoardPage({ group, page }),
  ]);
  return (
    <AppShell {...(username ? { username } : {})}>
      <div className='mx-auto w-full max-w-5xl'>
        <div className='mb-6'>
          <h1 className='text-3xl font-bold tracking-tight text-white drop-shadow-sm'>Bảng điều phối</h1>
          <p className='mt-2 text-sm text-slate-300'>Tạo và phân công lệnh điều xe cho đội xe.</p>
        </div>
        <DispatchView
          initialRuns={boardPage.data}
          pagination={{
            group,
            page: boardPage.page,
            pageSize: boardPage.pageSize,
            total: boardPage.total,
            totalPages: boardPage.totalPages,
            hasMore: boardPage.hasMore,
          }}
          refs={{
            drivers: refs.drivers,
            vehicles: refs.vehicles,
            customers: refs.customers,
            cargoTypes: refs.cargoTypes,
            pickupWarehouses: refs.pickupWarehouses,
            deliveryWarehouses: refs.deliveryWarehouses,
            driverVehicleAssignments: refs.driverVehicleAssignments,
            nextOrderRef: refs.nextOrderRef,
          }}
        />
      </div>
    </AppShell>
  );
}
