// apps/api/test/transport-schema-enum-domain-ssot.test.ts
// RED (schema-first / two-axis Zod, fix-trigger 2): the drizzle pgEnum
// vocabularies in database/schema/transport.ts must BE the @fleet/domain
// SSOT, not a hand-copied replica of it. transport.ts even documents the
// duplication in a comment (pgEnum mirrors @fleet/domain
// TRANSPORT_ORDER_STATES) -- a mirror is exactly the drift hazard this
// guards: the DB enum and the domain FSM can silently diverge, and nothing
// fails until a state written by the app is rejected by Postgres.
//
// manifest.ts already imports its vocabularies from @fleet/domain and
// @fleet/sync-protocol (PR #313); transport.ts was left behind because its
// arrays are annotated readonly T[] rather than a bare as-const tuple, so a
// naive import does not typecheck against pgEnum Readonly<[U, ...U[]]>.
// The Zod schema options ARE that tuple, and are the Axis-2 z.infer SSOT, so
// they are the correct anchor.
//
// Axis-2 (z.infer SSOT): assert the SAME ORDER, not just set equality.
// pgEnum order is the declared Postgres enum sort order; a reordering is a
// real schema change even when the member set is identical.
import { describe, it, expect } from 'vitest';
import { TransportOrderStateSchema, RoadRunStateSchema } from '@fleet/domain';
import {
  transportOrderStateEnum,
  roadRunStateEnum,
} from '../src/database/schema/transport.js';
describe('transport.ts pgEnum vocabularies are the @fleet/domain SSOT', () => {
  it('transport_order_state enumValues match TransportOrderStateSchema options in order', () => {
    expect(transportOrderStateEnum.enumValues).toEqual([...TransportOrderStateSchema.options]);
  });
  it('road_run_state enumValues match RoadRunStateSchema options in order', () => {
    expect(roadRunStateEnum.enumValues).toEqual([...RoadRunStateSchema.options]);
  });
  it('transport.ts declares no inline state literals (imports the SSOT instead)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../src/database/schema/transport.ts', import.meta.url),
      'utf8',
    );
    // The pgEnum call must receive an imported identifier, never an array
    // literal. Source-scanning guard mirrors the testcontainers regression
    // guard precedent (PR #274): it fails on REINTRODUCTION, which a value
    // assertion alone cannot catch (a re-copied array still passes toEqual).
    const inlineTransport = /pgEnum\(\s*'transport_order_state'\s*,\s*\[/.test(src);
    const inlineRoadRun = /pgEnum\(\s*'road_run_state'\s*,\s*\[/.test(src);
    expect({ inlineTransport, inlineRoadRun }).toEqual({
      inlineTransport: false,
      inlineRoadRun: false,
    });
  });
});
