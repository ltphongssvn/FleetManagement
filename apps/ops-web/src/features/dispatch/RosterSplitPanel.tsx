// apps/ops-web/src/features/dispatch/RosterSplitPanel.tsx
// The dispatched-vs-idle driver panel at the top of the Bang dieu phoi xe page:
// two tables side by side that the owner reads in ONE glance.
//
// LEFT  - drivers on the road today, with the truck they took.
// RIGHT - drivers staying home with an idle truck. This is the column with
//         teeth. A name here is either a real efficiency question or a
//         dispatcher who sent the job over Zalo, so it never entered the app.
//         The REASON column is what tells the two apart: Chua gan xe means the
//         driver could not be dispatched at all (no truck bound), while Chua
//         dieu xe hom nay means he could have been and was not.
//
// PAGINATION (2026, five rows per table). The first cut rendered every row, on
// the reasoning that a glance layer must answer without a click. Production
// disproved that at real scale: 29 drivers made the idle table so tall that the
// Lenh dieu xe board itself was pushed entirely below the fold, so the panel
// destroyed the very glance it exists to provide. Five rows per table keeps
// BOTH columns and the board on one screen, and the owner still gets the whole
// answer without paging because the number that matters -- the COUNT -- is in
// the heading and always reflects the FULL roster, never the visible page.
// Paging is client-side: the split arrives fully loaded in one payload, so
// there is nothing to refetch, and URL state would force an RSC round-trip
// (refetching the whole board) just to move a glance widget.
//
// WHY NOT DataTable. That component renders a search box unconditionally, which
// is precisely the keystroke a glance layer must not require. This reuses its
// house vocabulary (Trang X, min-h-11 targets, polite status region) without
// its search surface.
//
// PARTITION SAFETY. The panel re-checks isRosterPartitionValid from the SSOT
// contract against the FULL arrays (never the visible page) and surfaces a
// visible warning when the two columns do not add up to the roster. A silently
// missing driver is worse than a wrong number, because the owner cannot see
// what is absent - so the panel refuses to look correct when it is not.
//
// A11Y (WCAG 2.2 AA). Each table carries a visually-hidden caption naming its
// column, and the driver name is a th scope=row so a screen reader announces
// the row identity first. Per 2026 pagination guidance the controls sit in a
// nav with an accessible name that says WHICH table they drive (there are two),
// the active page carries aria-current=page so it is announced rather than
// silently styled, and a polite live region reports the visible range after
// every page change.
//
// Vietnamese strings in this file are IMMUTABLE production UI contracts.
// Styling uses semantic design tokens only - never a raw slate-/indigo- literal.
'use client';

import { useState, type JSX, type ReactNode } from 'react';
import { isRosterPartitionValid } from '@fleet/sync-protocol';
import type { DispatchRosterSplit, IdleReason } from '@fleet/sync-protocol';

const IDLE_REASON_LABEL: Record<IdleReason, string> = {
  no_dispatch_today: 'Chưa điều xe hôm nay',
  no_vehicle_assigned: 'Chưa gắn xe',
};

// Five rows: the largest page that still leaves the board visible above the
// fold on a 13-inch laptop, which is what the dispatcher actually uses.
const PAGE_SIZE = 5;

const HEAD_CLASS = 'px-3 py-2 text-left font-medium text-text-secondary';
const CELL_CLASS = 'px-3 py-2 text-text-primary';
const ROW_HEAD_CLASS = 'px-3 py-2 text-left font-normal text-text-primary';
const EMPTY_CLASS = 'px-3 py-8 text-center text-sm text-text-muted';
const TABLE_WRAP_CLASS = 'overflow-hidden rounded-lg border border-border';
const TABLE_CLASS = 'min-w-full divide-y divide-border text-sm';
const BODY_CLASS = 'divide-y divide-border-subtle bg-white';
const PAGE_BTN_CLASS =
  'min-h-11 min-w-11 rounded-md border border-border-strong px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring';
const PAGE_BTN_ACTIVE_CLASS = PAGE_BTN_CLASS + ' bg-surface-subtle font-semibold';

interface PagedTableProps<TRow> {
  readonly testId: string;
  readonly heading: string;
  readonly caption: string;
  readonly paginationLabel: string;
  readonly columns: readonly string[];
  readonly rows: readonly TRow[];
  readonly emptyLabel: string;
  readonly renderRow: (row: TRow) => ReactNode;
}

