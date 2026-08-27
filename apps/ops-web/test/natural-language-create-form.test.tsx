// apps/ops-web/test/natural-language-create-form.test.tsx
// P3 RED (T38): NaturalLanguageCreateForm renders the create contract as a
// Vietnamese Mad-Libs sentence. Contract-first: it MUST emit the exact same
// FormData field names the unchanged create-order.action + DateOnlyFormSchema
// consume (plannedStartAt, customer, cargo, assignedOperatorId, assignedAssetId,
// pickupAt, deliveryAt, pickupWarehouse_N, deliveryWarehouse_N). This asserts
// contract invariants + sentence chrome, not presentational slot counts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn() }));
afterEach(() => {
  cleanup();
});
describe('NaturalLanguageCreateForm (Mad-Libs sentence create form)', () => {
  const drivers = [{ id: '00000000-0000-0000-0000-000000000001', label: 'driver1' }];
  const has = (sel: string): boolean => document.querySelector(sel) !== null;
  it('renders inside a single form wired to the create action', async () => {
    const { NaturalLanguageCreateForm } =
      await import('@/features/dispatch/NaturalLanguageCreateForm');
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    expect(has('form[data-testid=nl-create-order-form]')).toBe(true);
  });
  it('emits every FormData field name the unchanged action consumes', async () => {
    const { NaturalLanguageCreateForm } =
      await import('@/features/dispatch/NaturalLanguageCreateForm');
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    for (const n of [
      'plannedStartAt',
      'customer',
      'cargo',
      'assignedOperatorId',
      'assignedAssetId',
      'pickupAt',
      'deliveryAt',
    ]) {
      expect(has('input[name=' + n + ']')).toBe(true);
    }
    expect(
      document.querySelectorAll('input[name^=pickupWarehouse_]').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      document.querySelectorAll('input[name^=deliveryWarehouse_]').length,
    ).toBeGreaterThanOrEqual(1);
  });
  it('renders Vietnamese sentence chrome (narrative, not stacked labels)', async () => {
    const { NaturalLanguageCreateForm } =
      await import('@/features/dispatch/NaturalLanguageCreateForm');
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    expect(screen.getByTestId('nl-create-order-form').textContent).toMatch(/h.y l.m l.nh/i);
  });
  it('progressively adds a pickup warehouse slot via the them-kho control', async () => {
    const { NaturalLanguageCreateForm } =
      await import('@/features/dispatch/NaturalLanguageCreateForm');
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    const before = document.querySelectorAll('input[name^=pickupWarehouse_]').length;
    fireEvent.click(screen.getByRole('button', { name: /th.m kho nh.n h.ng/i }));
    const after = document.querySelectorAll('input[name^=pickupWarehouse_]').length;
    expect(after).toBe(before + 1);
  });
});
