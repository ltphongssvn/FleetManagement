// apps/ops-web/test/co-so-du-lieu-data-table.test.tsx
// RED-first for the reusable DataTable shell the Cơ sở dữ liệu page renders
// every section with (drivers + 5 master-data segments). TanStack Table v8
// headless engine (useReactTable + core/filtered row models) with house
// Tailwind/Headless-UI presentation -- no shadcn vendoring (T8 owns restyle).
// Slice 1 scope only: render headers + all rows from ColumnDef/data, global
// search via the built-in includesString filter, and the empty state (both
// for no data and for a search with no hits). Pagination, row selection, and
// row actions are follow-up slices. Vietnamese strings introduced here
// (Tìm kiếm / Không có dữ liệu) become immutable UI contracts once shipped.
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/features/admin/DataTable';

interface Row {
  readonly name: string;
  readonly plate: string;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Tài xế' },
  { accessorKey: 'plate', header: 'Số xe' },
];

const rows: Row[] = [
  { name: 'LÊ VĂN CHÂU', plate: '62H 05817' },
  { name: 'MAI HIỀN DIỆU', plate: '70H 08777' },
  { name: 'NGUYỄN VĂN GIÀU', plate: '62H 05864' },
];

describe('DataTable', () => {
  it('renders column headers and every row', () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(screen.getByText('Tài xế')).toBeInTheDocument();
    expect(screen.getByText('Số xe')).toBeInTheDocument();
    expect(screen.getByText('LÊ VĂN CHÂU')).toBeInTheDocument();
    expect(screen.getByText('MAI HIỀN DIỆU')).toBeInTheDocument();
    expect(screen.getByText('NGUYỄN VĂN GIÀU')).toBeInTheDocument();
  });

  it('filters rows with the global search input (includesString)', () => {
    render(<DataTable columns={columns} data={rows} />);
    fireEvent.change(screen.getByTestId('datatable-search'), { target: { value: '70H' } });
    expect(screen.getByText('MAI HIỀN DIỆU')).toBeInTheDocument();
    expect(screen.queryByText('LÊ VĂN CHÂU')).not.toBeInTheDocument();
    expect(screen.queryByText('NGUYỄN VĂN GIÀU')).not.toBeInTheDocument();
  });

  it('shows the empty state when there is no data', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByTestId('datatable-empty')).toHaveTextContent('Không có dữ liệu');
  });

  it('shows the empty state when the search matches nothing', () => {
    render(<DataTable columns={columns} data={rows} />);
    fireEvent.change(screen.getByTestId('datatable-search'), { target: { value: 'zzz-khong-co' } });
    expect(screen.getByTestId('datatable-empty')).toHaveTextContent('Không có dữ liệu');
    expect(screen.queryByText('LÊ VĂN CHÂU')).not.toBeInTheDocument();
  });
});
