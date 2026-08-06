// apps/ops-web/test/create-order-form-date-only.test.tsx
// outside-in strict TDD (t65 Vietnamese-date-format arc): the three dispatcher
// date fields are DATE-ONLY and render in Vietnamese.
//
// WHAT CHANGED AND WHY. This spec used to assert type=date on each field. That
// pinned the NATIVE control -- and the native control is precisely what could
// not be made Vietnamese: its visible text and its calendar chrome are drawn by
// the browser from the user-agent locale, unreachable by the lang attribute,
// CSS or JS. Asserting type=date therefore froze the defect in place: any fix
// was guaranteed to fail this test. The underlying INTENT (whole days, never a
// time component) is preserved below and is now tested against the replacement.
//
// The submitted value is asserted explicitly because it is the part that must
// NOT change: the create-order action parses z.iso.date(), so a hidden input
// carrying yyyy-mm-dd is what keeps this a presentation-only change.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateOrderForm } from '@/features/dispatch/CreateOrderForm';
afterEach(cleanup);
const drivers = [{ id: 'd1', label: 'NGUYỄN VĂN A' }];
function hiddenValue(name: string): string {
  const el = document.querySelector('input[type=hidden][name=' + name + ']');
  if (el === null) throw new Error('expected a hidden input named ' + name);
  return (el as HTMLInputElement).value;
}
const FIELDS: readonly { readonly label: RegExp; readonly name: string }[] = [
  { label: /Ngày điều xe/i, name: 'plannedStartAt' },
  { label: /Ngày nhận hàng/i, name: 'pickupAt' },
  { label: /Ngày giao hàng/i, name: 'deliveryAt' },
];
describe('CreateOrderForm date-only fields (VN form)', () => {
  it('renders each date field as an app-owned text input, not the native control', () => {
    render(<CreateOrderForm drivers={drivers} locale='vi' />);
    for (const f of FIELDS) {
      expect(screen.getByLabelText(f.label).getAttribute('type')).toBe('text');
    }
  });
  it('shows a Vietnamese day-first placeholder on each field', () => {
    render(<CreateOrderForm drivers={drivers} locale='vi' />);
    for (const f of FIELDS) {
      expect(screen.getByLabelText(f.label).getAttribute('placeholder')).toBe('dd/mm/yyyy');
    }
  });
  it('keeps each field required so the form still cannot submit without a date', () => {
    render(<CreateOrderForm drivers={drivers} locale='vi' />);
    for (const f of FIELDS) {
      expect(screen.getByLabelText(f.label).hasAttribute('required')).toBe(true);
    }
  });
  it('submits ISO yyyy-mm-dd under the original field name when a Vietnamese date is typed', async () => {
    const user = userEvent.setup();
    render(<CreateOrderForm drivers={drivers} locale='vi' />);
    await user.type(screen.getByLabelText(/Ngày điều xe/i), '19/07/2026');
    expect(hiddenValue('plannedStartAt')).toBe('2026-07-19');
  });
  it('stays date-only: the submitted value carries no time component', async () => {
    const user = userEvent.setup();
    render(<CreateOrderForm drivers={drivers} locale='vi' />);
    await user.type(screen.getByLabelText(/Ngày nhận hàng/i), '19/07/2026');
    const submitted = hiddenValue('pickupAt');
    expect(submitted).toBe('2026-07-19');
    expect(submitted).not.toContain('T');
    expect(submitted).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
