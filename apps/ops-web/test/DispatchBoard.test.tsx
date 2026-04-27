// apps/ops-web/test/DispatchBoard.test.tsx
// RSC component test via @testing-library/react.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchBoard } from '@/features/dispatch/DispatchBoard';

describe('@fleet/ops-web - DispatchBoard', () => {
  beforeEach(() => {
    process.env['NEXT_PUBLIC_APP_VERSION'] = '0.1.0';
  });

  it('renders heading with app version', () => {
    render(<DispatchBoard />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Fleet Ops v0.1.0');
  });
});
