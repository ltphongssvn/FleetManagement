// apps/ops-web/src/features/dispatch/ui/ComboboxField.tsx
// Headless UI Combobox: portal-rendered, searchable dropdown.
// Renders options outside the form's stacking context, immune to overflow/backdrop clipping.
'use client';
import { useState } from 'react';
import type { JSX } from 'react';
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react';

export interface ComboOption { readonly id: string; readonly label: string }

export function ComboboxField({ id, name, options, placeholder, required, defaultValue, submitValue = 'label', className }: {
  id?: string;
  name: string;
  options: readonly ComboOption[];
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
  submitValue?: 'id' | 'label';
  className?: string;
}): JSX.Element {
  const initial = defaultValue
    ? options.find((o) => (submitValue === 'id' ? o.id : o.label) === defaultValue) ?? null
    : null;
  const [selected, setSelected] = useState<ComboOption | null>(initial);
  const [query, setQuery] = useState('');
  const filtered = query === ''
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const value = selected ? (submitValue === 'id' ? selected.id : selected.label) : '';
  return (
    <Combobox value={selected} onChange={setSelected} immediate>
      <div className="relative mt-1">
        <input type="hidden" name={name} value={value} data-required={required ?? false} />
        <ComboboxInput
          id={id}
          displayValue={(o: ComboOption | null) => o?.label ?? ''}
          onChange={(e) => { setQuery(e.target.value); }}
          placeholder={placeholder}
          className={className ?? 'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20'}
          autoComplete="off"
        />
        <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-slate-400" aria-hidden="true">
            <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .55.24l3.25 3.5a.75.75 0 1 1-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 0 1-1.1-1.02l3.25-3.5A.75.75 0 0 1 10 3Zm-3.76 9.2a.75.75 0 0 1 1.06.04L10 15.148l2.7-2.908a.75.75 0 1 1 1.1 1.02l-3.25 3.5a.75.75 0 0 1-1.1 0l-3.25-3.5a.75.75 0 0 1 .04-1.06Z" clipRule="evenodd" />
          </svg>
        </ComboboxButton>
        <ComboboxOptions
          anchor="bottom start"
          className="z-50 mt-1 max-h-60 w-(--input-width) overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none [--anchor-gap:4px]"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-slate-500">Không có dữ liệu</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-slate-500">Không tìm thấy "{query}"</div>
          ) : filtered.map((o) => (
            <ComboboxOption
              key={o.id}
              value={o}
              className="cursor-pointer select-none px-3 py-2 text-slate-900 data-[focus]:bg-indigo-600 data-[focus]:text-white"
            >
              {o.label}
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}
