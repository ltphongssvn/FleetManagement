// apps/ops-web/src/features/dispatch/ui/VnDateField.tsx
// App-owned Vietnamese date field. Replaces input type=date on every dispatcher
// surface. RED spec: apps/ops-web/test/vn-date-field.test.tsx.
//
// WHY THIS COMPONENT EXISTS AT ALL. The native date input renders its visible
// text AND its calendar popup from the USER AGENT locale. That is a deliberate
// part of the platform: the value is always yyyy-mm-dd, but the DISPLAY is the
// browser's business. The lang attribute does not override it, CSS cannot style
// it, and no JS hook is exposed. So on this Vietnamese-only product the export
// range fields showed mm/dd/yyyy with an English Su Mo Tu calendar regardless of
// anything the app declared. The only remedy the platform leaves is to stop
// using the control.
//
// WHAT IS DELIBERATELY UNCHANGED. The submitted value. A hidden input carries
// the same ISO yyyy-mm-dd under the same name the native input used, so
// FormData, the create-order server action, ExportDateRangeSchema and the API
// all keep receiving byte-identical input. This change stops at the form
// boundary, which is what makes it safe to apply to eight call sites.
//
// WHY PARSING LIVES IN THE CONTRACT, NOT HERE. parseVnDateToIso and isoToVnDate
// are in @fleet/sync-protocol next to the wire schema that consumes their
// output, and are unit-tested there against leap years and impossible days.
// This file is only the interaction shell around them.
//
// VALIDATION TIMING. A message appears only once an entry is COMPLETE and still
// impossible (31/02/2026), never while it is merely unfinished (19/0). Warning
// a dispatcher mid-keystroke trains them to ignore the warning.
'use client';
import { useState } from 'react';
import type { JSX } from 'react';
import { parseVnDateToIso, isoToVnDate } from '@fleet/sync-protocol';

// A completed entry is three slash-separated parts whose year is four digits.
// Anything shorter is still being typed, so it must not raise an error.
function looksComplete(text: string): boolean {
  const parts = text.trim().split('/');
  if (parts.length !== 3) return false;
  const year = parts[2];
  if (year === undefined) return false;
  return year.length === 4;
}

export interface VnDateFieldProps {
  readonly name: string;
  readonly label: string;
  // DOM id of the VISIBLE input. Callers that already render their own
  // label htmlFor=... must pass the id that label points at, or the
  // association silently breaks and getByLabelText stops finding the field.
  // Defaults to a derived id when the caller has no existing label markup.
  readonly id?: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
  readonly className?: string;
  // Forwarded to the VISIBLE input. Existing specs and Playwright journeys
  // address these fields by testid, and those ids are a contract that must
  // survive the swap away from the native control -- otherwise migrating a
  // call site would silently break tests that never mention dates.
  readonly testId?: string;
  readonly onValueChange?: (iso: string) => void;
}

export function VnDateField({
  name,
  label,
  id,
  defaultValue,
  required,
  className,
  testId,
  onValueChange,
}: VnDateFieldProps): JSX.Element {
  const initialIso = defaultValue ?? '';
  const [text, setText] = useState(isoToVnDate(initialIso));
  const [iso, setIso] = useState(initialIso);
  const [invalid, setInvalid] = useState(false);
  const inputId = id === undefined ? 'vn-date-' + name : id;
  const errorId = inputId + '-error';
  function onChange(next: string): void {
    setText(next);
    const parsed = parseVnDateToIso(next);
    const nextIso = parsed === null ? '' : parsed;
    setIso(nextIso);
    // Only a COMPLETE but impossible entry is an error; an unfinished one is not.
    setInvalid(parsed === null && next.trim() !== '' && looksComplete(next));
    if (onValueChange) onValueChange(nextIso);
  }
  const base = 'rounded border border-slate-300 px-2 py-1 text-sm';
  return (
    <span className='inline-flex flex-col items-start gap-0.5'>
      <input
        id={inputId}
        type='text'
        inputMode='numeric'
        aria-label={label}
        data-testid={testId}
        placeholder='dd/mm/yyyy'
        value={text}
        required={required === true}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => { onChange(e.target.value); }}
        className={className === undefined ? base : className}
      />
      {/* The hidden input is the actual form participant. The visible field is
          presentation only and is deliberately NOT named, so a half-typed
          Vietnamese string can never reach the server. */}
      <input type='hidden' name={name} value={iso} readOnly />
      {invalid ? (
        <span id={errorId} role='alert' className='text-xs text-red-700'>Ngày không hợp lệ</span>
      ) : null}
    </span>
  );
}
