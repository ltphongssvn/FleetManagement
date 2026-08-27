// apps/ops-web/test/admin-reference-page-conflict-consistency.test.tsx
// T5c: error visible after failed create, AND list re-fetched.
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
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  listMock.mockResolvedValue([{ id: 'r1', label: 'TẤM' }]);
  createMock.mockRejectedValue(new Error('Tên hàng TẤM đã tồn tại'));
});
describe('ReferenceAdminPage conflict-display consistency (T5c)', () => {
  it('keeps the đã tồn tại error visible after a failed create', async () => {
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
    await waitFor(() => {
      expect(createMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(cargoSection.textContent).toMatch(/đã tồn tại/i);
    });
  });
  it('refreshes the list after a failed create so the conflicting row is visible', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('TẤM');
    const initialListCalls = listMock.mock.calls.length;
    const cargoSection = screen.getByRole('heading', { name: /^Tên hàng$/ }).closest('section');
    if (cargoSection === null) throw new Error('Tên hàng section not found');
    const input = cargoSection.querySelector('input[type=text]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Tên hàng input not found');
    fireEvent.change(input, { target: { value: 'TẤM' } });
    const addBtn = cargoSection.querySelector('button');
    if (!(addBtn instanceof HTMLButtonElement)) throw new Error('Tên hàng add button not found');
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(createMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(initialListCalls);
    });
    expect(cargoSection.textContent).toMatch(/TẤM/);
  });
});
