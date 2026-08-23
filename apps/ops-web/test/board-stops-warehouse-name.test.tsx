// apps/ops-web/test/board-stops-warehouse-name.test.tsx
// outside-in strict TDD RED (Feature 1): each board stop cell renders its
// warehouse NAME stacked ABOVE the Phiếu Cân link / arrival status, so the
// dispatcher sees which warehouse holds how many kg at a glance. warehouseName
// already flows from the API (canonical DispatchBoardStopSchema in
// @fleet/sync-protocol); this drives the missing render in board-stops.tsx.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StopSlotCells } from '@/features/dispatch/board-stops';
import type { DispatchBoardStop } from '@/features/dispatch/types';
import type { StopProof } from '@fleet/sync-protocol';

function renderCells(stops: readonly DispatchBoardStop[]): void {
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
  extractedNetWeightKg: 7920,
};

describe('board-stops warehouse name (Feature 1)', () => {
  it('renders the pickup warehouse name ABOVE the Phiếu Cân link', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Đức Tài',
      arrivedAt: null,
      departedAt: null,
      proof: PROOF,
    };
    renderCells([stop]);
    const nameNode = screen.getByTestId('board-stop-warehouse-XTT.06-005-pickup-1');
    expect(nameNode).toHaveTextContent('Đức Tài');
    const link = screen.getByRole('link', { name: /Phiếu Cân/i });
    expect(nameNode.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the warehouse name above the status text when there is no proof', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Chơn Chính',
      arrivedAt: null,
      departedAt: null,
      proof: null,
    };
    renderCells([stop]);
    const nameNode = screen.getByTestId('board-stop-warehouse-XTT.06-005-pickup-1');
    expect(nameNode).toHaveTextContent('Chơn Chính');
    const status = screen.getByTestId('board-stop-status-XTT.06-005-pickup-1');
    expect(status).toHaveTextContent('Chưa tới');
    expect(
      nameNode.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the delivery warehouse name in the Kho giao hàng cell', () => {
    const stop: DispatchBoardStop = {
      sequence: 2,
      stopType: 'delivery',
      warehouseName: 'Kho Giao 1',
      arrivedAt: null,
      departedAt: null,
      proof: { ...PROOF, extractedNetWeightKg: 50140 },
    };
    renderCells([stop]);
    expect(screen.getByTestId('board-stop-warehouse-XTT.06-005-delivery-1')).toHaveTextContent(
      'Kho Giao 1',
    );
  });

  it('renders no warehouse-name node when warehouseName is null (no em-dash leak)', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: null,
      arrivedAt: null,
      departedAt: null,
      proof: null,
    };
    renderCells([stop]);
    expect(screen.queryByTestId('board-stop-warehouse-XTT.06-005-pickup-1')).toBeNull();
  });
});
