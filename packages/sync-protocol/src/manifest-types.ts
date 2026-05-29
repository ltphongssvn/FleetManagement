// packages/sync-protocol/src/manifest-types.ts
// Shared manifest constants used by API DTOs and worker intake policy.
export const ALLOWED_MANIFEST_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
] as const;

export type ManifestMimeType = (typeof ALLOWED_MANIFEST_MIME_TYPES)[number];
