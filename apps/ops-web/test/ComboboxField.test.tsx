// apps/ops-web/test/ComboboxField.test.tsx
// TDD RED: ComboboxField renders hidden input with name, accepts options,
// submits label by default, submits id when submitValue='id'. Also covers
// the controlled mode (value + onChange props) used by CreateOrderForm's
// bidirectional driver vehicle auto-fill: external value drives the visible
// selection, and the parent owns selection state via onChange. Final test
// exercises uncontrolled-mode selection so setInternalSelected is hit.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { ComboboxField } from '@/features/dispatch/ui/ComboboxField';
function qsInput(root: ParentNode, sel: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(sel);
  if (el === null) throw new Error('querySelector returned null: ' + sel);
  return el;
}
const opts = [
  { id: 'id-1', label: 'Alpha' },
  { id: 'id-2', label: 'Beta' },
] as const;
describe('ComboboxField', () => {
  it('renders a hidden input with the given name', () => {
    const { container } = render(
      <ComboboxField name="customer" options={opts} placeholder="pick" />,
    );
    const hidden = container.querySelector('input[type="hidden"][name="customer"]');
    expect(hidden).toBeTruthy();
  });
  it('renders a visible combobox input with placeholder', () => {
    const { container } = render(<ComboboxField name="x" options={opts} placeholder="— pick —" />);
    const input = qsInput(container, 'input[role="combobox"]');
    expect(input.getAttribute('placeholder')).toBe('— pick —');
  });
  it('hidden input default value is empty when nothing selected', () => {
    const { container } = render(<ComboboxField name="x" options={opts} placeholder="p" />);
    const hidden = qsInput(container, 'input[type="hidden"][name="x"]');
    expect(hidden.value).toBe('');
  });
  it('hidden input value reflects defaultValue by label (default submitValue)', () => {
    const { container } = render(
      <ComboboxField name="x" options={opts} placeholder="p" defaultValue="Alpha" />,
    );
    const hidden = qsInput(container, 'input[type="hidden"][name="x"]');
    expect(hidden.value).toBe('Alpha');
  });
  it('hidden input value reflects defaultValue by id when submitValue="id"', () => {
    const { container } = render(
      <ComboboxField
        name="x"
        options={opts}
        placeholder="p"
        submitValue="id"
        defaultValue="id-2"
      />,
    );
    const hidden = qsInput(container, 'input[type="hidden"][name="x"]');
    expect(hidden.value).toBe('id-2');
  });
  it('typing into the input does not crash and updates value', () => {
    const { container } = render(<ComboboxField name="x" options={opts} placeholder="p" />);
    const input = qsInput(container, 'input[role="combobox"]');
    fireEvent.change(input, { target: { value: 'Al' } });
    expect(input.value).toBe('Al');
  });
  it('handles empty options array without crashing', () => {
    const { container } = render(<ComboboxField name="x" options={[]} placeholder="p" />);
    expect(container.querySelector('input[name="x"]')).toBeTruthy();
  });
  it('renders two instances independently with same options reference', () => {
    const { container } = render(
      <div>
        <ComboboxField name="a" options={opts} placeholder="A" />
        <ComboboxField name="b" options={opts} placeholder="B" submitValue="id" />
      </div>,
    );
    expect(container.querySelector('input[type="hidden"][name="a"]')).toBeTruthy();
    expect(container.querySelector('input[type="hidden"][name="b"]')).toBeTruthy();
  });
  // --- Uncontrolled-mode selection: drives the internal-state path ---
  it('uncontrolled mode: selecting an option updates the hidden input via internal state', async () => {
    // No value/onChange props -> uncontrolled mode -> handleChange invokes
    // setInternalSelected, which is the only branch not exercised by any
    // other test in this file.
    const { container } = render(<ComboboxField name="x" options={opts} placeholder="p" />);
    const input = qsInput(container, 'input[role="combobox"]');
    fireEvent.change(input, { target: { value: 'Alpha' } });
    await screen.findByRole('option', { name: 'Alpha' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(qsInput(container, 'input[type="hidden"][name="x"]').value).toBe('Alpha');
  });
  // --- Controlled mode (value + onChange) ---------------------------------
  it('controlled mode: external non-empty value drives the hidden input (label)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ComboboxField name="x" options={opts} placeholder="p" value="Beta" onChange={onChange} />,
    );
    const hidden = qsInput(container, 'input[type="hidden"][name="x"]');
    expect(hidden.value).toBe('Beta');
  });
  it('controlled mode: external non-empty value drives the hidden input (id, submitValue="id")', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ComboboxField
        name="x"
        options={opts}
        placeholder="p"
        submitValue="id"
        value="id-1"
        onChange={onChange}
      />,
    );
    const hidden = qsInput(container, 'input[type="hidden"][name="x"]');
    expect(hidden.value).toBe('id-1');
  });
  it('controlled mode: empty external value yields empty hidden input', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ComboboxField name="x" options={opts} placeholder="p" value="" onChange={onChange} />,
    );
    const hidden = qsInput(container, 'input[type="hidden"][name="x"]');
    expect(hidden.value).toBe('');
  });
  it('controlled mode: selecting an option calls onChange with the submitted value (label)', async () => {
    function Harness(): React.ReactElement {
      const [v, setV] = useState('');
      return (
        <>
          <ComboboxField name="x" options={opts} placeholder="p" value={v} onChange={setV} />
          <span data-testid="captured">{v}</span>
        </>
      );
    }
    const { container, getByTestId } = render(<Harness />);
    const input = qsInput(container, 'input[role="combobox"]');
    fireEvent.change(input, { target: { value: 'Alpha' } });
    await screen.findByRole('option', { name: 'Alpha' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(getByTestId('captured').textContent).toBe('Alpha');
  });
  it('controlled mode: clearing via rerender from value=Alpha to value= yields empty hidden input', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ComboboxField name="x" options={opts} placeholder="p" value="Alpha" onChange={onChange} />,
    );
    expect(qsInput(container, 'input[type="hidden"][name="x"]').value).toBe('Alpha');
    rerender(
      <ComboboxField name="x" options={opts} placeholder="p" value="" onChange={onChange} />,
    );
    expect(qsInput(container, 'input[type="hidden"][name="x"]').value).toBe('');
  });
});
