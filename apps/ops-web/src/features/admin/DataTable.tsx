// apps/ops-web/src/features/admin/DataTable.tsx
// Reusable headless data table for the Co so du lieu page. TanStack Table v8
// engine with house Tailwind + Headless-UI markup -- NO shadcn vendoring (T8
// owns the restyle/design-token arc). Generic over the row type via
// ColumnDef<TRow>, so drivers and every master-data segment share ONE table.
// Features: header/rows render, global search (includesString), empty state,
// client pagination (opt-in via pageSize; controls only when >1 page), and
// opt-in row selection (enableSelection -> leading checkbox column;
// onSelectionChange reports the selected ORIGINAL rows). Vietnamese strings
// (Tim kiem / Truoc / Sau / Khong co du lieu) are immutable UI contracts.
// Styling: semantic design tokens only (bg-surface-subtle, text-text-primary,
// ring-primary-ring, etc.), resolving from the @fleet/design-tokens SSOT via
// globals.css @theme variables -- never a raw slate-/indigo- palette literal.
//
// R-A11Y (D1): WCAG 2.2 AA table semantics. An optional caption gives the
// table an accessible name (rendered visually hidden). The first body cell of
// each row is a row header (th scope=row) so screen readers announce the row
// identity. A polite aria-live status region announces the visible-row count
// after search or pagination (WCAG 4.1.3 Status Messages).
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table';

// Per-row DOM seam. TanStack v8 is headless and owns no DOM, so row-level
// concerns (marking a row, scrolling it into view) belong to the CALLER:
// the table stays generic and reference/driver semantics never leak in.
export interface DataTableRowAttrs {
  readonly testId?: string;
  readonly className?: string;
  readonly scrollIntoView?: boolean;
}
export interface DataTableProps<TRow> {
  readonly columns: ColumnDef<TRow>[];
  readonly data: readonly TRow[];
  readonly searchPlaceholder?: string;
  readonly emptyLabel?: string;
  readonly pageSize?: number;
  readonly enableSelection?: boolean;
  readonly onSelectionChange?: (rows: readonly TRow[]) => void;
  readonly rowAttrs?: (row: TRow) => DataTableRowAttrs;
  // R-A11Y: accessible table name, rendered as a visually hidden caption.
  readonly caption?: string;
}

const DEFAULT_PAGE_SIZE = 10;

export function DataTable<TRow>({
  columns,
  data,
  searchPlaceholder = 'Tìm kiếm',
  emptyLabel = 'Không có dữ liệu',
  pageSize = DEFAULT_PAGE_SIZE,
  enableSelection = false,
  onSelectionChange,
  rowAttrs,
  caption,
}: DataTableProps<TRow>): JSX.Element {
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const table = useReactTable({
    data: data as TRow[],
    columns,
    state: { globalFilter, rowSelection },
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: enableSelection,
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize } },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  useEffect(() => {
    if (onSelectionChange === undefined) return;
    const selected = table.getSelectedRowModel().rows.map((r) => r.original);
    onSelectionChange(selected);
    // report whenever the selection map changes
  }, [rowSelection, onSelectionChange, table]);

  const rows = table.getRowModel().rows;
  // Which row (if any) asked to be scrolled to. Derived during render so the
  // effect below is keyed on the row IDENTITY: it fires once when the target
  // changes, never on every unrelated re-render (the inline-ref-callback trap:
  // React detaches/reattaches a fresh arrow each render).
  const scrollRowId = rows.find((r) => rowAttrs?.(r.original).scrollIntoView === true)?.id ?? null;
  useEffect(() => {
    if (scrollRowId === null) return;
    const el = containerRef.current?.querySelector('[data-scroll-into-view=true]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [scrollRowId]);
  const showPagination = table.getPageCount() > 1;
  const colCount = table.getAllLeafColumns().length + (enableSelection ? 1 : 0);

  return (
    <div className='space-y-3' ref={containerRef}>
      <input
        type='text'
        data-testid='datatable-search'
        value={globalFilter}
        onChange={(e) => { setGlobalFilter(e.target.value); }}
        placeholder={searchPlaceholder}
        className='w-full max-w-xs rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-primary placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring'
      />
      <div className='overflow-hidden rounded-lg border border-border'>
        <table className='min-w-full divide-y divide-border text-sm'>
          {caption === undefined ? null : (
            <caption className='sr-only'>{caption}</caption>
          )}
          <thead className='bg-surface-subtle'>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {enableSelection ? (
                  <th scope='col' className='w-10 px-3 py-2'>
                    <input
                      type='checkbox'
                      data-testid='datatable-select-all'
                      checked={table.getIsAllRowsSelected()}
                      onChange={table.getToggleAllRowsSelectedHandler()}
                    />
                  </th>
                ) : null}
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    scope='col'
                    className='px-3 py-2 text-left font-medium text-text-secondary'
                  >
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className='divide-y divide-border-subtle bg-white'>
            {rows.map((row) => {
              const attrs = rowAttrs?.(row.original) ?? {};
              return (
              <tr
                key={row.id}
                data-testid={attrs.testId}
                data-scroll-into-view={attrs.scrollIntoView === true ? 'true' : undefined}
                className={attrs.className === undefined ? 'hover:bg-surface-subtle' : 'hover:bg-surface-subtle ' + attrs.className}
              >
                {enableSelection ? (
                  <td className='w-10 px-3 py-2'>
                    <input
                      type='checkbox'
                      data-testid='datatable-select-row'
                      checked={row.getIsSelected()}
                      onChange={row.getToggleSelectedHandler()}
                    />
                  </td>
                ) : null}
                {row.getVisibleCells().map((cell, cellIndex) => (
                  cellIndex === 0 ? (
                    <th
                      key={cell.id}
                      scope='row'
                      className='px-3 py-2 text-left font-normal text-text-primary'
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </th>
                  ) : (
                    <td key={cell.id} className='px-3 py-2 text-text-primary'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div
            data-testid='datatable-empty'
            className='px-3 py-8 text-center text-sm text-text-muted'
          >
            {emptyLabel}
          </div>
        ) : null}
      </div>
      {showPagination ? (
        <div className='flex items-center justify-between gap-2 text-sm text-text-secondary'>
          <span data-testid='datatable-page-info'>
            Trang {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <div className='flex gap-2'>
            <button
              type='button'
              data-testid='datatable-prev'
              onClick={() => { table.previousPage(); }}
              disabled={!table.getCanPreviousPage()}
              className='min-h-11 rounded-md border border-border-strong px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring disabled:opacity-40'
            >
              Trước
            </button>
            <button
              type='button'
              data-testid='datatable-next'
              onClick={() => { table.nextPage(); }}
              disabled={!table.getCanNextPage()}
              className='min-h-11 rounded-md border border-border-strong px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring disabled:opacity-40'
            >
              Sau
            </button>
          </div>
        </div>
      ) : null}
      <span
        role='status'
        aria-live='polite'
        className='sr-only'
        data-testid='datatable-status'
      >
        {rows.length} muc
      </span>
      <span data-testid='datatable-colcount' hidden>{colCount}</span>
    </div>
  );
}
