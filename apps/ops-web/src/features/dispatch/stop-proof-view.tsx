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
import type { StopProof, ExtractionFailureReason } from '@fleet/sync-protocol';

// Human-readable Vietnamese for each extraction failure reason, so a dispatcher
// seeing Nhap KL also sees WHY it failed and can triage.
//
// Typed as a TOTAL Record over the SSOT ExtractionFailureReason union, NOT a
// loose Record<string, string>. That is load-bearing: develop added
// multiple_slips and non_standard_format to EXTRACTION_FAILURE_REASONS, and a
// loose map let both surfaces silently render nothing (or undefined) for them.
// With a total Record the compiler now fails the build when a reason is added
// to the SSOT without a Vietnamese label here -- the gap cannot reach a
// dispatcher unnoticed.
export const REASON_VI: Record<ExtractionFailureReason, string> = {
  unparseable: 'không đọc được số',
  below_sanity_min: 'dưới ngưỡng',
  above_sanity_max: 'vượt ngưỡng',
  no_field: 'không thấy ô KL',
  object_missing: 'thiếu ảnh',
  // Recognition-policy outcomes (T33): the layout itself was refused, so no
  // weight was ever derived. Distinct from a value that failed to parse.
  multiple_slips: 'nhiều phiếu trong ảnh',
  non_standard_format: 'mẫu phiếu không chuẩn',
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
    <span data-testid={testIds.root} className="inline-flex flex-col items-start gap-0.5">
      <a
        href={proof.photoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-text underline hover:text-primary-hover"
      >
        {'Phiếu Cân'}
      </a>
      {kg !== null ? (
        <span data-testid={testIds.netWeight} className="text-text-secondary tabular-nums">
          {formatNetWeightKg(kg)}
        </span>
      ) : proof.extractionStatus === 'not_found' || proof.extractionStatus === 'unreadable' ? (
        <>
          <button
            type="button"
            data-testid={testIds.needsEntry}
            onClick={() => onEnterNetWeight?.(proof.manifestId)}
            className="text-warning-text underline decoration-dotted hover:text-warning-strong"
          >
            {'Nhập KL'}
          </button>
          {proof.extractionReason != null ? (
            <span
              data-testid={testIds.reason}
              title={proof.extractionReason}
              className="text-warning-text text-xs italic"
            >
              {REASON_VI[proof.extractionReason]}
            </span>
          ) : null}
        </>
      ) : proof.extractionStatus === 'pending' || proof.extractionStatus === undefined ? (
        <span data-testid={testIds.pending} className="text-text-faint italic">
          {'Đang xử lý'}
        </span>
      ) : null}
    </span>
  );
}
