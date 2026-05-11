// apps/api/src/reference/reference.dto.ts
export interface ReferenceItem { readonly id: string; readonly label: string; readonly meta?: Record<string, string | null> }
export interface ReferenceListResponse { readonly items: ReadonlyArray<ReferenceItem> }
