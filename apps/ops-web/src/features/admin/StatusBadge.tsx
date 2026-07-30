// apps/ops-web/src/features/admin/StatusBadge.tsx
// Presentation atom for the Cơ sở dữ liệu table status column. Renders the
// driver-status presenter output ({label, tone}) as a coloured pill. Tone is a
// semantic input (warning/info/success/neutral); this atom is the ONE place
// that binds each tone to a semantic design-token role (never a raw palette
// literal), so colour choices never leak into the presenter or the table and
// can never drift from the @fleet/design-tokens SSOT. Consolidates the prior
// emerald-* shades into the existing green-based success roles (2026
// normalization: near-duplicate color families collapse to one semantic
// vocabulary -- name tokens by intent, not appearance). data-tone is emitted
// for stable, shade-agnostic testing + downstream styling hooks. Label text
// is rendered verbatim, preserving the immutable Vietnamese copy.
import type { JSX } from 'react';
import type { DriverDbStatusTone } from '@/features/admin/co-so-du-lieu.presenter';

// Full class strings per tone (never build class names by interpolation --
// Tailwind must see complete literals at build time to keep them in the CSS).
// Semantic utilities only: bg-*/text-*/ring-* reference the @theme CSS
// variables emitted from the design-token SSOT (see globals.css), never a
// raw slate-/indigo-/emerald-/etc palette shade.
const TONE_CLASSES: Record<DriverDbStatusTone, string> = {
  warning: 'bg-warning-subtle text-warning-strong ring-warning-strong/20',
  info: 'bg-accent text-accent-text ring-accent-text/20',
  success: 'bg-success-subtle text-success-text ring-success/20',
  neutral: 'bg-surface-subtle text-text-muted ring-text-muted/20',
};

export interface StatusBadgeProps {
  readonly label: string;
  readonly tone: DriverDbStatusTone;
}

export function StatusBadge({ label, tone }: StatusBadgeProps): JSX.Element {
  return (
    <span
      data-tone={tone}
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
        TONE_CLASSES[tone]
      }
    >
      {label}
    </span>
  );
}
