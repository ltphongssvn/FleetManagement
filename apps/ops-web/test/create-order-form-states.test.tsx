// apps/ops-web/test/create-order-form-states.test.tsx
// Cover the JSX branches in CreateOrderForm driven by useActionState:
//   - state.status === 'invalid' -> errs populated -> FieldError visible
//   - state.status === 'api_error' / 'server_error' -> topError banner shown
//   - pending === true -> submit button shows "submitting" label
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type * as ReactModule from 'react';

vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn() }));

// Mock useActionState to inject a controlled (state, action, pending) tuple.
// The component imports it from 'react'; replace the export.
const mockUseActionState = vi.fn();
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react');
  return { ...actual, useActionState: mockUseActionState };
});

describe('CreateOrderForm — useActionState-driven branches', () => {
  const drivers = [{ id: '00000000-0000-0000-0000-000000000001', label: 'driver1' }];

  it('renders FieldError messages when state.status=invalid (line 42)', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'invalid', errors: { pickupAt: 'Bad date' } },
      vi.fn(),
      false,
    ]);
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);

    expect(screen.getByText('Bad date')).toBeDefined();
  });

  it('renders top-error banner when state.status=api_error (lines 43, 54)', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'api_error', message: 'API down 503' },
      vi.fn(),
      false,
    ]);
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    expect(screen.getByText('API down 503')).toBeDefined();
  });

  it('renders top-error banner when state.status=server_error', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'server_error', message: 'cookie missing' },
      vi.fn(),
      false,
    ]);
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    expect(screen.getByText('cookie missing')).toBeDefined();
  });

  it('renders submitting label on the submit button when pending=true (line 147)', async () => {
    mockUseActionState.mockReturnValue([undefined, vi.fn(), true]);
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    // English submitting label is something like 'Creating…' per i18n; just check the button is disabled
    const button = screen.getByRole('button', { name: /creating|submitting|tạo|đang/i });
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
