// apps/ops-web/src/features/ui/FieldLabel.tsx
// T70 affordance primitive: a PERSISTENT, visible label for a form control.
//
// Root cause it removes: every combobox in the create drawer was
// placeholder-only (Chon so xe, Chon tai xe, ...). WCAG 3.3.2 Labels or
// Instructions is explicit that placeholder text alone is not a label, because
// it disappears on the first keystroke -- so a dispatcher who pauses mid-form
// is left with eight filled boxes and no way to tell what any of them mean.
// That is the sentence-shaped create form users describe as unusable.
//
// Three properties this makes structural rather than remembered:
//   - The label persists after typing, and is bound to the control by htmlFor,
//     so clicking the label focuses the field and a screen reader reads it.
//   - required is stated in WORDS. An asterisk alone is unexplained, and colour
//     alone would fail WCAG 1.4.1; the visible text says bat buoc.
//   - hint renders with a derived id of <controlId>-hint, so the caller wires
//     aria-describedby to a node that provably exists.
import type { JSX, ReactNode } from 'react';

// Vietnamese required marker, in words. Exported so specs and other surfaces
// assert against the SSOT string rather than re-typing it.
export const REQUIRED_MARKER_VI = 'bắt buộc';

export interface FieldLabelProps {
  // The id of the control this labels. Also the stem of the hint node id.
  readonly htmlFor: string;
  readonly required?: boolean;
  readonly hint?: string;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function FieldLabel({
  htmlFor,
  required,
  hint,
  children,
  className,
}: FieldLabelProps): JSX.Element {
  return (
    <>
      <label
        htmlFor={htmlFor}
        className={
          'block text-sm font-medium text-text-secondary' +
          (className === undefined ? '' : ' ' + className)
        }
      >
        {children}
        {required === true ? (
          <span className="ml-1 text-xs font-normal text-text-muted">{REQUIRED_MARKER_VI}</span>
        ) : null}
      </label>
      {hint === undefined ? null : (
        <p id={htmlFor + '-hint'} className="mt-0.5 text-xs text-text-muted">
          {hint}
        </p>
      )}
    </>
  );
}
