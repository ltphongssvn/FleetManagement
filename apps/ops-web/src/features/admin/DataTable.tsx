// apps/ops-web/src/features/admin/DataTable.tsx
// Reusable headless data table for the Cơ sở dữ liệu page. TanStack Table v8
// engine (useReactTable + core/filtered row models, globalFilter using the
// built-in includesString matcher) with house Tailwind + Headless-UI markup --
// NO shadcn vendoring (T8 owns the restyle/design-token arc). Generic over the
// row type via ColumnDef<TRow>, so drivers and every master-data segment share
// ONE table. Slice-1 scope: header render, all-rows render, global search, and
// the empty state. Pagination / row selection / row-action menu are follow-up
// slices layered on this same shell. Vietnamese strings (Tìm kiếm / Không có
// dữ liệu) are immutable UI contracts.
import { useState, type JSX } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';

export interface DataTableProps<TRow> {
  readonly columns: ColumnDef<TRow>[];
  readonly data: readonly TRow[];
  readonly searchPlaceholder?: string;
  readonly emptyLabel?: string;
}

export function DataTable<TRow>({
  columns,
  data,
  searchPlaceholder = 'Tìm kiếm',
  emptyLabel = 'Không có dữ liệu',
}: DataTableProps<TRow>): JSX.Element {
  const [globalFilter, setGlobalFilter] = useState('');
  const table = useReactTable({
    data: data as TRow[],
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

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
    </div>
  );
}
