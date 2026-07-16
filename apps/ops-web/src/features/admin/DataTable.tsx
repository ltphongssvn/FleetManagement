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
import { useEffect, useState, type JSX } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table';

export interface DataTableProps<TRow> {
  readonly columns: ColumnDef<TRow>[];
  readonly data: readonly TRow[];
  readonly searchPlaceholder?: string;
  readonly emptyLabel?: string;
  readonly pageSize?: number;
  readonly enableSelection?: boolean;
  readonly onSelectionChange?: (rows: readonly TRow[]) => void;
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
}: DataTableProps<TRow>): JSX.Element {
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
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
  const showPagination = table.getPageCount() > 1;
  const colCount = table.getAllLeafColumns().length + (enableSelection ? 1 : 0);

  return (
    <div className='space-y-3'>
      <input
        type='text'
        data-testid='datatable-search'
        value={globalFilter}
        onChange={(e) => { setGlobalFilter(e.target.value); }}
        placeholder={searchPlaceholder}
        className='w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'
      />
      <div className='overflow-hidden rounded-lg border border-slate-200'>
        <table className='min-w-full divide-y divide-slate-200 text-sm'>
          <thead className='bg-slate-50'>
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
                    className='px-3 py-2 text-left font-medium text-slate-600'
                  >
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className='divide-y divide-slate-100 bg-white'>
            {rows.map((row) => (
              <tr key={row.id} className='hover:bg-slate-50'>
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
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className='px-3 py-2 text-slate-900'>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div
            data-testid='datatable-empty'
            className='px-3 py-8 text-center text-sm text-slate-500'
          >
            {emptyLabel}
          </div>
        ) : null}
      </div>
      {showPagination ? (
        <div className='flex items-center justify-between gap-2 text-sm text-slate-600'>
          <span data-testid='datatable-page-info'>
            Trang {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <div className='flex gap-2'>
            <button
              type='button'
              data-testid='datatable-prev'
              onClick={() => { table.previousPage(); }}
              disabled={!table.getCanPreviousPage()}
              className='rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40'
            >
              Trước
            </button>
            <button
              type='button'
              data-testid='datatable-next'
              onClick={() => { table.nextPage(); }}
              disabled={!table.getCanNextPage()}
              className='rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40'
            >
              Sau
            </button>
          </div>
        </div>
      ) : null}
      <span data-testid='datatable-colcount' hidden>{colCount}</span>
    </div>
  );
}