// One table + its pager. Both columns render through this so the markup, the
// a11y wiring and the paging arithmetic exist exactly once; a second copy is
// how the two halves of a split view drift apart.
function PagedRosterTable<TRow>({
  testId,
  heading,
  caption,
  paginationLabel,
  columns,
  rows,
  emptyLabel,
  renderRow,
}: PagedTableProps<TRow>): JSX.Element {
  // Page state is PER TABLE. One shared index would move the dispatched table
  // when the owner pages the idle one -- two independent questions must not
  // answer to one control.
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // Clamp rather than trust: the split refetches on focus, so a roster that
  // shrinks under the current page must not render an empty table.
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  const rangeStart = rows.length === 0 ? 0 : start + 1;
  const rangeEnd = start + visible.length;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white drop-shadow-sm">
        {heading} <span data-testid={testId + '-count'}>{rows.length}</span>
      </h3>
      <div className={TABLE_WRAP_CLASS}>
        <table className={TABLE_CLASS} data-testid={testId}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-subtle">
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className={HEAD_CLASS}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={BODY_CLASS}>{visible.map((row) => renderRow(row))}</tbody>
        </table>
        {rows.length === 0 ? (
          <div className={EMPTY_CLASS} data-testid={testId + '-empty'}>
            {emptyLabel}
          </div>
        ) : null}
      </div>
      {pageCount > 1 ? (
        <nav
          aria-label={paginationLabel}
          data-testid={testId + '-pagination'}
          className="mt-2 flex flex-wrap gap-2"
        >
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={'Trang ' + String(i + 1)}
              aria-current={i === safePage ? 'page' : undefined}
              onClick={() => {
                setPage(i);
              }}
              className={i === safePage ? PAGE_BTN_ACTIVE_CLASS : PAGE_BTN_CLASS}
            >
              {i + 1}
            </button>
          ))}
        </nav>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only" data-testid={testId + '-status'}>
        {'Hiển thị ' +
          String(rangeStart) +
          '-' +
          String(rangeEnd) +
          ' trên ' +
          String(rows.length) +
          ' tài xế'}
      </span>
    </div>
  );
}

export interface RosterSplitPanelProps {
  readonly split: DispatchRosterSplit;
}

export function RosterSplitPanel({ split }: RosterSplitPanelProps): JSX.Element {
  // Validated against the FULL arrays: paging is a view concern and must never
  // change the answer to "does this add up".
  const partitionOk = isRosterPartitionValid(split);
  return (
    <section className="mb-6 space-y-3" data-testid="roster-split-panel">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-white drop-shadow-sm">
          Tình hình tài xế hôm nay
        </h2>
        <p className="text-sm text-text-on-dark-muted">
          Tổng số tài xế:{' '}
          <span data-testid="roster-split-total" className="font-semibold">
            {split.totalDrivers}
          </span>
        </p>
      </div>

      {partitionOk ? null : (
        <p
          role="alert"
          data-testid="roster-split-partition-warning"
          className="rounded-md border border-border-strong px-3 py-2 text-sm text-text-primary"
        >
          Danh sách chưa khớp với tổng số tài xế. Vui lòng tải lại trang.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <PagedRosterTable
          testId="roster-split-dispatched"
          heading="Tài xế đang chạy hôm nay"
          caption="Danh sách tài xế đang chạy hôm nay"
          paginationLabel="Phân trang tài xế đang chạy hôm nay"
          columns={['Tài xế', 'Số xe', 'Mã đơn']}
          rows={split.dispatched}
          emptyLabel="Chưa có tài xế nào chạy hôm nay."
          renderRow={(row) => (
            <tr key={row.driverId} data-testid={'roster-split-dispatched-row-' + row.driverId}>
              <th scope="row" className={ROW_HEAD_CLASS}>
                {row.driverName}
              </th>
              <td className={CELL_CLASS}>{row.vehiclePlate ?? '-'}</td>
              <td className={CELL_CLASS}>
                {row.orderRefs.length === 0 ? '-' : row.orderRefs.join(', ')}
              </td>
            </tr>
          )}
        />

        <PagedRosterTable
          testId="roster-split-idle"
          heading="Tài xế ở nhà hôm nay"
          caption="Danh sách tài xế ở nhà hôm nay"
          paginationLabel="Phân trang tài xế ở nhà hôm nay"
          columns={['Tài xế', 'Số xe', 'Lý do']}
          rows={split.idle}
          emptyLabel="Tất cả tài xế đều đang chạy."
          renderRow={(row) => (
            <tr key={row.driverId} data-testid={'roster-split-idle-row-' + row.driverId}>
              <th scope="row" className={ROW_HEAD_CLASS}>
                {row.driverName}
              </th>
              <td className={CELL_CLASS}>{row.vehiclePlate ?? '-'}</td>
              <td className={CELL_CLASS}>{IDLE_REASON_LABEL[row.reason]}</td>
            </tr>
          )}
        />
      </div>
    </section>
  );
}
