// apps/ops-web/test/co-so-du-lieu-data-table.test.tsx
// Reusable DataTable shell tests. Slice 1: header/rows render, global search,
// empty state, grouped placeholder headers. Slice 2: client pagination controls
// and opt-in row selection. TanStack Table v8 headless engine + house markup.
// Vietnamese control strings (Tim kiem / Truoc / Sau / Khong co du lieu) are
// immutable UI contracts. Low-level fireEvent.change is kept only for the native
// search input value set; all click interactions use userEvent.setup().
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/features/admin/DataTable';

interface Row {
  readonly name: string;
  readonly plate: string;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Tai xe' },
  { accessorKey: 'plate', header: 'So xe' },
];

const rows: Row[] = [
  { name: 'LE VAN CHAU', plate: '62H 05817' },
  { name: 'MAI HIEN DIEU', plate: '70H 08777' },
  { name: 'NGUYEN VAN GIAU', plate: '62H 05864' },
];

describe('DataTable', () => {
  it('renders column headers and every row', () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(screen.getByText('Tai xe')).toBeInTheDocument();
    expect(screen.getByText('So xe')).toBeInTheDocument();
    expect(screen.getByText('LE VAN CHAU')).toBeInTheDocument();
    expect(screen.getByText('MAI HIEN DIEU')).toBeInTheDocument();
    expect(screen.getByText('NGUYEN VAN GIAU')).toBeInTheDocument();
  });

  it('filters rows with the global search input (includesString)', () => {
    render(<DataTable columns={columns} data={rows} />);
    fireEvent.change(screen.getByTestId('datatable-search'), { target: { value: '70H' } });
    expect(screen.getByText('MAI HIEN DIEU')).toBeInTheDocument();
    expect(screen.queryByText('LE VAN CHAU')).not.toBeInTheDocument();
    expect(screen.queryByText('NGUYEN VAN GIAU')).not.toBeInTheDocument();
  });

  it('shows the empty state when there is no data', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByTestId('datatable-empty')).toHaveTextContent('Không có dữ liệu');
  });

  it('shows the empty state when the search matches nothing', () => {
    render(<DataTable columns={columns} data={rows} />);
    fireEvent.change(screen.getByTestId('datatable-search'), { target: { value: 'zzz-khong-co' } });
    expect(screen.getByTestId('datatable-empty')).toHaveTextContent('Không có dữ liệu');
    expect(screen.queryByText('LE VAN CHAU')).not.toBeInTheDocument();
  });

  it('renders grouped column headers (placeholder header cells)', () => {
    // Asymmetric depth: one ungrouped leaf (name) beside a group (plate).
    // The lone leaf spans both header rows, so TanStack emits a PLACEHOLDER
    // header cell for it in the second row -> exercises the isPlaceholder branch.
    const grouped: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Tai xe' },
      {
        id: 'nhom-xe',
        header: 'Thong tin xe',
        columns: [
          { accessorKey: 'plate', header: 'So xe' },
        ],
      },
    ];
    render(<DataTable columns={grouped} data={rows} />);
    expect(screen.getByText('Thong tin xe')).toBeInTheDocument();
    expect(screen.getByText('Tai xe')).toBeInTheDocument();
    expect(screen.getByText('So xe')).toBeInTheDocument();
    expect(screen.getByText('LE VAN CHAU')).toBeInTheDocument();
  });
});

describe('DataTable pagination', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    name: 'Driver ' + String(i).padStart(2, '0'),
    plate: '62H ' + String(10000 + i),
  }));

  it('shows only one page of rows by default (pageSize 10)', () => {
    render(<DataTable columns={columns} data={many} pageSize={10} />);
    expect(screen.getByText('Driver 00')).toBeInTheDocument();
    expect(screen.getByText('Driver 09')).toBeInTheDocument();
    expect(screen.queryByText('Driver 10')).not.toBeInTheDocument();
  });

  it('advances to the next page on Sau click', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={many} pageSize={10} />);
    await user.click(screen.getByTestId('datatable-next'));
    expect(screen.getByText('Driver 10')).toBeInTheDocument();
    expect(screen.queryByText('Driver 00')).not.toBeInTheDocument();
  });

  it('returns to the previous page on Truoc click', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={many} pageSize={10} />);
    await user.click(screen.getByTestId('datatable-next'));
    expect(screen.getByText('Driver 10')).toBeInTheDocument();
    await user.click(screen.getByTestId('datatable-prev'));
    expect(screen.getByText('Driver 00')).toBeInTheDocument();
    expect(screen.queryByText('Driver 10')).not.toBeInTheDocument();
  });

  it('disables Truoc on the first page', () => {
    render(<DataTable columns={columns} data={many} pageSize={10} />);
    expect(screen.getByTestId('datatable-prev')).toBeDisabled();
  });

  it('renders no pagination when rows fit one page', () => {
    render(<DataTable columns={columns} data={rows} pageSize={10} />);
    expect(screen.queryByTestId('datatable-next')).not.toBeInTheDocument();
  });
});

describe('DataTable row selection', () => {
  it('shows no selection checkboxes unless enabled', () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(screen.queryByTestId('datatable-select-all')).not.toBeInTheDocument();
  });

  it('selects all rows via the header checkbox and reports them', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<DataTable columns={columns} data={rows} enableSelection onSelectionChange={onSelectionChange} />);
    await user.click(screen.getByTestId('datatable-select-all'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(rows);
  });

  it('selects a single row and reports just that row', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<DataTable columns={columns} data={rows} enableSelection onSelectionChange={onSelectionChange} />);
    const [, second] = screen.getAllByTestId('datatable-select-row');
    if (second === undefined) throw new Error('expected a second selection checkbox');
    await user.click(second);
    expect(onSelectionChange).toHaveBeenLastCalledWith([rows[1]]);
  });
});

// R-A11Y (D1): WCAG 2.2 AA table semantics. A caption gives the table an
// accessible name; the first body cell of each row is a row header
// (th scope=row) so screen readers announce the row identity; a polite
// aria-live status region announces the visible-row count after search or
// pagination (WCAG 4.1.3). These assertions are RED until DataTable adds
// the caption prop, the rowheader first column, and the status region.
describe('DataTable accessibility (R-A11Y)', () => {
  it('exposes an accessible name via the caption prop', () => {
    render(<DataTable columns={columns} data={rows} caption={'Danh sach tai xe'} />);
    expect(screen.getByRole('table', { name: 'Danh sach tai xe' })).toBeInTheDocument();
  });

  it('marks the first cell of each row as a row header', () => {
    render(<DataTable columns={columns} data={rows} caption={'Danh sach tai xe'} />);
    const rowHeaders = screen.getAllByRole('rowheader');
    expect(rowHeaders).toHaveLength(rows.length);
    expect(rowHeaders[0]).toHaveTextContent('LE VAN CHAU');
  });

  it('announces the visible row count in a polite status region', () => {
    render(<DataTable columns={columns} data={rows} caption={'Danh sach tai xe'} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(String(rows.length));
  });

  it('updates the status region after a search filter', () => {
    render(<DataTable columns={columns} data={rows} caption={'Danh sach tai xe'} />);
    fireEvent.change(screen.getByTestId('datatable-search'), { target: { value: '70H' } });
    expect(screen.getByRole('status')).toHaveTextContent('1');
  });
});
