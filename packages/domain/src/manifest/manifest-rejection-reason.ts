// packages/domain/src/manifest/manifest-rejection-reason.ts
// Manifest rejection reason enum per Frozen Stack PDF "Manifest" + DB pgEnum
// manifest_rejection_reason. Single source of truth for API DTO + worker intake.
import { z } from 'zod';

export const MANIFEST_REJECTION_REASONS = [
  'blurred_image',
  'wrong_manifest',
  'missing_page',
  'oversized_file',
  'unsupported_format',
  'duplicate_upload',
  'hash_mismatch',
  'virus_detected',
  'other',
] as const;
export type ManifestRejectionReason = (typeof MANIFEST_REJECTION_REASONS)[number];

export const ManifestRejectionReasonSchema = z.enum(MANIFEST_REJECTION_REASONS);
