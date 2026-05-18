// apps/ops-web/src/features/dispatch/constants.ts
// Plain shared constants for the dispatch feature. Kept out of the
// 'use server' action file because a server-action module may only export
// async functions — exporting a const there breaks the Next.js/Turbopack
// server-action loader (it then sees 'no exports at all').
export const MAX_DESTINATIONS = 4;
