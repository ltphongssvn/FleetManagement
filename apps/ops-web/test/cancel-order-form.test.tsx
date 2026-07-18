// apps/ops-web/test/cancel-order-form.test.tsx
// L1 RED for T5: CancelOrderForm.
// Asserts the test-id contract the Playwright L0 acceptance spec depends on.
// Modal pattern: an 'open' button reveals the form; the form contains a
// reason select, a note textarea, and a submit button.
//
// Visibility rule (defense in depth — the API is the authority):
//   - state is 'cancelled' or 'completed' -> open button NOT rendered
//   - any other state -> open button rendered
//
// Result-rendering branches (CI coverage gate >= 90% per file): the form
// must show the right error message for every discriminated-union
// status returned by the server action. Tests below drive each branch
// by stubbing the action to return that status, then submitting the
// form and asserting the visible text. React 19's useActionState
// surfaces the action's resolved value as the 'result' state on the
// next render, so awaiting findByText is enough.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CancelOrderForm } from '@/features/dispatch/CancelOrderForm';
import type { CancelOrderState } from '@/features/dispatch/cancel-order.action';
afterEach(() => { cleanup(); });
const cancelOrderMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/dispatch/cancel-order.action', () => ({
  cancelOrder: cancelOrderMock,
}));
// next/navigation must be mocked because the form uses useRouter()
// after T5 added a post-cancel redirect to '/'. Tests in this file do
// not exercise the navigation path itself (see
// cancel-order-form-redirect.test.tsx for that); the mock just
// satisfies the hook contract so the form can render under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
function defaultMock(): void {
  cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'cancelled', transportOrderId: 'x', idempotent: false } satisfies CancelOrderState));
}
function openFormAndSubmit(initialState = 'draft'): void {
  render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state={initialState} />);
  fireEvent.click(screen.getByTestId('order-cancel-open'));
  const select = screen.getByTestId('order-cancel-reason');
  fireEvent.change(select, { target: { value: 'customer_request' } });
  fireEvent.click(screen.getByTestId('order-cancel-submit'));
}
describe('CancelOrderForm', () => {
  it('renders the open button when the order state is draft', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    expect(screen.getByTestId('order-cancel-open')).toBeTruthy();
  });
  it('renders the open button when the order state is assigned', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='assigned' />);
    expect(screen.getByTestId('order-cancel-open')).toBeTruthy();
  });
  it('renders the open button when the order state is in_transit', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='in_transit' />);
    expect(screen.getByTestId('order-cancel-open')).toBeTruthy();
  });
  it('does NOT render the open button when the order state is already cancelled', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='cancelled' />);
    expect(screen.queryByTestId('order-cancel-open')).toBeNull();
  });
  it('does NOT render the open button when the order state is completed', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='completed' />);
    expect(screen.queryByTestId('order-cancel-open')).toBeNull();
  });
  it('reveals the reason select, note textarea, and submit button when the open button is clicked', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    expect(screen.queryByTestId('order-cancel-reason')).toBeNull();
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    expect(screen.getByTestId('order-cancel-reason')).toBeTruthy();
    expect(screen.getByTestId('order-cancel-note')).toBeTruthy();
    expect(screen.getByTestId('order-cancel-submit')).toBeTruthy();
  });
  it('includes the transportOrderId as a hidden input in the form', () => {
    defaultMock();
    const id = '22222222-2222-2222-2222-222222222222';
    render(<CancelOrderForm transportOrderId={id} state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    const hidden = document.querySelector('input[name=transportOrderId]');
    expect(hidden).not.toBeNull();
    expect((hidden as HTMLInputElement).value).toBe(id);
  });
  it('reason select offers all six allow-listed reasons', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    const select = screen.getByTestId('order-cancel-reason');
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value).filter((v) => v !== '');
    expect(values.sort()).toEqual([
      'customer_request',
      'driver_unavailable',
      'duplicate',
      'other',
      'vehicle_breakdown',
      'weather',
    ].sort());
  });
  it('renders the conflict message when the action returns status=conflict', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'conflict', message: 'cannot cancel' } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('Không thể hủy đơn ở trạng thái hiện tại.')).toBeTruthy();
  });
  it('renders the not_found message when the action returns status=not_found', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'not_found', message: 'gone' } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('Không tìm thấy đơn.')).toBeTruthy();
  });
  it('renders the raw message when the action returns status=api_error', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'api_error', message: 'API request failed: 500 Internal Server Error' } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('API request failed: 500 Internal Server Error')).toBeTruthy();
  });
  it('renders the raw message when the action returns status=server_error', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'server_error', message: 'Not authenticated' } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('Not authenticated')).toBeTruthy();
  });
  it('renders the reason field error when invalid result has errors.reason set', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'invalid', errors: { reason: 'Reason is bad' } } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('Reason is bad')).toBeTruthy();
  });
  it('falls through invalid.errors.reason -> errors.note when reason is missing', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'invalid', errors: { note: 'Note too long' } } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('Note too long')).toBeTruthy();
  });
  it('falls through invalid.errors -> errors.transportOrderId when reason and note are missing', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'invalid', errors: { transportOrderId: 'Bad id' } } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('Bad id')).toBeTruthy();
  });
  it('falls through to the generic invalid message when no specific field error is present', async () => {
    cancelOrderMock.mockImplementation(() => Promise.resolve({ status: 'invalid', errors: {} } satisfies CancelOrderState));
    openFormAndSubmit();
    expect(await screen.findByText('Dữ liệu không hợp lệ')).toBeTruthy();
  });
  it('back button hides the form and brings the open button back', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    expect(screen.getByTestId('order-cancel-reason')).toBeTruthy();
    // The Quay lại button has no testid; locate by accessible name.
    fireEvent.click(screen.getByRole('button', { name: /quay lại/i }));
    expect(screen.queryByTestId('order-cancel-reason')).toBeNull();
    expect(screen.getByTestId('order-cancel-open')).toBeTruthy();
  });
  it('requires a note when reason=other: submit disabled and warning shown until a note is typed', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    fireEvent.change(screen.getByTestId('order-cancel-reason'), { target: { value: 'other' } });
    // other selected, no note -> submit disabled + warning visible.
    expect(screen.getByTestId('order-cancel-submit').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('order-cancel-note-required')).toBeTruthy();
    // typing a note clears the block.
    fireEvent.change(screen.getByTestId('order-cancel-note'), { target: { value: 'khách đổi lịch' } });
    expect(screen.getByTestId('order-cancel-submit').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('order-cancel-note-required')).toBeNull();
  });
  it('whitespace-only note does not satisfy the other-requires-note rule', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    fireEvent.change(screen.getByTestId('order-cancel-reason'), { target: { value: 'other' } });
    fireEvent.change(screen.getByTestId('order-cancel-note'), { target: { value: '   ' } });
    expect(screen.getByTestId('order-cancel-submit').hasAttribute('disabled')).toBe(true);
  });
  it('an enumerated reason keeps the note optional (submit enabled with no note)', () => {
    defaultMock();
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    fireEvent.change(screen.getByTestId('order-cancel-reason'), { target: { value: 'weather' } });
    expect(screen.getByTestId('order-cancel-submit').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('order-cancel-note-required')).toBeNull();
  });
});
