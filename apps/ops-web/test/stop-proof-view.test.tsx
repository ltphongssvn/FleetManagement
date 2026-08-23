// apps/ops-web/test/stop-proof-view.test.tsx
// Direct tests for the SSOT proof renderer shared by the dispatch board and the
// dispatcher review view. Extracting it from board-stops.tsx moved these paths
// out from under the board tests that used to reach them incidentally, so they
// are pinned here explicitly: every extraction outcome the dispatcher can see,
// plus the manual-entry callback.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StopProofView, formatNetWeightKg, REASON_VI } from '@/features/dispatch/stop-proof-view';
import { EXTRACTION_FAILURE_REASONS } from '@fleet/sync-protocol';
import type { StopProof } from '@fleet/sync-protocol';

afterEach(() => {
  cleanup();
});

const testIds = {
  root: 'proof-root',
  netWeight: 'proof-netweight',
  needsEntry: 'proof-needsentry',
  reason: 'proof-reason',
  pending: 'proof-pending',
};

function proofWith(overrides: Partial<StopProof>): StopProof {
  return {
    manifestId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    photoUrl: 'https://s3.test.local/pc.jpg?sig=x',
    capturedAt: '2026-07-20T02:10:00.000Z',
    extractedNetWeightKg: null,
    extractionStatus: 'pending',
    extractionReason: null,
    ...overrides,
  };
}

describe('formatNetWeightKg', () => {
  it('groups thousands the vi-VN way', () => {
    expect(formatNetWeightKg(20730)).toBe('20.730 kg');
  });
  it('keeps a single decimal place when present', () => {
    expect(formatNetWeightKg(1234.5)).toBe('1.234,5 kg');
  });
});

describe('StopProofView', () => {
  it('renders the extracted weight when one was parsed', () => {
    render(
      <StopProofView
        proof={proofWith({ extractedNetWeightKg: 20730, extractionStatus: 'extracted' })}
        testIds={testIds}
      />,
    );
    expect(screen.getByTestId('proof-netweight').textContent).toBe('20.730 kg');
    expect(screen.queryByTestId('proof-needsentry')).toBeNull();
    expect(screen.queryByTestId('proof-pending')).toBeNull();
  });

  it('always links the Phieu Can photo safely', () => {
    render(<StopProofView proof={proofWith({})} testIds={testIds} />);
    const link = screen.getByTestId('proof-root').querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://s3.test.local/pc.jpg?sig=x');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('shows the processing marker while extraction is pending', () => {
    render(<StopProofView proof={proofWith({ extractionStatus: 'pending' })} testIds={testIds} />);
    expect(screen.getByTestId('proof-pending')).toBeTruthy();
  });

  it('treats an absent extractionStatus as pending, so an older producer still renders a state', () => {
    const legacy = proofWith({});
    delete (legacy as { extractionStatus?: unknown }).extractionStatus;
    render(<StopProofView proof={legacy} testIds={testIds} />);
    expect(screen.getByTestId('proof-pending')).toBeTruthy();
  });

  it('offers manual entry when the weight could not be read, and explains why', () => {
    render(
      <StopProofView
        proof={proofWith({ extractionStatus: 'unreadable', extractionReason: 'unparseable' })}
        testIds={testIds}
      />,
    );
    expect(screen.getByTestId('proof-needsentry').textContent).toBe('Nhập KL');
    const reason = screen.getByTestId('proof-reason');
    expect(reason.textContent).toBe(REASON_VI.unparseable);
    expect(reason.getAttribute('title')).toBe('unparseable');
  });

  it('offers manual entry for a not_found outcome too', () => {
    render(
      <StopProofView
        proof={proofWith({ extractionStatus: 'not_found', extractionReason: 'no_field' })}
        testIds={testIds}
      />,
    );
    expect(screen.getByTestId('proof-needsentry')).toBeTruthy();
    expect(screen.getByTestId('proof-reason').textContent).toBe(REASON_VI.no_field);
  });

  it('omits the reason line when the failure carries no reason', () => {
    render(
      <StopProofView
        proof={proofWith({ extractionStatus: 'unreadable', extractionReason: null })}
        testIds={testIds}
      />,
    );
    expect(screen.getByTestId('proof-needsentry')).toBeTruthy();
    expect(screen.queryByTestId('proof-reason')).toBeNull();
  });

  it('invokes the manual-entry callback with the manifest id', () => {
    const onEnter = vi.fn();
    render(
      <StopProofView
        proof={proofWith({ extractionStatus: 'unreadable' })}
        testIds={testIds}
        onEnterNetWeight={onEnter}
      />,
    );
    fireEvent.click(screen.getByTestId('proof-needsentry'));
    expect(onEnter).toHaveBeenCalledWith('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('does not throw when manual entry is clicked with no callback wired', () => {
    render(
      <StopProofView proof={proofWith({ extractionStatus: 'unreadable' })} testIds={testIds} />,
    );
    expect(() => {
      fireEvent.click(screen.getByTestId('proof-needsentry'));
    }).not.toThrow();
  });

  it('renders the link alone for a manual status with no value yet', () => {
    render(<StopProofView proof={proofWith({ extractionStatus: 'manual' })} testIds={testIds} />);
    expect(screen.queryByTestId('proof-netweight')).toBeNull();
    expect(screen.queryByTestId('proof-needsentry')).toBeNull();
    expect(screen.queryByTestId('proof-pending')).toBeNull();
  });

  it('labels the recognition-policy refusals develop added to the SSOT vocabulary', () => {
    render(
      <StopProofView
        proof={proofWith({ extractionStatus: 'unreadable', extractionReason: 'multiple_slips' })}
        testIds={testIds}
      />,
    );
    expect(screen.getByTestId('proof-reason').textContent).toBe(REASON_VI.multiple_slips);
    cleanup();
    render(
      <StopProofView
        proof={proofWith({
          extractionStatus: 'unreadable',
          extractionReason: 'non_standard_format',
        })}
        testIds={testIds}
      />,
    );
    expect(screen.getByTestId('proof-reason').textContent).toBe(REASON_VI.non_standard_format);
  });

  it('has a Vietnamese label for EVERY reason in the SSOT vocabulary, so none renders blank', () => {
    for (const reason of EXTRACTION_FAILURE_REASONS) {
      const label = REASON_VI[reason];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
