// apps/ops-web/src/features/ui/IconButton.tsx
// T70 affordance primitive: an icon-only action that CANNOT ship nameless.
//
// Root cause it removes: an icon with no accessible name is the purest form of
// the reported complaint -- the control exists, but nothing tells the user what
// it does. Making label a REQUIRED prop means a nameless icon action is a
// compile error rather than something a reviewer has to notice.
//
// Two deliberate differences from Button:
//   - The hit area is 44x44, not the 24x24 AA floor. An icon carries no text to
//     enlarge its target, and WCAG names 44px as the comfortable size (AAA
//     2.5.5); for a dispatcher tapping a dense table this is the practical
//     minimum, so icon actions take the larger value while still satisfying
//     MIN_TARGET_SIZE_PX by construction.
//   - The label is exposed via aria-label AND, for pointer users, title, so the
//     meaning is reachable by hover and by screen reader alike.
'use client';
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { type ActionTone, type ActionEmphasis } from '@fleet/domain';

// Comfortable touch target for a control with no text to grow its hit area.
// Greater than MIN_TARGET_SIZE_PX; the paired test asserts that relationship
// against the contract constant rather than trusting this literal.
export const ICON_BUTTON_SIZE_PX = 44;

const TONE_EMPHASIS_CLASSES: Record<ActionTone, Record<ActionEmphasis, string>> = {
  neutral: {
    solid: 'bg-surface-raised text-white hover:bg-surface',
    soft: 'bg-border-subtle text-text-secondary hover:bg-border',
    ghost: 'text-text-secondary hover:bg-border-subtle',
  },
  primary: {
    solid: 'bg-primary text-white hover:bg-primary-hover',
    soft: 'bg-primary-subtle text-primary-text',
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
    solid: 'bg-danger text-white hover:bg-danger-hover',
    soft: 'bg-danger-subtle text-danger-text',
    ghost: 'text-danger-text hover:bg-danger-subtle',
  },
};

const BASE_CLASSES = [
  'inline-flex items-center justify-center',
  'rounded-md transition',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'color' | 'aria-label'
> {
  readonly tone: ActionTone;
  readonly emphasis: ActionEmphasis;
  // REQUIRED. The accessible name of the action, in Vietnamese. Not optional by
  // design: this is the property whose absence produces the reported defect.
  readonly label: string;
  readonly children?: ReactNode;
}

export function IconButton({
  tone,
  emphasis,
  label,
  children,
  className,
  disabled,
  type,
  style,
  ...rest
}: IconButtonProps): JSX.Element {
  const size = String(ICON_BUTTON_SIZE_PX) + 'px';
  const isDisabled = disabled === true;
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      data-tone={tone}
      data-emphasis={emphasis}
      disabled={isDisabled}
      aria-disabled={isDisabled ? 'true' : undefined}
      className={
        BASE_CLASSES +
        ' ' +
        TONE_EMPHASIS_CLASSES[tone][emphasis] +
        (className === undefined ? '' : ' ' + className)
      }
      style={{ minHeight: size, minWidth: size, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
