// apps/ops-web/test/co-so-du-lieu-page-devices-section.test.tsx
// RED (P7 slice-C): the devices approval queue must be REACHABLE in the browser
// -- an admin cannot approve a pending device from a component that no page
// renders. It mounts on the consolidated Co so du lieu admin page (which
// deliberately absorbed the separate Doi xe / Du lieu pages), so no third nav
// entry is added. Child sections are stubbed: this asserts COMPOSITION only.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/features/admin/DriversAdminSection', () => ({
  DriversAdminSection: () => <div data-testid="stub-drivers-section" />,
}));
vi.mock('@/features/admin/reference-sections', () => ({
  SECTIONS: [],
  ReferenceSection: () => <div data-testid="stub-reference-section" />,
}));
vi.mock('@/features/admin/DevicesApprovalSection', () => ({
  DevicesApprovalSection: () => <div data-testid="stub-devices-section" />,
}));

import CoSoDuLieuPage from '@/app/admin/co-so-du-lieu/page';

describe('Co so du lieu page', () => {
  it('renders the devices approval section so an admin can reach the queue', () => {
    render(<CoSoDuLieuPage />);
    expect(screen.getByTestId('stub-devices-section')).toBeInTheDocument();
  });
  it('keeps rendering the existing drivers section (no regression)', () => {
    render(<CoSoDuLieuPage />);
    expect(screen.getByTestId('stub-drivers-section')).toBeInTheDocument();
  });
  it('labels the devices card with its Vietnamese heading', () => {
    render(<CoSoDuLieuPage />);
    expect(screen.getByText('Thiết bị')).toBeInTheDocument();
  });
});
