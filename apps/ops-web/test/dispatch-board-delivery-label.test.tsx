// apps/ops-web/test/dispatch-board-delivery-label.test.tsx
// Outside-in strict TDD RED step for Feature 1 (2026): the Lệnh điều xe board's
// delivery column header MUST render the bare label 'Kho giao hàng' (no '1'
// suffix), because there is exactly ONE delivery slot per road run
// (DELIVERY_SLOTS = [1] in board-stops.tsx) and the trailing '1' carries no
// information for the dispatcher.
//
// This test pins the user-facing contract independently of the existing
// dispatch-view-stop-status-columns.test (which still encodes the OLD label
// 'Kho giao hàng 1'); once this RED test is satisfied by the production-code
// change, the old assertion that encodes the OLD contract will be retired in
// the same PR's GREEN step.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StopSlotHeaders } from '../src/features/dispatch/board-stops';

describe('dispatch board delivery column label (2026)', () => {
  it('renders the delivery header as plain Kho giao hàng (no 1 suffix)', () => {
    const { container } = render(
      // StopSlotHeaders is a fragment of <th> elements; render inside a
      // valid <table><thead><tr> ancestor chain so React does not warn about
      // misplaced <th> and the DOM matches the production usage.
      <table>
        <thead>
          <tr>
            <StopSlotHeaders />
          </tr>
        </thead>
      </table>,
    );
    const headers = Array.from(container.querySelectorAll('th')).map(
      (th) => th.textContent,
    );
    // Positive assertion: the bare label must be present somewhere.
    expect(headers).toContain('Kho giao hàng');
    // Negative assertion: the legacy label MUST NOT appear anywhere.
    expect(headers).not.toContain('Kho giao hàng 1');
  });
});
