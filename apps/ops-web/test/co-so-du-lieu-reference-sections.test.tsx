// apps/ops-web/test/co-so-du-lieu-reference-sections.test.tsx
// Tests for the shared reference-sections module extracted from the old
// /admin/reference page so BOTH that page and the new Co so du lieu page render
// the same five master-data CRUD sections without duplication. Pins the
// SECTIONS config (five entities + role/scope), that ReferenceSection is
// exported and mounts, plus the load / delete / update / add branches. The
// five VN titles are immutable UI contracts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SECTIONS, ReferenceSection } from '@/features/admin/reference-sections';
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items: [] }),
  }) as never;
});
describe('reference-sections shared module', () => {
  it('exports the five master-data sections in order', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual([
      'Khách hàng',
      'Tên hàng',
      'Số xe',
      'Kho nhận hàng',
      'Kho giao hàng',
    ]);
  });
  it('maps warehouses to pickup and delivery roles', () => {
    const pickup = SECTIONS.find((s) => s.title === 'Kho nhận hàng');
    const delivery = SECTIONS.find((s) => s.title === 'Kho giao hàng');
    expect(pickup?.segment).toBe('warehouses');
    expect(pickup?.role).toBe('pickup');
    expect(delivery?.segment).toBe('warehouses');
    expect(delivery?.role).toBe('delivery');
  });
  it('uses admin scope for the vehicles section', () => {
    const vehicles = SECTIONS.find((s) => s.title === 'Số xe');
    expect(vehicles?.segment).toBe('vehicles');
    expect(vehicles?.scope).toBe('admin');
  });
  it('renders a section with its add control', () => {
    const customers = SECTIONS[0];
    if (customers === undefined) throw new Error('no sections');
    render(<ReferenceSection def={customers} />);
    expect(screen.getByRole('heading', { name: 'Khách hàng' })).toBeInTheDocument();
  });
  it('shows an error when the initial list load fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as never;
    const customers = SECTIONS[0];
    if (customers === undefined) throw new Error('no sections');
    render(<ReferenceSection def={customers} />);
    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });
  it('shows an error when delete fails', async () => {
    const row = { id: 'r1', label: 'ACME' };
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'x' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [row] }) });
    });
    globalThis.fetch = fetchMock as never;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const customers = SECTIONS[0];
    if (customers === undefined) throw new Error('no sections');
    render(<ReferenceSection def={customers} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    const dialog = await screen.findByRole('dialog');
    const accept = dialog.querySelector('[data-testid=confirm-accept]');
    if (accept === null) throw new Error('no confirm-accept');
    await user.click(accept as HTMLElement);
    await waitFor(() => {
      const err = document.querySelector('.text-red-600');
      expect(err).not.toBeNull();
    });
  });
  it('shows an error when saving a customer phone fails', async () => {
    const row = { id: 'r1', label: 'ACME', meta: { phone: '0900000000' } };
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'y' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [row] }) });
    });
    globalThis.fetch = fetchMock as never;
    const customers = SECTIONS[0];
    if (customers === undefined) throw new Error('no sections');
    render(<ReferenceSection def={customers} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sửa SĐT' }));
    await user.click(await screen.findByRole('button', { name: 'Lưu' }));
    await waitFor(() => {
      const err = document.querySelector('.text-red-600');
      expect(err).not.toBeNull();
    });
  });
  it('adds a non-customer item (phoneArg undefined path)', async () => {
    const cargo = SECTIONS.find((x) => x.segment === 'cargo-types');
    if (cargo === undefined) throw new Error('no cargo section');
    let postCount = 0;
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        postCount += 1;
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 'n1', label: 'RICE' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) });
    });
    globalThis.fetch = fetchMock as never;
    render(<ReferenceSection def={cargo} />);
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText(/thêm tên hàng/i);
    await user.type(input, 'GẠO');
    const addButtons = screen.getAllByRole('button', { name: /thêm tên hàng/i });
    const addBtn = addButtons[0];
    if (addBtn === undefined) throw new Error('no add button');
    await user.click(addBtn);
    await waitFor(() => { expect(postCount).toBe(1); });
  });

  it('surfaces a string rejection via getErrorMessage (string arm)', async () => {
    // fetch rejects with a plain string (mockRejectedValue, not a Promise.reject
    // literal, so prefer-promise-reject-errors does not fire) -> getErrorMessage
    // returns the string itself (covers the typeof-string arm).
    globalThis.fetch = vi.fn().mockRejectedValue('raw-string-failure') as never;
    const customers = SECTIONS[0];
    if (customers === undefined) throw new Error('no sections');
    render(<ReferenceSection def={customers} />);
    expect(await screen.findByText('raw-string-failure')).toBeInTheDocument();
  });

  it('falls back when a non-Error non-string is rejected (fallback arm)', async () => {
    // fetch rejects with a plain object -> getErrorMessage takes neither the
    // Error nor the string arm, returning the fallback (covers the else arm).
    globalThis.fetch = vi.fn().mockRejectedValue({ code: 42 }) as never;
    const customers = SECTIONS[0];
    if (customers === undefined) throw new Error('no sections');
    render(<ReferenceSection def={customers} />);
    expect(await screen.findByText('load failed')).toBeInTheDocument();
  });
});
