// apps/ops-web/test/co-so-du-lieu-status-badge.test.tsx
// RED-first for the StatusBadge atom the Cơ sở dữ liệu table renders in its
// status column. It takes the presenter output (label + tone) and paints a
// coloured pill: each DriverDbStatusTone maps to a semantic design-token role
// (warning->warning, info->accent, success->success, neutral->surface/text)
// and exposes data-tone for a stable, shade-agnostic assertion. Asserts the
// SEMANTIC role name appears in className -- never a raw palette family
// (slate/amber/sky/emerald), so this test cannot silently re-permit a
// hardcoded literal regressing into the component. Label text renders
// verbatim so the immutable Vietnamese copy flows through unchanged.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/features/admin/StatusBadge';

const CASES = [
  { tone: 'warning', label: 'Chưa phân công', role: 'warning' },
  { tone: 'info', label: 'Đã giao xe', role: 'accent' },
  { tone: 'success', label: 'Đang hoạt động', role: 'success' },
  { tone: 'neutral', label: 'Không rõ', role: 'surface' },
] as const;

const RAW_PALETTE_FAMILIES = ['slate', 'amber', 'sky', 'emerald', 'indigo', 'red', 'green', 'violet'];

describe('StatusBadge', () => {
  it.each(CASES)(
    'renders $label with the $role semantic role and data-tone=$tone',
    ({ tone, label, role }) => {
      render(<StatusBadge label={label} tone={tone} />);
      const el = screen.getByText(label);
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute('data-tone', tone);
      expect(el.className).toContain(role);
    },
  );

  it('maps every tone to a distinct semantic role', () => {
    const roles = CASES.map((c) => c.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('never renders a raw palette family literal (semantic tokens only)', () => {
    for (const { label, tone } of CASES) {
      render(<StatusBadge label={label} tone={tone} />);
      const el = screen.getByText(label);
      for (const family of RAW_PALETTE_FAMILIES) {
        expect(el.className).not.toContain('-' + family + '-');
      }
    }
  });
});
