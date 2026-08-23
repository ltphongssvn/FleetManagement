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
// load that bypasses Next.js RSC state machine entirely. The pagination +
// status-filter controls below use the SAME plain-anchor navigation for the
// same reason (and because offset pagination maps onto shareable URL state).
//
// RE-RENDER LOOP FIX (2026): the board previously ran a useOptimistic hook IN
// PARALLEL with a stickyRuns useState. After create, router.refresh() produced
// a fresh initialRuns reference each cycle; the useOptimistic value was
// re-derived on every render and, combined with the auto-prefetching <a> rows
// re-mounting, drove an unbounded RSC re-render storm. The optimistic row is
// fully served by stickyRuns (plain useState), which converges.
//
// PAGINATION (2026): the board is status-partitioned + offset-paginated. When a
// pagination prop is supplied, DispatchView renders one filter tab per SSOT
// status group (Dang chay = pending + in-progress; Da hoan tat = completed;
// Lenh Huy = cancelled -- the T16 three-way carve-out) and a bottom pagination
// control. All navigation is URL-state (?group=&page=&search=) via plain
// anchors, so pages are shareable and RSC-rendered server-side.
//
// KH column / KH phone / Tai xe + Xe display (2026): permanent business rules.
// The board shows Khach hang (name + phone) in place of Trang thai, and the Tai
// xe / Xe cells display the SERVER-resolved driverName and vehiclePlate, with
// the client reference lookup surviving only as a fallback for the optimistic
// pre-projection row.
//
// T70 AFFORDANCE OVERHAUL. Dispatchers reported they could not tell what was
// clickable, could not find the primary action, and did not know what the board
// was for. Five source-level changes, each closing a ledger defect in
// context/t70-ux-affordance-overhaul-plan.md:
//   UX-01 a HelpHint for the dispatch_board topic, in the SAME relative
//         position every surface uses (WCAG 3.2.6 Consistent Help).
//   UX-02 the h1 leaves the control cluster, so the title can no longer wrap
//         around the search box, and the toolbar is a named landmark. Exactly
//         ONE solid primary action on the surface: Tao lenh dieu xe.
//   UX-03 a blank Chenh lech cell now NAMES why it is blank instead of showing
//         an em-dash that meant four different things across the table.
//   UX-06 the empty board renders the SSOT EmptyState -- why it is empty AND
//         the next step -- and distinguishes no-data-yet from no-search-match.
//   UX-07/08/09/10/11 filter controls become real tabs with a 24px hit area,
//         search and page-jump gain VISIBLE submit controls instead of an
//         invisible Enter-only contract, and rows advertise navigability.
// Every interactive element is authored through the ui/ primitives, so the hit
// area, focus ring and tone semantics are structural rather than remembered.
'use client';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { type CreateOrderFormProps } from './CreateOrderForm';
import { NaturalLanguageCreateForm } from './NaturalLanguageCreateForm';
import { ExportOrdersExcelButton } from './ExportOrdersExcelButton';
import { buildLookup, formatOrderRef } from './labels';
import type { RoadRunStatusGroup } from '@fleet/sync-protocol';
import { EMPTY_STATE_VI, MIN_TARGET_SIZE_PX } from '@fleet/domain';
import type { DispatchBoardRoadRun } from './types';
import { StopSlotHeaders, StopSlotCells, STOP_SLOT_COL_COUNT } from './board-stops';
import { ManualNetWeightEditor } from './ManualNetWeightEditor';
import { useRefetchOnFocus } from '../../lib/use-refetch-on-focus';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { HelpHint } from '../ui/HelpHint';

