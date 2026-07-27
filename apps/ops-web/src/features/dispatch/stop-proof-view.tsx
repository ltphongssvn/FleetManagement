// apps/ops-web/src/features/dispatch/stop-proof-view.tsx
// SSOT for rendering a committed Phieu Can proof on ANY dispatch surface.
//
// Why this module exists: the BOARD rendered a proof as a Phieu Can link over
// its extracted kg, while the REVIEW view knew nothing about proofs and fell
// back to arrival timestamps -- so a completed order with uploaded photos read
// Chua toi on review and 20.730 kg on the board, from the same data. Two
// renderers for one concept is the drift; this is the one renderer.
//
// Surfaces differ ONLY in their data-testid vocabulary, so the ids are injected
// rather than derived by string surgery inside the component.
import type { JSX } from 'react';
import type { StopProof } from '@fleet/sync-protocol';

// Human-readable Vietnamese for each extraction failure reason, so a dispatcher
// seeing Nhap KL also sees WHY it failed and can triage (unparseable vs missing
// photo vs out-of-range). Vocabulary mirrors the SSOT EXTRACTION_FAILURE_REASONS.
export const REASON_VI: Record<string, string> = {
  unparseable: 'không đọc được số',
  below_sanity_min: 'dưới ngưỡng',
  above_sanity_max: 'vượt ngưỡng',
  no_field: 'không thấy ô KL',
  object_missing: 'thiếu ảnh',
};

// vi-VN grouping: 20730 reads 20.730 kg. One formatter, so the board and the
// review view can never print the same weight two ways.
export function formatNetWeightKg(kg: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(kg) + ' kg';
}

export interface StopProofTestIds {
  readonly root: string;
  readonly netWeight: string;
  readonly needsEntry: string;
  readonly reason: string;
  readonly pending: string;
}

// The proof cell: Phieu Can link on top, and directly under it either the
// extracted weight, a Nhap KL manual-entry affordance (+ the reason), or a
// processing marker -- never a blank, so the dispatcher always knows the state.
// The <a opener deliberately shares its line with the first attribute: a bare
// <a alone on a shallow-indented line gets stripped by some shells during
// heredoc writes (context/file-editing-pattern.md, rule 5).
export function StopProofView({
  proof,
  testIds,
  onEnterNetWeight,
}: {
  proof: StopProof;
  testIds: StopProofTestIds;
  onEnterNetWeight?: ((manifestId: string) => void) | undefined;
}): JSX.Element {
  const kg = proof.extractedNetWeightKg ?? null;
  return (
    <span data-testid={testIds.root} className='inline-flex flex-col items-start gap-0.5'>
      <a href={proof.photoUrl}
        target='_blank'
        rel='noopener noreferrer'
        className='text-blue-600 underline hover:text-blue-800'
      >
        {'Phiếu Cân'}
      </a>
      {kg !== null ? (
        <span data-testid={testIds.netWeight} className='text-gray-700 tabular-nums'>
          {formatNetWeightKg(kg)}
        </span>
      ) : proof.extractionStatus === 'not_found' || proof.extractionStatus === 'unreadable' ? (
        <>
          <button
            type='button'
            data-testid={testIds.needsEntry}
            onClick={() => onEnterNetWeight?.(proof.manifestId)}
            className='text-amber-700 underline decoration-dotted hover:text-amber-900'
          >
            {'Nhập KL'}
          </button>
          {proof.extractionReason != null && REASON_VI[proof.extractionReason] !== undefined ? (
            <span
              data-testid={testIds.reason}
              title={proof.extractionReason}
              className='text-amber-600 text-xs italic'
            >
              {REASON_VI[proof.extractionReason]}
            </span>
          ) : null}
        </>
      ) : proof.extractionStatus === 'pending' || proof.extractionStatus === undefined ? (
        <span data-testid={testIds.pending} className='text-gray-400 italic'>
          {'Đang xử lý'}
        </span>
      ) : null}
    </span>
  );
}
