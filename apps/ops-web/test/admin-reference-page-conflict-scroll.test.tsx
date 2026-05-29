// apps/ops-web/test/admin-reference-page-conflict-scroll.test.tsx
// T5c L2: after a 409 conflict, the conflicting row MUST be marked with
// data-testid='reference-row-conflict' AND scrolled into view via
// Element.scrollIntoView so it is visible in a long list.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
  listMock.mockResolvedValue([
    { id: 'r0', label: 'CÁM' },
    { id: 'r1', label: 'TẤM' },
    { id: 'r2', label: 'GẠO' },
  ]);
  createMock.mockRejectedValue(new Error('Tên hàng TẤM đã tồn tại'));
});
describe('ReferenceAdminPage conflict scroll + highlight (T5c)', () => {
  it('marks the conflicting row with data-testid=reference-row-conflict', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('TẤM');
    const cargoSection = screen.getByRole('heading', { name: /^Tên hàng$/ }).closest('section');
    if (cargoSection === null) throw new Error('Tên hàng section not found');
    const input = cargoSection.querySelector('input[type=text]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Tên hàng input not found');
    fireEvent.change(input, { target: { value: 'TẤM' } });
    const addBtn = cargoSection.querySelector('button');
    if (!(addBtn instanceof HTMLButtonElement)) throw new Error('Tên hàng add button not found');
    fireEvent.click(addBtn);
    await waitFor(() => { expect(createMock).toHaveBeenCalled(); });
    await waitFor(() => {
      const marked = cargoSection.querySelector('[data-testid=reference-row-conflict]');
      expect(marked).not.toBeNull();
      expect(marked?.textContent).toMatch(/TẤM/);
    });
  });
  it('calls scrollIntoView on the conflicting row so it becomes visible in a long list', async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });
    render(<ReferenceAdminPage />);
    await screen.findAllByText('TẤM');
    const cargoSection = screen.getByRole('heading', { name: /^Tên hàng$/ }).closest('section');
    if (cargoSection === null) throw new Error('Tên hàng section not found');
    const input = cargoSection.querySelector('input[type=text]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Tên hàng input not found');
    fireEvent.change(input, { target: { value: 'TẤM' } });
    const addBtn = cargoSection.querySelector('button');
    if (!(addBtn instanceof HTMLButtonElement)) throw new Error('Tên hàng add button not found');
    fireEvent.click(addBtn);
    await waitFor(() => { expect(createMock).toHaveBeenCalled(); });
    await waitFor(() => { expect(scrollSpy).toHaveBeenCalled(); });
  });
});
