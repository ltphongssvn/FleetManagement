// apps/ops-web/src/app/page.tsx
// Routing entry — dispatcher home: app shell + roster split panel + create
// order form + live board.
//
// T3 (2026-Q2): form + board are now owned by a single client component
// DispatchView so they can share React useOptimistic state. When the
// create action returns 'created', DispatchView overlays an optimistic
// row on the table before the eventually-consistent dispatch_board
// projection has caught up. Industry-standard 2026 pattern for CQRS
// read-model lag in Next.js 16 + React 19.
//
// PAGINATION (2026): the board is status-partitioned + offset-paginated. This
// RSC reads ?group=&page=&search= from the URL (shareable/bookmarkable — the
// offset advantage), loads ONE page via loadDispatchBoardPage, and passes the
// page slice (initialRuns) plus the page metadata (pagination prop) to
// DispatchView, which renders one tab per SSOT status group (Đang chạy /
// Đã hoàn tất / Lệnh Hủy) + the bottom pagination control. The default view is
// Đang chạy (pending + in-progress). Page navigation is plain-anchor full
// navigation, so each click re-enters this server component with new
// searchParams.
//
// ROSTER SPLIT PANEL (T46): the owner opens this page and needs ONE glance to
// see who is on the road today and who is at home with an idle truck. The
// panel sits ABOVE the form and board because that is the position he reads
// first — a glance layer buried under a form is not a glance layer. It is
// loaded in the SAME Promise.all as the board, so it costs no serial latency.
// loadRosterSplit returns null on any failure (it degrades rather than
// throwing), and a null panel is simply not rendered: a glance widget must
// never take down the dispatcher's primary work surface.
//
// URL PARAMS ARE A TRUST BOUNDARY (Axis-1): searchParams is untrusted input, so
// it is parsed by parseBoardSearchParams against the @fleet/sync-protocol SSOT
// RoadRunPageQuerySchema — never by hand-rolled if-chains here, which drifted
// from the contract (the group union was duplicated, the page/search defaults
// re-implemented). Parsing is lenient: a garbage URL renders the default board.
export const dynamic = 'force-dynamic';
import type { JSX } from 'react';
import { getSessionUsername } from '@/features/auth/session';
import { AppShell } from '@/features/shell/AppShell';
import { loadReferences } from '@/features/dispatch/load-references';
import { loadDispatchBoardPage } from '@/features/dispatch/load-board-page';
import { loadRosterSplit } from '@/features/dispatch/load-roster-split';
import { DispatchView } from '@/features/dispatch/DispatchView';
import { RosterSplitPanel } from '@/features/dispatch/RosterSplitPanel';
import { parseBoardSearchParams } from '@/features/dispatch/parse-board-params';

// Next.js 16 App Router: searchParams is a Promise in async server components.
type SearchParams = Record<string, string | string[] | undefined>;


export default async function HomePage(
  { searchParams }: { searchParams?: Promise<SearchParams> },
): Promise<JSX.Element> {
  const username = await getSessionUsername();
  const sp: SearchParams = searchParams ? await searchParams : {};
  const { group, page, search } = parseBoardSearchParams(sp);
  const [refs, boardPage, rosterSplit] = await Promise.all([
    loadReferences(),
    loadDispatchBoardPage({ group, page, ...(search === undefined ? {} : { search }) }),
    loadRosterSplit(),
  ]);
  return (
    <AppShell {...(username ? { username } : {})}>
      <div className='mx-auto w-full max-w-5xl'>
        <div className='mb-6'>
          <h1 className='text-3xl font-bold tracking-tight text-white drop-shadow-sm'>Bảng điều phối</h1>
          <p className='mt-2 text-sm text-slate-300'>Tạo và phân công lệnh điều xe cho đội xe.</p>
        </div>
        {rosterSplit === null ? null : <RosterSplitPanel split={rosterSplit} />}
        <DispatchView
          initialRuns={boardPage.data}
          searchTerm={search ?? ''}
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
