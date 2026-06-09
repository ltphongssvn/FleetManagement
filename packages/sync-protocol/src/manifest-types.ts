// packages/sync-protocol/src/manifest-types.ts
// Shared manifest constants used by API DTOs and worker intake policy.
export const ALLOWED_MANIFEST_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
] as const;

export type ManifestMimeType = (typeof ALLOWED_MANIFEST_MIME_TYPES)[number];

/** Hard cap on a manifest artifact (matches the API negotiate/commit DTO limit).
 *  Shared so the API producer, API DTO, and worker intake policy agree on one
 *  number for the intake job's maxSizeBytes / oversized_file check. */
export const MANIFEST_MAX_SIZE_BYTES: number = 50 * 1024 * 1024;
