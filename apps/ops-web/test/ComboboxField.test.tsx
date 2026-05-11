// apps/ops-web/test/ComboboxField.test.tsx
// TDD RED: ComboboxField renders hidden input with name, accepts options,
// submits label by default, submits id when submitValue="id".
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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
    const { container } = render(<ComboboxField name="customer" options={opts} placeholder="pick" />);
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
      <ComboboxField name="x" options={opts} placeholder="p" submitValue="id" defaultValue="id-2" />,
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
});
