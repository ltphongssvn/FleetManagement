// apps/ops-web/test/admin-reference-page-customer-phone.test.tsx
// L1: ReferenceAdminPage Khách hàng section supports Số điện thoại CRUD.
// The add form has a phone input; each customer row shows its phone and a
// 'Sửa SĐT' control that reveals an inline 'Số điện thoại' field + 'Lưu' which
// calls client.update(id, name, phone). ReferenceAdminClient is mocked.
// RED first: no phone input, no phone render, no Sửa SĐT control yet.
// MARKUP CONTRACT MIGRATED (Co so du lieu arc): sections render through the
// shared DataTable, so a row is a <tr> of <td> cells, not a <ul><li>. The
// BEHAVIOUR asserted here is unchanged -- only the row locator moves from
// closest(li) to closest(tr) / getByRole(cell). Semantic role queries are
// preferred over tag queries so the next markup change costs nothing.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
vi.mock('@/features/admin/reference-admin-client', () => ({
  ReferenceAdminClient: class {
    list = listMock;
    create = createMock;
    update = updateMock;
    remove = removeMock;
  },
}));
import ReferenceAdminPage from '@/app/admin/reference/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  // Customer rows carry meta.phone; other sections carry plain rows.
  listMock.mockResolvedValue([
    { id: 'c1', label: 'Acme', meta: { phone: '0901234567' } },
  ]);
  createMock.mockResolvedValue({ id: 'c2', label: 'NewCo' });
  updateMock.mockResolvedValue(undefined);
});
function customerSection(): HTMLElement {
  const heading = screen.getAllByRole('heading', { name: 'Khách hàng' })[0];
  if (heading === undefined) throw new Error('no Khách hàng heading');
  const section = heading.closest('section');
  if (section === null) throw new Error('no section ancestor');
  return section;
}
describe('ReferenceAdminPage Khách hàng Số điện thoại (L1)', () => {
  it('renders a Số điện thoại input in the Khách hàng add form', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('Acme');
    const sec = customerSection();
    expect(within(sec).getByPlaceholderText('Số điện thoại')).toBeTruthy();
  });
  it('shows the customer phone next to the row', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('Acme');
    const sec = customerSection();
    expect(within(sec).getByText('0901234567')).toBeTruthy();
  });
  it('row label contract: the name cell is the name only, not name+phone (specs read it)', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('Acme');
    const sec = customerSection();
    const nameCell = within(sec).getByRole('cell', { name: 'Acme' });
    expect(nameCell.textContent).toBe('Acme');
    const row = nameCell.closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('0901234567')).toBeTruthy();
  });
  it('create() is called with name + phone from the add form', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('Acme');
    const sec = customerSection();
    fireEvent.change(within(sec).getByPlaceholderText('Thêm khách hàng'), { target: { value: 'NewCo' } });
    fireEvent.change(within(sec).getByPlaceholderText('Số điện thoại'), { target: { value: '0905555555' } });
    const addBtn = within(sec).getAllByRole('button', { name: 'Thêm khách hàng' })[0];
    if (addBtn === undefined) throw new Error('no add button');
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith('NewCo', undefined, '0905555555');
    });
  });
  it('Sửa SĐT reveals an edit field and Lưu calls update(id, name, phone)', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('Acme');
    const sec = customerSection();
    const editBtn = within(sec).getByRole('button', { name: 'Sửa SĐT' });
    const row = editBtn.closest('tr');
    if (row === null) throw new Error('no row ancestor');
    fireEvent.click(editBtn);
    const editField = within(row).getByLabelText('Số điện thoại');
    fireEvent.change(editField, { target: { value: '0906666666' } });
    fireEvent.click(within(sec).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith('c1', 'Acme', '0906666666');
    });
  });
});
