// apps/ops-web/test/create-order-form-field-error.test.tsx
// Direct unit test for the FieldError sub-component. Covers the JSX branch
// where `msg` is non-empty (line 34 in CreateOrderForm.tsx).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldError } from '@/features/dispatch/CreateOrderForm';

describe('FieldError', () => {
  it('renders the message when msg is non-empty', () => {
    render(<FieldError msg="Required" />);
    expect(screen.getByText('Required')).toBeDefined();
  });

  it('returns null when msg is undefined', () => {
    const { container } = render(<FieldError />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when msg is an empty string', () => {
    const { container } = render(<FieldError msg="" />);
    expect(container.firstChild).toBeNull();
  });
});
