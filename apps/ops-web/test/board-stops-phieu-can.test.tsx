// apps/ops-web/test/board-stops-phieu-can.test.tsx
// outside-in strict TDD RED: a stop with a committed proof photo renders a
// clickable "Phiếu Cân" link to the photo URL (presigned S3 GET) in its board
// cell, instead of the plain arrival-status text. A stop without proof keeps
// showing the status. proof shape is the single-source-of-truth StopProof from
// @fleet/sync-protocol (Zod-first; producer = API, consumer = ops-web).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StopSlotCells } from '@/features/dispatch/board-stops';
import type { DispatchBoardStop } from '@/features/dispatch/types';
import type { StopProof } from '@fleet/sync-protocol';

function renderCells(stops: readonly DispatchBoardStop[]): void {
  // StopSlotCells returns <td> cells; wrap in a table row so the DOM is valid.
  render(
    <table>
      <tbody>
        <tr>
          <StopSlotCells primaryRef="XTT.06-005" stops={stops} />
        </tr>
      </tbody>
    </table>,
  );
}

const PROOF: StopProof = {
  manifestId: '55555555-aaaa-4aaa-8aaa-555555555555',
  photoUrl: 'https://s3.example/signed-proof?sig=test',
  capturedAt: '2026-06-08T01:00:00.000Z',
};

describe('board-stops Phiếu Cân proof link', () => {
  it('renders a "Phiếu Cân" link to the photo URL for a pickup stop with proof', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Cường Thắng',
      arrivedAt: null,
      departedAt: null,
      proof: PROOF,
    };
    renderCells([stop]);
    const link = screen.getByRole('link', { name: /Phiếu Cân/i });
    expect(link).toHaveAttribute('href', PROOF.photoUrl);
  });

  it('shows status text (no link) for a stop without proof', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Cường Thắng',
      arrivedAt: null,
      departedAt: null,
      proof: null,
    };
    renderCells([stop]);
    expect(screen.queryByRole('link', { name: /Phiếu Cân/i })).toBeNull();
    // Disambiguate by the per-slot testid the component already emits.
    expect(screen.getByTestId('board-stop-status-XTT.06-005-pickup-1')).toHaveTextContent('Chưa tới');
  });

  it('renders the extracted net weight (vi-VN formatted kg) beside the Phiếu Cân link', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Cường Thắng',
      arrivedAt: null,
      departedAt: null,
      proof: { ...PROOF, extractedNetWeightKg: 20730 },
    };
    renderCells([stop]);
    const cell = screen.getByTestId('board-stop-status-XTT.06-005-pickup-1');
    expect(cell).toHaveTextContent('20.730 kg');
    expect(screen.getByRole('link', { name: /Phiếu Cân/i })).toHaveAttribute('href', PROOF.photoUrl);
  });

  it('shows the link only (no kg text) when extraction has not produced a value', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Cường Thắng',
      arrivedAt: null,
      departedAt: null,
      proof: PROOF,
    };
    renderCells([stop]);
    const cell = screen.getByTestId('board-stop-status-XTT.06-005-pickup-1');
    expect(cell).not.toHaveTextContent('kg');
  });
});
