// apps/ops-web/src/features/dispatch/DispatchView.tsx
// T3 (2026-Q2) optimistic UI wrapper. Owns BOTH the CreateOrderForm and
// the DispatchBoard table on the dispatcher home page.
//
// T6 (2026): the dispatch board row uses a plain <a> with NO JS handler.
// Under the parent re-render cascade, the App Router <Link> (and router.push
// from an onClick) falls into a stuck-prefetch loop (vercel/next.js#57565):
// clicks emit RSC fetches that return 200 but the router never commits the
// navigation, retrying until ERR_INSUFFICIENT_RESOURCES. The 2026 escape hatch
// is native browser navigation: a plain anchor with href triggers a full-page
// load that bypasses Next.js's RSC state machine entirely. The pagination +
// status-filter controls below use the SAME plain-anchor navigation for the
// same reason (and because offset pagination maps onto shareable URL state).
//
// RE-RENDER LOOP FIX (2026): the board previously ran a useOptimistic hook IN
// PARALLEL with a stickyRuns useState. After create, router.refresh() produced
// a fresh initialRuns reference each cycle; the useOptimistic value was
// re-derived on every render and, combined with the auto-prefetching <a> rows
// re-mounting, drove an unbounded RSC re-render storm (?_rsc= ->
// ERR_INSUFFICIENT_RESOURCES; server [loadReferences] repeating endlessly;
// blinking board). The optimistic row is fully served by stickyRuns (plain
// useState), which converges: it is appended once on create and pruned once
// the real projection row arrives. Removing the redundant useOptimistic stops
// the loop while preserving immediate-visibility. (react.dev: effects must
// reach a fixed point; nextjs.org prefetching: avoid churn on dynamic lists.)
//
// PAGINATION (2026): the board is status-partitioned + offset-paginated. When a
// pagination prop is supplied, DispatchView renders one filter tab per SSOT
// status group (Đang chạy = pending + in-progress; Đã hoàn tất = completed;
// Lệnh Hủy = cancelled -- the T16 three-way carve-out) and a bottom pagination
// control: numbered page links, a
// jump-to-page search input, and a total count. All navigation is URL-state
// (?group=&page=) via plain <a>/full navigation, so pages are shareable and
// RSC-rendered server-side (the offset-pagination advantage). When the prop is
// absent the board renders unpaginated (back-compat with existing callers).
//
// KH column (2026): permanent business rule — the Lệnh điều xe board shows a
// Khách hàng (customer) column in place of the Trạng thái (state) column. The
// dispatcher wants the customer name on the board, not the road-run state. The
// customer name is supplied per row by the API board endpoint (read-time join
// road_run_transport_order -> transport_order -> customer); the optimistic row
// has no customer name yet (it is appended pre-projection) and renders em-dash
// until the real projection row reconciles.
//
// KH phone (2026): permanent business rule — the Khách hàng cell also displays
// the customer's Số điện thoại (phone) beneath the customer name. The phone is
// supplied per row by the API board endpoint on the same customer join; it is
// null for the optimistic (pre-projection) row and for customers with no phone,
// in which case no phone line is rendered (no leak).
//
// Tài xế + Xe display (2026): permanent business rule — the Tài xế and Xe cells
// display the SERVER-resolved driver full name (driverName) and vehicle plate
// (vehiclePlate) the API board endpoint now returns. Previously these cells
// resolved assignedOperatorId/assignedAssetId via a client-side reference
// lookup (buildLookup) built from the dispatch form's driver/vehicle dropdown
// lists. After the hide-busy-driver-vehicle rule (PR #36) filters a now-busy
// driver/vehicle OUT of those dropdown lists, the client lookup missed and the
// cells rendered em-dash. The server-resolved label is authoritative; the
// client lookup remains only as a fallback for the optimistic (pre-projection)
// row, whose driverName/vehiclePlate are still null but whose just-picked
// driver/vehicle are present in the dropdown lookup at create time.
'use client';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { CreateOrderForm, type CreateOrderFormProps } from './CreateOrderForm';
import { LogoutButton } from '../auth/LogoutButton';
import { ExportOrdersExcelButton } from './ExportOrdersExcelButton';
import { buildLookup, formatOrderRef } from './labels';
import type { RoadRunStatusGroup } from '@fleet/sync-protocol';
import type { DispatchBoardRoadRun } from './types';
import { StopSlotHeaders, StopSlotCells, STOP_SLOT_COL_COUNT } from './board-stops';
import { ManualNetWeightEditor } from './ManualNetWeightEditor';
import { useRefetchOnFocus } from '../../lib/use-refetch-on-focus';
const PLANNED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
});
const DASH = '—';
function formatPlannedStart(iso: string | null): string {
  if (iso === null) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : PLANNED_FORMATTER.format(d);
}
function formatCustomer(name: string | null): string {
  return name === null || name === '' ? DASH : name;
}
// Chenh lech (Feature 3): the SERVER-computed pickup-vs-delivery net-weight
// difference (kg), vi-VN grouped (12500 => 12.500 kg); sign preserved
// (negative => pickup exceeded delivery). null => weights incomplete => em-dash,
// so a partial reconciliation never shows a misleading number.
const WEIGHT_DIFF_FORMATTER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
function formatWeightDiff(kg: number | null): string {
  if (kg === null) return DASH;
  // Collapse negative zero (a float-subtraction artifact) to a bare zero so the
  // dispatcher never sees a misleading minus on an effectively-balanced load.
  // signDisplay: 'negative' would do this natively, but the toolchain TS lib
  // predates that literal (spec-late addition), so normalize in code and keep the
  // lib-typed 'auto' semantics: negatives show a minus, positive and zero show none.
  const normalized = Object.is(kg, -0) ? 0 : kg;
  return WEIGHT_DIFF_FORMATTER.format(normalized) + ' kg';
}
// Tài xế / Xe label resolution: prefer the SERVER-resolved label (authoritative,
// independent of the pair-filtered dropdowns). Fall back to the client lookup
// only when the server label is absent (the optimistic pre-projection row),
// then em-dash so an opaque UUID never leaks.
function resolveLabel(serverLabel: string | null, id: string | null, lookup: ReadonlyMap<string, string>): string {
  if (serverLabel !== null && serverLabel !== '') return serverLabel;
  if (id === null) return DASH;
  return lookup.get(id) ?? DASH;
}
function CustomerCell({ name, phone, state, primaryRef }: { name: string | null; phone: string | null; state: string; primaryRef: string }): JSX.Element {
  const hasPhone = phone !== null && phone !== '';
  return (
    <div className='flex flex-col'>
      <span>
        {formatCustomer(name)}
        {state === 'cancelled' ? (
          <span
            data-testid={'dispatch-board-row-cancelled-' + primaryRef}
            className='ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700'
          >Đã hủy</span>
        ) : null}
      </span>
      {hasPhone && <span className='text-xs text-slate-500'>{phone}</span>}
    </div>
  );
}
function OrderRefCell({ refs }: { refs: readonly string[] }): JSX.Element {
  const primary = refs[0];
  if (primary === undefined) {
    return <span className='font-mono'>{formatOrderRef(refs)}</span>;
  }
  const href = '/dispatch/orders/' + primary;
  const testId = 'dispatch-board-row-' + primary;
  return (
    <a href={href} data-testid={testId} className='font-mono text-blue-700 underline-offset-2 hover:underline cursor-pointer'>{formatOrderRef(refs)}</a>
  );
}
// Status group of the board view: the SSOT @fleet/sync-protocol
// RoadRunStatusGroup, imported type-only (erased at build, so the client bundle
// is unchanged) rather than re-declared. The previous local union was a
// structural twin that compiled only because it happened to coincide with the
// contract; a 4th group added to the SSOT would NOT have failed this file.
// load-board-page.ts already consumed the contract type, leaving this the lone
// hold-out. Group membership and the state partition stay authoritative in
// dispatch-board-pagination-contract.ts (statesForStatusGroup).
export interface DispatchBoardPagination {
  readonly group: RoadRunStatusGroup;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasMore: boolean;
}
// Build a shareable board URL preserving status group, target page, AND the
// active search term, so paging/tab-switching never drops the dispatcher search.
function buildBoardHref(group: RoadRunStatusGroup, page: number, search: string): string {
  const qs = new URLSearchParams();
  qs.set('group', group);
  qs.set('page', String(page));
  if (search !== '') qs.set('search', search);
  return '/?' + qs.toString();
}
function FilterTabs({ group, search }: { group: RoadRunStatusGroup; search: string }): JSX.Element {
  const base = 'rounded px-3 py-1 text-sm font-medium';
  const activeCls = base + ' bg-blue-600 text-white';
  const idleCls = base + ' bg-slate-100 text-slate-600 hover:bg-slate-200';
  return (
    <div className='flex items-center gap-2' role='tablist' aria-label='Lọc theo trạng thái'>
      <a data-testid='dispatch-board-filter-active' href={buildBoardHref('active', 1, search)} aria-current={group === 'active' ? 'page' : undefined} className={group === 'active' ? activeCls : idleCls}>Đang chạy</a>
      <a data-testid='dispatch-board-filter-finished' href={buildBoardHref('finished', 1, search)} aria-current={group === 'finished' ? 'page' : undefined} className={group === 'finished' ? activeCls : idleCls}>Đã hoàn tất</a>
      <a data-testid='dispatch-board-filter-cancelled' href={buildBoardHref('cancelled', 1, search)} aria-current={group === 'cancelled' ? 'page' : undefined} className={group === 'cancelled' ? activeCls : idleCls}>Lệnh Hủy</a>
    </div>
  );
}
// Free-text search box: plain input, full-navigation on Enter to ?search= (the
// same plain-anchor escape hatch the tabs/pagination use -> no router.push -> no
// RSC prefetch loop). Submitting resets to page 1 of the current group. Empty
// term navigates without the search param (full board).
function SearchBox({ group, search }: { group: RoadRunStatusGroup; search: string }): JSX.Element {
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    const term = (e.target as HTMLInputElement).value.trim();
    window.location.assign(buildBoardHref(group, 1, term));
  };
  // Native clear (the X on type=search) fires a change event with an empty
  // value and NO Enter keydown, so onKeyDown never runs. Detect the field
  // becoming empty here and return to the unfiltered board -- but only when a
  // search was actually active, so an empty-input event on an already-
  // unfiltered board does not trigger a redundant navigation. Typing a
  // non-empty value does nothing here (submission stays on Enter).
  const onChangeInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = (e.target as HTMLInputElement).value;
    if (value === '' && search !== '') {
      window.location.assign(buildBoardHref(group, 1, ''));
    }
  };
  return (
    <input
      data-testid='dispatch-board-search'
      type='search'
      defaultValue={search}
      onKeyDown={onKey}
      onChange={onChangeInput}
      placeholder='Tìm lệnh điều xe...'
      aria-label='Tìm kiếm lệnh điều xe theo bất kỳ thông tin nào'
      className='w-56 rounded border px-2 py-1 text-sm'
    />
  );
}
function PaginationBar({ pagination, search }: { pagination: DispatchBoardPagination; search: string }): JSX.Element {
  const { group, page, total, totalPages } = pagination;
  // Jump-to-page: full navigation to the typed page (clamped) on Enter, matching
  // the plain-anchor escape hatch (no router.push -> no RSC prefetch loop).
  const onJump = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    const raw = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const target = Math.min(Math.max(Math.trunc(raw), 1), Math.max(totalPages, 1));
    window.location.assign(buildBoardHref(group, target, search));
  };
  const pages: number[] = [];
  for (let p = 1; p <= totalPages; p += 1) pages.push(p);
  return (
    <nav data-testid='dispatch-board-pagination' className='mt-4 flex flex-wrap items-center justify-between gap-3' aria-label='Phân trang'>
      <span data-testid='dispatch-board-total-count' className='text-sm text-slate-500'>{'Tổng: ' + String(total) + ' lệnh'}</span>
      <div className='flex flex-wrap items-center gap-1'>
        {pages.map((p) => (
          <a key={p} data-testid={'dispatch-board-page-link-' + String(p)} href={buildBoardHref(group, p, search)} aria-current={p === page ? 'page' : undefined} className={'rounded px-2 py-1 text-sm ' + (p === page ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{String(p)}</a>
        ))}
      </div>
      <label className='flex items-center gap-1 text-sm text-slate-500'>
        Đến trang
        <input
          data-testid='dispatch-board-page-search'
          type='number'
          min={1}
          max={Math.max(totalPages, 1)}
          defaultValue={String(page)}
          onKeyDown={onJump}
          aria-label='Nhập số trang để chuyển đến'
          className='w-16 rounded border px-2 py-1'
        />
      </label>
    </nav>
  );
}
export interface DispatchViewProps {
  readonly initialRuns: readonly DispatchBoardRoadRun[];
  readonly refs: Omit<CreateOrderFormProps, 'locale'> & { readonly nextOrderRef?: string };
  // Current free-text search term (from ?search=), echoed into the search box
  // and preserved across tab/page navigation. Empty string => no active search.
  readonly searchTerm?: string;
  readonly onMountForTest?: (push: (externalRef: string, op: { operatorId: string; assetId: string }) => void) => void;
  // When present, the board is paginated + status-partitioned (offset pagination
  // over the current page slice in initialRuns). Absent => unpaginated board.
  readonly pagination?: DispatchBoardPagination;
}
function makeOptimisticRow(externalRef: string, opCtx: { operatorId: string; assetId: string }): DispatchBoardRoadRun {
  return {
    roadRunId: 'optimistic-' + externalRef,
    state: 'planned',
    assignedOperatorId: opCtx.operatorId,
    assignedAssetId: opCtx.assetId,
    driverName: null,
    vehiclePlate: null,
    plannedStartAt: null,
    stopCount: 1,
    transportOrderRefs: [externalRef],
    customerName: null,
    customerPhone: null,
    cargoName: null,
    weightDiffKg: null,
    stops: [],
  };
}
function mergeRuns(serverRuns: readonly DispatchBoardRoadRun[], optimistic: readonly DispatchBoardRoadRun[]): readonly DispatchBoardRoadRun[] {
  if (optimistic.length === 0) return serverRuns;
  // Reconcile optimistic list items by a STABLE unique id (roadRunId), never by
  // a mutable business value. Optimistic rows use synthetic 'optimistic-<ref>'
  // ids that never collide with a real UUID, so a stale projection row sharing
  // the same external_ref cannot hide the fresh optimistic row.
  const serverRoadRunIds = new Set<string>();
  for (const r of serverRuns) serverRoadRunIds.add(r.roadRunId);
  const additions = optimistic.filter((r) => !serverRoadRunIds.has(r.roadRunId));
  return additions.length === 0 ? serverRuns : [...additions, ...serverRuns];
}
export function DispatchView(props: DispatchViewProps): JSX.Element {
  const { initialRuns, refs, onMountForTest, pagination, searchTerm } = props;
  const search = searchTerm ?? '';
  const router = useRouter();
  // Single source of optimistic rows: plain useState. Unlike useOptimistic,
  // this does NOT re-derive on every render, so it cannot drive a re-render
  // loop when router.refresh() supplies a fresh initialRuns reference.
  const [stickyRuns, setStickyRuns] = useState<readonly DispatchBoardRoadRun[]>([]);
  // T33: which committed manifest (if any) the dispatcher is entering a manual
  // net weight for. Set by a per-stop Nhap KL button via onEnterNetWeight and
  // cleared when the editor finishes (the action revalidatePath refreshes kg).
  const [editingManifestId, setEditingManifestId] = useState<string | null>(null);
  const pushOptimisticRow = (externalRef: string, op: { operatorId: string; assetId: string }): void => {
    setStickyRuns((prev) => {
      for (const r of prev) {
        if (r.roadRunId === 'optimistic-' + externalRef) return prev;
      }
      return [...prev, makeOptimisticRow(externalRef, op)];
    });
  };
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (onMountForTest) onMountForTest(pushOptimisticRow);
  }, [onMountForTest]);
  useEffect(() => {
    if (stickyRuns.length === 0) return;
    // Prune an optimistic row once the REAL projection row for the same ref
    // arrives from the server. Keyed on external_ref because the server row's
    // roadRunId is a real UUID, distinct from the synthetic 'optimistic-<ref>';
    // the ref is what links the two. The length guard ensures we never re-set
    // identical state, so the effect reaches a fixed point (no loop).
    const serverRefs = new Set<string>();
    for (const r of initialRuns) {
      for (const ref of r.transportOrderRefs) serverRefs.add(ref);
    }
    const next = stickyRuns.filter((r) => {
      for (const ref of r.transportOrderRefs) if (serverRefs.has(ref)) return false;
      return true;
    });
    if (next.length !== stickyRuns.length) setStickyRuns(next);
  }, [initialRuns, stickyRuns]);
  // Refetch-on-focus (2026 professional default), via the shared
  // useRefetchOnFocus hook so every server-state surface behaves identically:
  // when this tab was backgrounded while data changed elsewhere (another
  // dispatcher / device / tab), re-pull the server projection on
  // visibilitychange->visible / window focus. router.refresh() re-fetches the
  // RSC payload and MERGES it, preserving client state (optimistic stickyRuns +
  // form inputs) — unlike location.reload().
  useRefetchOnFocus(() => { router.refresh(); });
  const driverLookup = buildLookup(refs.drivers);
  const vehicleLookup = buildLookup(refs.vehicles ?? []);
  const merged = mergeRuns(initialRuns, stickyRuns);
  const handleCreated = (externalRef: string, op: { operatorId: string; assetId: string }): void => {
    if (op.operatorId !== '' && op.assetId !== '') {
      pushOptimisticRow(externalRef, op);
    }
    router.refresh();
  };
  return (
    <>
      <CreateOrderForm
        drivers={refs.drivers}
        vehicles={refs.vehicles ?? []}
        customers={refs.customers ?? []}
        cargoTypes={refs.cargoTypes ?? []}
        pickupWarehouses={refs.pickupWarehouses ?? []}
        deliveryWarehouses={refs.deliveryWarehouses ?? []}
        driverVehicleAssignments={refs.driverVehicleAssignments ?? []}
        defaultOrderRef={refs.nextOrderRef ?? ''}
        onCreated={handleCreated}
      />
      <div className='mt-8 rounded-2xl bg-white/95 shadow-sm'>
        <section className='p-6'>
          <header className='mb-4 flex items-center justify-between'>
            <h1 className='text-2xl font-semibold'>Lệnh điều xe</h1>
            <div className='flex items-center gap-2'>
              {pagination ? <SearchBox group={pagination.group} search={search} /> : null}
              {pagination ? <FilterTabs group={pagination.group} search={search} /> : null}
              <ExportOrdersExcelButton /><LogoutButton />
            </div>
          </header>
          <table className='w-full border-collapse text-sm'>
            <thead>
              <tr className='border-b text-left'>
                <th className='px-3 py-2'>Số lệnh</th>
                <th className='px-3 py-2'>Khách hàng</th>
                <th className='px-3 py-2'>Tên hàng</th>
                <th className='px-3 py-2'>Tài xế</th>
                <th className='px-3 py-2'>Xe</th>
                <th className='px-3 py-2'>Ngày dự kiến</th>
                <th className='px-3 py-2'>Số điểm</th>
                <th className='px-3 py-2'>Chênh lệch (Số giao - Số nhận)</th>
                <StopSlotHeaders />
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => (
                <tr key={r.roadRunId} data-testid={'dispatch-board-rr-' + r.roadRunId} className='border-b'>
                  <td className='px-3 py-2'><OrderRefCell refs={r.transportOrderRefs} /></td>
                  <td className='px-3 py-2'><CustomerCell name={r.customerName} phone={r.customerPhone} state={r.state} primaryRef={formatOrderRef(r.transportOrderRefs)} /></td>
                  <td className='px-3 py-2' data-testid={'dispatch-board-cargo-' + formatOrderRef(r.transportOrderRefs)}>{formatCustomer(r.cargoName)}</td>
                  <td className='px-3 py-2'>{resolveLabel(r.driverName, r.assignedOperatorId, driverLookup)}</td>
                  <td className='px-3 py-2'>{resolveLabel(r.vehiclePlate, r.assignedAssetId, vehicleLookup)}</td>
                  <td className='px-3 py-2'>{formatPlannedStart(r.plannedStartAt)}</td>
                  <td className='px-3 py-2'>{r.stopCount}</td>
                  <td className='px-3 py-2 tabular-nums' data-testid={'dispatch-board-weightdiff-' + formatOrderRef(r.transportOrderRefs)}>{formatWeightDiff(r.weightDiffKg)}</td>
                  <StopSlotCells primaryRef={formatOrderRef(r.transportOrderRefs)} stops={r.stops} onEnterNetWeight={(manifestId) => { setEditingManifestId(manifestId); }} />
                </tr>
              ))}
              {merged.length === 0 && (
                <tr><td colSpan={8 + STOP_SLOT_COL_COUNT} className='px-3 py-6 text-center text-slate-500'>Chưa có lệnh điều xe nào.</td></tr>
              )}
            </tbody>
          </table>
          {pagination ? <PaginationBar pagination={pagination} search={search} /> : null}
          {editingManifestId !== null ? (
            <div className={'mt-3'} data-testid={'manual-netweight-editor'}>
              <ManualNetWeightEditor manifestId={editingManifestId} onDone={() => { setEditingManifestId(null); router.refresh(); }} />
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
