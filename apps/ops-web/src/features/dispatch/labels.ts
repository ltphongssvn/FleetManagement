// apps/ops-web/src/features/dispatch/labels.ts
// Pure label-formatting helpers for the dispatch board. No fetch, no React,
// no env coupling — deterministic transforms only, so the UI layer can
// remain a thin declarative renderer that calls these for every cell.
//
// Invariant the dispatcher relies on: the table must never display an opaque
// UUID. If a reference lookup misses (stale cache, deleted row), we fall
// back to an em-dash rather than leaking the id.
import type { RefItem } from './load-references';
const DASH = '—';
export function formatOrderRef(refs: readonly string[]): string {
  const first = refs[0];
  if (typeof first !== 'string' || first.trim() === '') return DASH;
  return first;
}
export function buildLookup(items: readonly RefItem[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const it of items) out.set(it.id, it.label);
  return out;
}
export function formatOperator(id: string | null, lookup: ReadonlyMap<string, string>): string {
  if (id === null) return DASH;
  return lookup.get(id) ?? DASH;
}
export function formatVehicle(id: string | null, lookup: ReadonlyMap<string, string>): string {
  if (id === null) return DASH;
  return lookup.get(id) ?? DASH;
}
