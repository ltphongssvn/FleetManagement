// apps/ops-web/test/reference-schema-first.test.ts
// RED-first (schema-first arc, consumer side): the /reference/* wire shape
// must be consumed via the @fleet/sync-protocol SSOT, parsed at the network
// boundary -- never cast. Today ReferenceAdminClient casts res.json() twice
// and load-references casts three times against two DIVERGED hand-written
// twins (RefItem already lost meta). Behavior contract after conversion:
//   - client.list(): valid envelope -> items; shape-invalid envelope -> []
//     (lenient, matches the page''s empty-state handling); create(): valid ->
//     option; shape-invalid -> throws (a corrupt create response must never
//     enter state as a trusted row).
//   - load-references getters keep their lenient ?? [] / ?? '' fallbacks for
//     shape-invalid payloads (form still renders with empty dropdowns).
//   - SOURCE GUARD: no cast-after-json patterns in either file; both
//     import the contract from @fleet/sync-protocol; no local hand-written
//     twin interfaces remain (RefItem gone; ReferenceOption re-exported from
//     the contract, not re-declared).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReferenceAdminClient } from '@/features/admin/reference-admin-client';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(resolve(here, '../src', rel), 'utf8');

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('reference wire consumption is schema-first', () => {
  it('list() drops a shape-invalid envelope to [] instead of trusting the cast', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ items: [{ id: 1, label: 2 }] })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    expect(await client.list()).toEqual([]);
  });

  it('list() still returns valid items (including the meta bag)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ items: [{ id: 'c1', label: 'Acme', meta: { phone: '0901' } }] })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    expect(await client.list()).toEqual([{ id: 'c1', label: 'Acme', meta: { phone: '0901' } }]);
  });

  it('create() throws on a shape-invalid success payload instead of trusting the cast', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ wrong: true })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.create('Acme')).rejects.toThrow();
  });

  it('source guard: no res.json() casts, contract imported, no hand-written twins', () => {
    const client = src('features/admin/reference-admin-client.ts');
    const loader = src('features/dispatch/load-references.ts');
    for (const s of [client, loader]) {
      expect(s.includes(') as ' + String.fromCharCode(123))).toBe(false);
      expect(s.includes('@fleet/sync-protocol')).toBe(true);
    }
    expect(client.includes('as ReferenceOption')).toBe(false);
    expect(client.includes('export interface ReferenceOption')).toBe(false);
    expect(loader.includes('interface RefItem')).toBe(false);
    expect(loader.includes('as ' + String.fromCharCode(123) + ' ref?: string ' + String.fromCharCode(125))).toBe(false);
  });
});
