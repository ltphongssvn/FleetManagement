// apps/ops-web/test/vn-date-field.test.tsx
// outside-in strict TDD RED (t65 Phase 6): the app-owned Vietnamese date field
// that replaces input type=date.
//
// WHY THE NATIVE CONTROL CANNOT BE FIXED IN PLACE. Its visible text and its
// calendar chrome are rendered by the browser from the USER AGENT locale. The
// lang attribute does not change it, CSS cannot reach it, and there is no JS
// hook. That is why the screenshots show mm/dd/yyyy and Su Mo Tu We Th Fr Sa on
// a Vietnamese-only dispatch board no matter what the page declares. Replacing
// the control is the only way to make those surfaces Vietnamese, so this
// component owns its own text rendering.
//
// THE INVARIANT THAT KEEPS THIS CHEAP. What the dispatcher SEES is dd/MM/yyyy;
// what the FORM SUBMITS is unchanged ISO yyyy-mm-dd, carried by a hidden input
// under the same name the native control used. Every server contract
// downstream (ExportDateRangeSchema, the create-order action, the API) keeps
// receiving exactly the bytes it received before, so this is a presentation
// change that stops at the form boundary. The hidden-input assertions below are
// the ones that hold that line.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VnDateField } from '@/features/dispatch/ui/VnDateField';
afterEach(cleanup);
function hidden(name: string): HTMLInputElement {
  const el = document.querySelector('input[type=hidden][name=' + name + ']');
  if (el === null) throw new Error('expected a hidden input named ' + name);
  return el as HTMLInputElement;
}
describe('VnDateField submits ISO while showing Vietnamese', () => {
  it('renders a visible text input, never a native date input', () => {
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    const visible = screen.getByLabelText('Ngày điều xe');
    expect(visible.getAttribute('type')).toBe('text');
  });
  it('shows a Vietnamese placeholder describing the expected shape', () => {
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    const visible = screen.getByLabelText('Ngày điều xe');
    expect(visible.getAttribute('placeholder')).toBe('dd/mm/yyyy');
  });
  it('carries a hidden ISO input under the submitted name', () => {
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    expect(hidden('plannedStartAt').value).toBe('');
  });
  it('converts a typed Vietnamese date into the ISO submitted value', async () => {
    const user = userEvent.setup();
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    await user.type(screen.getByLabelText('Ngày điều xe'), '19/07/2026');
    expect(hidden('plannedStartAt').value).toBe('2026-07-19');
  });
  it('leaves the submitted value empty while the entry is still incomplete', async () => {
    const user = userEvent.setup();
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    await user.type(screen.getByLabelText('Ngày điều xe'), '19/07');
    expect(hidden('plannedStartAt').value).toBe('');
  });
  it('leaves the submitted value empty for an impossible calendar day', async () => {
    const user = userEvent.setup();
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    await user.type(screen.getByLabelText('Ngày điều xe'), '31/02/2026');
    expect(hidden('plannedStartAt').value).toBe('');
  });
  it('shows a Vietnamese validation message for an impossible calendar day', async () => {
    const user = userEvent.setup();
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    await user.type(screen.getByLabelText('Ngày điều xe'), '31/02/2026');
    expect(screen.getByRole('alert').textContent).toBe('Ngày không hợp lệ');
  });
  it('shows no validation message while the entry is merely incomplete', async () => {
    const user = userEvent.setup();
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' />);
    await user.type(screen.getByLabelText('Ngày điều xe'), '19/0');
    expect(screen.queryByRole('alert')).toBe(null);
  });
  it('renders an existing ISO defaultValue as Vietnamese text', () => {
    render(<VnDateField name='from' label='Từ ngày' defaultValue='2026-07-19' />);
    expect((screen.getByLabelText('Từ ngày') as HTMLInputElement).value).toBe('19/07/2026');
    expect(hidden('from').value).toBe('2026-07-19');
  });
  it('reports the ISO value to a caller that wants to react to changes', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<VnDateField name='from' label='Từ ngày' onValueChange={(v) => { seen.push(v); }} />);
    await user.type(screen.getByLabelText('Từ ngày'), '19/07/2026');
    expect(seen[seen.length - 1]).toBe('2026-07-19');
  });
  it('marks the field required when the caller requires it', () => {
    render(<VnDateField name='plannedStartAt' label='Ngày điều xe' required />);
    expect(screen.getByLabelText('Ngày điều xe').hasAttribute('required')).toBe(true);
  });
});
