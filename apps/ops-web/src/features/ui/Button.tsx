// apps/ops-web/src/features/ui/Button.tsx
// T70 affordance primitive: the ONLY sanctioned way to author a clickable
// action in ops-web.
//
// Root cause it removes: actions were previously authored as bare anchors, text
// spans and one-off Tailwind class strings, so whether a thing looked clickable
// depended on whichever file it lived in. Users reported they cannot tell what
// is clickable and that functions are not prominent. Centralising the element,
// the hit area, the focus ring and the disabled semantics makes those
// properties structural rather than remembered.
//
// Contract decisions worth stating:
//   - It renders a real BUTTON. Pattern affordance (2026): a button must look
//     and behave like a button; breaking that convention forces relearning.
//   - There is no colour prop. Callers pass a NAMED tone (meaning) and emphasis
//     (visual weight), so WCAG 1.4.1 cannot be violated from a call site, and a
//     destructive action can never inherit a save-action appearance.
//   - minHeight/minWidth are INLINE styles derived from MIN_TARGET_SIZE_PX, the
//     @fleet/domain constant carrying WCAG 2.2 SC 2.5.8 (AA). Inline, not a
//     utility class, so the value is asserted against the contract in tests
//     rather than against a class string that a refactor could silently drop.
//   - Tone and emphasis are also emitted as data attributes so unit and e2e
//     specs assert INTENT instead of matching Tailwind output.
'use client';
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { type ActionTone, type ActionEmphasis, MIN_TARGET_SIZE_PX } from '@fleet/domain';

// Tone x emphasis -> a LITERAL class string. Literal because Tailwind v4 scans
// source for complete class names; a computed string would not be emitted. Each
// colour is a semantic role from @fleet/design-tokens (bg-primary,
// text-danger-text, ...), never a raw ramp stop, so the palette stays the SSOT.
const TONE_EMPHASIS_CLASSES: Record<ActionTone, Record<ActionEmphasis, string>> = {
  neutral: {
    solid: 'bg-surface-raised text-white hover:bg-surface',
    soft: 'bg-border-subtle text-text-secondary hover:bg-border',
    ghost: 'text-text-secondary hover:bg-border-subtle',
  },
  primary: {
    solid: 'bg-primary text-white shadow-sm hover:bg-primary-hover',
    soft: 'bg-primary-subtle text-primary-text hover:bg-primary-subtle',
    ghost: 'text-primary-text hover:bg-primary-subtle',
  },
  success: {
    solid: 'bg-success text-white hover:bg-success-strong',
    soft: 'bg-success-subtle text-success-text',
    ghost: 'text-success-text hover:bg-success-subtle',
  },
  warning: {
    solid: 'bg-warning text-warning-text hover:bg-warning-strong',
    soft: 'bg-warning-subtle text-warning-text',
    ghost: 'text-warning-text hover:bg-warning-subtle',
  },
  danger: {
    solid: 'bg-danger text-white shadow-sm hover:bg-danger-hover',
    soft: 'bg-danger-subtle text-danger-text',
    ghost: 'text-danger-text hover:bg-danger-subtle',
  },
};

// Shared chrome. focus-visible (not focus) so a mouse user does not see a ring,
// while a keyboard user always does -- the focus indicator can never be absent.
const BASE_CLASSES = [
  'inline-flex items-center justify-center gap-1.5',
  'rounded-md px-3 py-1.5 text-sm font-medium',
  'transition',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  readonly tone: ActionTone;
  readonly emphasis: ActionEmphasis;
  readonly children?: ReactNode;
}

export function Button({
  tone,
  emphasis,
  children,
  className,
  disabled,
  type,
  style,
  ...rest
}: ButtonProps): JSX.Element {
  const size = String(MIN_TARGET_SIZE_PX) + 'px';
  const isDisabled = disabled === true;
  return (
    <button
      // Default to type=button. An unspecified type inside a form defaults to
      // submit in HTML, which is how a secondary control silently submits a
      // half-filled create form.
      type={type ?? 'button'}
      data-tone={tone}
      data-emphasis={emphasis}
      disabled={isDisabled}
      // aria-disabled mirrors the native state for assistive technology that
      // reads the attribute rather than the property.
      aria-disabled={isDisabled ? 'true' : undefined}
      className={BASE_CLASSES + ' ' + TONE_EMPHASIS_CLASSES[tone][emphasis] + (className === undefined ? '' : ' ' + className)}
      style={{ minHeight: size, minWidth: size, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
