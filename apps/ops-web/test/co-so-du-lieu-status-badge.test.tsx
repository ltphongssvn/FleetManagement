// apps/ops-web/test/co-so-du-lieu-status-badge.test.tsx
// RED-first for the StatusBadge atom the Cơ sở dữ liệu table renders in its
// status column. It takes the presenter output (label + tone) and paints a
// coloured pill: each DriverDbStatusTone maps to one Tailwind colour family
// (warning->amber, info->sky, success->emerald, neutral->slate) and exposes
// data-tone for a stable, shade-agnostic assertion. Label text renders verbatim
// so the immutable Vietnamese copy flows through unchanged.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/features/admin/StatusBadge';

const CASES = [
  { tone: 'warning', label: 'Chưa phân công', family: 'amber' },
  { tone: 'info', label: 'Đã giao xe', family: 'sky' },
  { tone: 'success', label: 'Đang hoạt động', family: 'emerald' },
  { tone: 'neutral', label: 'Không rõ', family: 'slate' },
] as const;

describe('StatusBadge', () => {
  it.each(CASES)(
    'renders $label with the $family family and data-tone=$tone',
    ({ tone, label, family }) => {
      render(<StatusBadge label={label} tone={tone} />);
      const el = screen.getByText(label);
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute('data-tone', tone);
      expect(el.className).toContain(family);
    },
  );

  it('maps every tone to a distinct colour family', () => {
    const families = CASES.map((c) => c.family);
    expect(new Set(families).size).toBe(families.length);
  });
});
