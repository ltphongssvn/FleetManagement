// apps/ops-web/src/features/admin/StatusBadge.tsx
// Presentation atom for the Cơ sở dữ liệu table status column. Renders the
// driver-status presenter output ({label, tone}) as a coloured pill. Tone is a
// semantic input (warning/info/success/neutral); this atom is the ONE place
// that binds each tone to a concrete Tailwind colour family, so colour choices
// never leak into the presenter or the table. data-tone is emitted for stable,
// shade-agnostic testing + downstream styling hooks. Label text is rendered
// verbatim, preserving the immutable Vietnamese copy.
import type { JSX } from 'react';
import type { DriverDbStatusTone } from '@/features/admin/co-so-du-lieu.presenter';

// Full class strings per tone (never build class names by interpolation --
// Tailwind must see complete literals at build time to keep them in the CSS).
const TONE_CLASSES: Record<DriverDbStatusTone, string> = {
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  neutral: 'bg-slate-50 text-slate-600 ring-slate-500/20',
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