const PLANNED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
});
const DASH = '—';
// Minimum hit area as an inline style value, derived from the @fleet/domain
// contract constant rather than a literal, so WCAG 2.5.8 is asserted against
// the spec in tests instead of against a class string a refactor could drop.
const MIN_TARGET = String(MIN_TARGET_SIZE_PX) + 'px';
const SEARCH_HINT_ID = 'dispatch-board-search-hint';

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
// (negative => pickup exceeded delivery). null => weights incomplete => em-dash.
const WEIGHT_DIFF_FORMATTER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
function formatWeightDiff(kg: number | null): string {
  if (kg === null) return DASH;
  // Collapse negative zero (a float-subtraction artifact) to a bare zero so the
  // dispatcher never sees a misleading minus on an effectively-balanced load.
  const normalized = Object.is(kg, -0) ? 0 : kg;
  return WEIGHT_DIFF_FORMATTER.format(normalized) + ' kg';
}
// UX-03: the em-dash used to stand alone in this column on every row, with no
// way to tell an incomplete reconciliation from a broken one. When the value is
// absent the cell now carries the SSOT awaiting_upstream copy: the title as its
// accessible name, the hint as its hover explanation. The glyph is unchanged,
// so nothing that reads the cell text breaks; the MEANING is now attached.
function weightDiffExplanation(kg: number | null): { title?: string; label?: string } {
  if (kg !== null) return {};
  return {
    title: EMPTY_STATE_VI.awaiting_upstream.hint,
    label: EMPTY_STATE_VI.awaiting_upstream.title,
  };
}
// Tai xe / Xe label resolution: prefer the SERVER-resolved label (authoritative,
// independent of the pair-filtered dropdowns). Fall back to the client lookup
// only when the server label is absent (the optimistic pre-projection row),
// then em-dash so an opaque UUID never leaks.
function resolveLabel(
  serverLabel: string | null,
  id: string | null,
  lookup: ReadonlyMap<string, string>,
): string {
  if (serverLabel !== null && serverLabel !== '') return serverLabel;
  if (id === null) return DASH;
  return lookup.get(id) ?? DASH;
}
function CustomerCell({
  name,
  phone,
  state,
  primaryRef,
}: {
  name: string | null;
  phone: string | null;
  state: string;
  primaryRef: string;
}): JSX.Element {
  const hasPhone = phone !== null && phone !== '';
  return (
    <div className="flex flex-col">
      <span>
        {formatCustomer(name)}
        {state === 'cancelled' ? (
          <span
            data-testid={'dispatch-board-row-cancelled-' + primaryRef}
            className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700"
          >
            Đã hủy
          </span>
        ) : null}
      </span>
      {hasPhone && <span className="text-xs text-slate-500">{phone}</span>}
    </div>
  );
}
function OrderRefCell({ refs }: { refs: readonly string[] }): JSX.Element {
  const primary = refs[0];
  if (primary === undefined) {
    return <span className="font-mono">{formatOrderRef(refs)}</span>;
  }
  const href = '/dispatch/orders/' + primary;
  const testId = 'dispatch-board-row-' + primary;
  return (
    <a
      href={href}
      data-testid={testId}
      className="font-mono text-blue-700 underline-offset-2 hover:underline cursor-pointer"
    >
      {formatOrderRef(refs)}
    </a>
  );
}
// Status group of the board view: the SSOT @fleet/sync-protocol
// RoadRunStatusGroup, imported type-only rather than re-declared. Group
// membership and the state partition stay authoritative in
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
// UX-07: these were anchors inside a role=tablist marked with aria-current=page
// -- a tablist containing no tabs, so assistive technology was told one thing
// and shown another. They are now real tabs with aria-selected. aria-current is
// KEPT because dispatch-view-pagination and dispatch-view-search assert it on
// origin/develop; the tab semantics are added alongside, not swapped in.
// UX-11: px-3 py-1 text-sm produced a control under the 24px floor, so the
// minimum is applied inline from the contract constant.
function FilterTabs({ group, search }: { group: RoadRunStatusGroup; search: string }): JSX.Element {
  const base =
    'inline-flex items-center rounded px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring focus-visible:ring-offset-2';
  const activeCls = base + ' bg-primary text-white';
  const idleCls = base + ' bg-border-subtle text-text-secondary hover:bg-border';
  const tab = (id: RoadRunStatusGroup, testId: string, label: string): JSX.Element => {
    const selected = group === id;
    return (
      <a
        data-testid={testId}
        href={buildBoardHref(id, 1, search)}
        role="tab"
        aria-selected={selected ? 'true' : 'false'}
        aria-current={selected ? 'page' : undefined}
        style={{ minHeight: MIN_TARGET, minWidth: MIN_TARGET }}
        className={selected ? activeCls : idleCls}
      >
        {label}
      </a>
    );
  };
  return (
    <div className="flex items-center gap-2" role="tablist" aria-label="Lọc theo trạng thái">
      {tab('active', 'dispatch-board-filter-active', 'Đang chạy')}
      {tab('finished', 'dispatch-board-filter-finished', 'Đã hoàn tất')}
      {tab('cancelled', 'dispatch-board-filter-cancelled', 'Lệnh Hủy')}
    </div>
  );
}
// Free-text search: full navigation to ?search= (the same plain-anchor escape
// hatch the tabs and pagination use, so no router.push and no RSC prefetch
// loop). Submitting resets to page 1 of the current group.
//
// UX-09: submission was Enter-only and undiscoverable -- nothing on screen said
// so. A visible Tim button now performs the same navigation, and a persistent
// hint node tied by aria-describedby states the contract in words (WCAG 3.3.2:
// a placeholder is not a label and vanishes on the first keystroke).
function SearchBox({ group, search }: { group: RoadRunStatusGroup; search: string }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (raw: string): void => {
    window.location.assign(buildBoardHref(group, 1, raw.trim()));
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    submit((e.target as HTMLInputElement).value);
  };
  // Native clear (the X on type=search) fires a change event with an empty
  // value and NO Enter keydown, so onKeyDown never runs. Detect the field
  // becoming empty here and return to the unfiltered board -- but only when a
  // search was actually active, so an empty-input event on an already-
  // unfiltered board does not trigger a redundant navigation.
  const onChangeInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = (e.target as HTMLInputElement).value;
    if (value === '' && search !== '') {
      window.location.assign(buildBoardHref(group, 1, ''));
    }
  };
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          data-testid="dispatch-board-search"
          type="search"
          defaultValue={search}
          onKeyDown={onKey}
          onChange={onChangeInput}
          placeholder="Tìm lệnh điều xe..."
          aria-label="Tìm kiếm lệnh điều xe theo bất kỳ thông tin nào"
          aria-describedby={SEARCH_HINT_ID}
          style={{ minHeight: MIN_TARGET }}
          className="w-56 rounded border border-border px-2 py-1 text-sm"
        />
        <Button
          tone="neutral"
          emphasis="soft"
          data-testid="dispatch-board-search-submit"
          onClick={() => {
            submit(inputRef.current === null ? '' : inputRef.current.value);
          }}
        >
          Tìm
        </Button>
      </div>
      <p id={SEARCH_HINT_ID} className="text-xs text-text-muted">
        Gõ từ khóa rồi bấm Tìm hoặc nhấn Enter.
      </p>
    </div>
  );
}
// UX-08: the jump-to-page input accepted a number but committed only on Enter,
// with no control and no hint. A visible Đi button performs the identical
// clamped navigation.
function PaginationBar({
  pagination,
  search,
}: {
  pagination: DispatchBoardPagination;
  search: string;
}): JSX.Element {
  const { group, page, total, totalPages } = pagination;
  const inputRef = useRef<HTMLInputElement>(null);
  const go = (raw: number): void => {
    if (!Number.isFinite(raw)) return;
    const target = Math.min(Math.max(Math.trunc(raw), 1), Math.max(totalPages, 1));
    window.location.assign(buildBoardHref(group, target, search));
  };
  const onJump = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    go(Number((e.target as HTMLInputElement).value));
  };
  const pages: number[] = [];
  for (let p = 1; p <= totalPages; p += 1) pages.push(p);
  return (
    <nav
      data-testid="dispatch-board-pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
      aria-label="Phân trang"
    >
      <span data-testid="dispatch-board-total-count" className="text-sm text-text-muted">
        {'Tổng: ' + String(total) + ' lệnh'}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {pages.map((p) => (
          <a
            key={p}
            data-testid={'dispatch-board-page-link-' + String(p)}
            href={buildBoardHref(group, p, search)}
            aria-current={p === page ? 'page' : undefined}
            style={{ minHeight: MIN_TARGET, minWidth: MIN_TARGET }}
            className={
              'inline-flex items-center justify-center rounded px-2 py-1 text-sm ' +
              (p === page
                ? 'bg-primary text-white'
                : 'bg-border-subtle text-text-secondary hover:bg-border')
            }
          >
            {String(p)}
          </a>
        ))}
      </div>
      <div className="flex items-center gap-1 text-sm text-text-muted">
        <label className="flex items-center gap-1" htmlFor="dispatch-board-page-search">
          Đến trang
          <input
            ref={inputRef}
            id="dispatch-board-page-search"
            data-testid="dispatch-board-page-search"
            type="number"
            min={1}
            max={Math.max(totalPages, 1)}
            defaultValue={String(page)}
            onKeyDown={onJump}
            aria-label="Nhập số trang để chuyển đến"
            style={{ minHeight: MIN_TARGET }}
            className="w-16 rounded border border-border px-2 py-1"
          />
        </label>
        <Button
          tone="neutral"
          emphasis="soft"
          data-testid="dispatch-board-page-go"
          onClick={() => {
            go(Number(inputRef.current === null ? '' : inputRef.current.value));
          }}
        >
          Đi
        </Button>
      </div>
    </nav>
  );
}
export interface DispatchViewProps {
  readonly initialRuns: readonly DispatchBoardRoadRun[];
  readonly refs: Omit<CreateOrderFormProps, 'locale'> & { readonly nextOrderRef?: string };
  // Current free-text search term (from ?search=), echoed into the search box
  // and preserved across tab/page navigation. Empty string => no active search.
  readonly searchTerm?: string;
  readonly onMountForTest?: (
    push: (externalRef: string, op: { operatorId: string; assetId: string }) => void,
  ) => void;
  // When present, the board is paginated + status-partitioned (offset pagination
  // over the current page slice in initialRuns). Absent => unpaginated board.
  readonly pagination?: DispatchBoardPagination;
}
function makeOptimisticRow(
  externalRef: string,
  opCtx: { operatorId: string; assetId: string },
): DispatchBoardRoadRun {
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
function mergeRuns(
  serverRuns: readonly DispatchBoardRoadRun[],
  optimistic: readonly DispatchBoardRoadRun[],
): readonly DispatchBoardRoadRun[] {
  if (optimistic.length === 0) return serverRuns;
  // Reconcile optimistic list items by a STABLE unique id (roadRunId), never by
  // a mutable business value. Optimistic rows use synthetic optimistic-<ref>
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
  // cleared when the editor finishes.
  const [editingManifestId, setEditingManifestId] = useState<string | null>(null);
  // Table-first (T38): the create form is create-on-demand behind a drawer,
  // so the Lenh dieu xe table is the primary above-the-fold surface.
  const [createOpen, setCreateOpen] = useState(false);
  // So Lenh confirmation state lives on the BOARD, not inside the create form.
  // Creating an order closes the drawer, which unmounted the form and took the
  // success banner with it: the dispatcher lost the order number at the moment
  // it was assigned. The board outlives the drawer (WCAG 4.1.3 / G199).
  const [createdRef, setCreatedRef] = useState<string | null>(null);
  // Page-level readiness signal (2026 e2e contract). Readiness is a property of
  // the PAGE, not of one conditionally-rendered child, so the signal lives here
  // on the board root and holds regardless of drawer state.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const pushOptimisticRow = (
    externalRef: string,
    op: { operatorId: string; assetId: string },
  ): void => {
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
    // arrives from the server. Keyed on external_ref because the server row
    // roadRunId is a real UUID, distinct from the synthetic optimistic id. The
    // length guard ensures we never re-set identical state, so the effect
    // reaches a fixed point (no loop).
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
  // useRefetchOnFocus hook so every server-state surface behaves identically.
  // router.refresh() re-fetches the RSC payload and MERGES it, preserving
  // client state (optimistic stickyRuns + form inputs) -- unlike a reload.
  useRefetchOnFocus(() => {
    router.refresh();
  });
  const driverLookup = buildLookup(refs.drivers);
  const vehicleLookup = buildLookup(refs.vehicles ?? []);
  const merged = mergeRuns(initialRuns, stickyRuns);
  const handleCreated = (
    externalRef: string,
    op: { operatorId: string; assetId: string },
  ): void => {
    if (op.operatorId !== '' && op.assetId !== '') {
      pushOptimisticRow(externalRef, op);
    }
    setCreatedRef(externalRef);
    router.refresh();
  };
  // UX-06: an empty region must say WHY it is empty, because the remedy differs.
  // Nothing created yet means create one; nothing matched means widen the term.
  // Previously both rendered the identical dead-end sentence.
  const emptyReason = search === '' ? 'no_data_yet' : 'no_search_results';
  const createForm = (
    <NaturalLanguageCreateForm
      drivers={refs.drivers}
      vehicles={refs.vehicles ?? []}
      customers={refs.customers ?? []}
      cargoTypes={refs.cargoTypes ?? []}
      pickupWarehouses={refs.pickupWarehouses ?? []}
      deliveryWarehouses={refs.deliveryWarehouses ?? []}
      driverVehicleAssignments={refs.driverVehicleAssignments ?? []}
      defaultOrderRef={refs.nextOrderRef ?? ''}
      onCreated={(externalRef, op) => {
        handleCreated(externalRef, op);
        setCreateOpen(false);
      }}
    />
  );
  return (
    <>
      <div
        data-testid="dispatch-board"
        data-hydrated={hydrated ? 'true' : 'false'}
        className="rounded-2xl bg-white/95 shadow-sm"
      >
        <section className="p-6">
          {/* UX-02: the h1 previously shared a single flex row with the search
              box, the three filter pills, the create button and the export
              range, so at common widths the page title broke across three lines
              around the search input and no control read as primary. The
              heading now stands alone ABOVE a named toolbar landmark; the
              toolbar holds the controls and exactly one solid primary action.
              The heading still precedes the create trigger in the DOM, which is
              the table-first ordering contract from T38. */}
          <header className="mb-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Lệnh điều xe</h1>
              <HelpHint topic="dispatch_board" />
            </div>
            <div
              data-testid="dispatch-board-toolbar"
              role="toolbar"
              aria-label="Thanh công cụ bảng điều phối"
              className="flex flex-wrap items-end justify-between gap-3"
            >
              <div className="flex flex-wrap items-end gap-3">
                {pagination ? <SearchBox group={pagination.group} search={search} /> : null}
                {pagination ? <FilterTabs group={pagination.group} search={search} /> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  tone="primary"
                  emphasis="solid"
                  data-testid="open-create-order"
                  onClick={() => {
                    setCreateOpen(true);
                  }}
                >
                  <span aria-hidden="true">+</span> Tạo lệnh điều xe
                </Button>
                <ExportOrdersExcelButton />
              </div>
            </div>
          </header>
          {/* Persistent live region. The container is rendered from first
              paint and only its CONTENT changes; mounting a role=status node
              on demand is the documented WCAG 4.1.3 failure mode, because an
              assistive technology never starts monitoring a region that did
              not exist when the page loaded. role=status already implies
              aria-live=polite and aria-atomic=true, and focus is deliberately
              NOT moved here: a focus change would stop this being a status
              message.
              T70: this region now carries an explicit test id. It was
              previously the only role=status node on the board, so specs
              reached it by role alone; the empty-state primitive is also a
              status region, which makes a bare role query ambiguous. The
              id names the LOAD-BEARING one (the So Lenh announcement) so
              the contract survives any future status region. */}
          <div
            role="status"
            data-testid="dispatch-board-created-ref"
            className={
              createdRef === null
                ? undefined
                : 'mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'
            }
          >
            {createdRef === null ? null : (
              <>
                <span className="font-semibold">Số Lệnh:</span>{' '}
                <span className="font-mono">{createdRef}</span>
              </>
            )}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-3 py-2">Số lệnh</th>
                <th className="px-3 py-2">Khách hàng</th>
                <th className="px-3 py-2">Tên hàng</th>
                <th className="px-3 py-2">Tài xế</th>
                <th className="px-3 py-2">Xe</th>
                <th className="px-3 py-2">Ngày dự kiến</th>
                <th className="px-3 py-2">Số điểm</th>
                <th className="px-3 py-2">Chênh lệch (Số giao - Số nhận)</th>
                <StopSlotHeaders />
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => {
                const explain = weightDiffExplanation(r.weightDiffKg);
                return (
                  // UX-10: only the So lenh cell was interactive and the row
                  // gave no feedback, so users never discovered that a row led
                  // anywhere. A row-level hover tint is the pattern affordance
                  // for a navigable table row.
                  <tr
                    key={r.roadRunId}
                    data-testid={'dispatch-board-rr-' + r.roadRunId}
                    className="border-b transition-colors hover:bg-border-subtle"
                  >
                    <td className="px-3 py-2">
                      <OrderRefCell refs={r.transportOrderRefs} />
                    </td>
                    <td className="px-3 py-2">
                      <CustomerCell
                        name={r.customerName}
                        phone={r.customerPhone}
                        state={r.state}
                        primaryRef={formatOrderRef(r.transportOrderRefs)}
                      />
                    </td>
                    <td
                      className="px-3 py-2"
                      data-testid={'dispatch-board-cargo-' + formatOrderRef(r.transportOrderRefs)}
                    >
                      {formatCustomer(r.cargoName)}
                    </td>
                    <td className="px-3 py-2">
                      {resolveLabel(r.driverName, r.assignedOperatorId, driverLookup)}
                    </td>
                    <td className="px-3 py-2">
                      {resolveLabel(r.vehiclePlate, r.assignedAssetId, vehicleLookup)}
                    </td>
                    <td className="px-3 py-2">{formatPlannedStart(r.plannedStartAt)}</td>
                    <td className="px-3 py-2">{r.stopCount}</td>
                    <td
                      className="px-3 py-2 tabular-nums"
                      data-testid={
                        'dispatch-board-weightdiff-' + formatOrderRef(r.transportOrderRefs)
                      }
                      title={explain.title}
                      aria-label={explain.label}
                    >
                      {formatWeightDiff(r.weightDiffKg)}
                    </td>
                    <StopSlotCells
                      primaryRef={formatOrderRef(r.transportOrderRefs)}
                      stops={r.stops}
                      onEnterNetWeight={(manifestId) => {
                        setEditingManifestId(manifestId);
                      }}
                    />
                  </tr>
                );
              })}
              {merged.length === 0 && (
                <tr>
                  <td colSpan={8 + STOP_SLOT_COL_COUNT} className="px-3 py-6">
                    <EmptyState
                      reason={emptyReason}
                      data-testid="dispatch-board-empty"
                      action={
                        emptyReason === 'no_data_yet' ? (
                          // Soft, not solid: the toolbar keeps the single solid
                          // primary action on the surface, so prominence still has
                          // one unambiguous answer while the empty state still
                          // offers the next step in place.
                          <Button
                            tone="primary"
                            emphasis="soft"
                            data-testid="dispatch-board-empty-cta"
                            onClick={() => {
                              setCreateOpen(true);
                            }}
                          >
                            Tạo lệnh điều xe
                          </Button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {pagination ? <PaginationBar pagination={pagination} search={search} /> : null}
          {editingManifestId !== null ? (
            <div className={'mt-3'} data-testid={'manual-netweight-editor'}>
              <ManualNetWeightEditor
                manifestId={editingManifestId}
                onDone={() => {
                  setEditingManifestId(null);
                  router.refresh();
                }}
              />
            </div>
          ) : null}
        </section>
      </div>
      {/* Drawer: Headless UI Dialog, not a hand-rolled overlay. The previous
          markup painted a full-viewport button as its backdrop, which
          intercepted every pointer event on the board underneath and made board
          rows unclickable whenever the drawer was open. Native dialog +
          showModal would be the generic 2026 answer, but ComboboxField anchors
          its listbox through a Floating UI portal; a top-layer native dialog
          would paint OVER that portal and hide the options. Headless UI Dialog
          is the vendor-sanctioned pairing: focus trap, Escape and click-outside
          close, scroll lock, correct dialog semantics, portal-compatible, and
          it unmounts when closed so nothing can intercept the board. */}
      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        className="relative z-40"
      >
        <DialogBackdrop className="fixed inset-0 bg-slate-900/40" />
        <div className="fixed inset-0 flex justify-end">
          <DialogPanel className="h-full w-full max-w-2xl overflow-y-auto bg-transparent p-4 shadow-2xl">
            <DialogTitle className="sr-only">Tạo lệnh điều xe</DialogTitle>
            <div className="mb-2 flex justify-end">
              <Button
                tone="neutral"
                emphasis="soft"
                data-testid="close-create-order"
                onClick={() => {
                  setCreateOpen(false);
                }}
              >
                Đóng
              </Button>
            </div>
            {createForm}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
