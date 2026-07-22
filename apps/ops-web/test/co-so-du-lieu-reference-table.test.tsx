// apps/ops-web/test/co-so-du-lieu-reference-table.test.tsx
// RED-first: each master-data section must render through the shared DataTable
// (same bordered/searchable/paginated table as Tai xe & xe), NOT a <ul> list,
// for visual consistency. Columns: Ten (name) + So dien thoai (customers) +
// Thao tac (Sua SDT / Xoa action cell). Selectors are semantic (getByRole /
// getByText / data-testid) so they survive the list->table markup change.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReferenceSection } from '@/features/admin/reference-sections';
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items: [{ id: 'c1', label: 'ACME', meta: { phone: '0900000000' } }] }),
  }) as never;
});
describe('master-data section renders as a DataTable', () => {
  const customers = { segment: 'customers' as const, title: 'Khách hàng', addLabel: 'Thêm khách hàng' };
  it('renders the shared datatable search input', async () => {
    render(<ReferenceSection def={customers} />);
    expect(await screen.findByTestId('datatable-search')).toBeInTheDocument();
  });
  it('renders column headers Ten and Thao tac', async () => {
    render(<ReferenceSection def={customers} />);
    expect(await screen.findByRole('columnheader', { name: 'Tên' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toBeInTheDocument();
  });
  it('renders each row in a table cell with a Xoa action', async () => {
    render(<ReferenceSection def={customers} />);
    expect(await screen.findByRole('rowheader', { name: 'ACME' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa' })).toBeInTheDocument();
  });
});
