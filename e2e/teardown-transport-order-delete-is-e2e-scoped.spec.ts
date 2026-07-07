// e2e/teardown-transport-order-delete-is-e2e-scoped.spec.ts
// Regression guard (dispatch-pair-visibility arc, U3): the global-teardown
// transport_order DELETE must stay scoped to E2E-named vehicle/driver pairs.
// The 2026-07-05 incident: it matched EVERY company transport_order while
// the road_run DELETE matched only E2E pairs, orphaning real road_runs in
// non-terminal states and permanently hiding idle pairs from So xe / Tai xe.
// Static source-shape check: runs with the suite, needs no live stack.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test('global-teardown transport_order DELETE is E2E-scoped like its siblings', () => {
  const src = readFileSync(join(here, 'global-teardown.ts'), 'utf-8');
  const statements = src
    .split('DELETE FROM transport_order')
    .slice(1)
    .map((chunk) => chunk.split(';')[0] ?? '');
  // Exactly two: the rrto-join family delete + the orphan-order sweep.
  expect(statements.length).toBe(2);
  // Discriminate by NOT EXISTS: the orphan sweep contains it, the join
  // delete does not (rrto appears in both, so rrto cannot tell them apart).
  const orphanSweeps = statements.filter((s) => s.includes('NOT EXISTS'));
  const joinDeletes = statements.filter((s) => s.includes('NOT EXISTS') === false);
  expect(orphanSweeps.length).toBe(1);
  expect(joinDeletes.length).toBe(1);
  const joined = joinDeletes[0] ?? '';
  // The join delete must carry BOTH E2E predicates (vehicle plate + driver name).
  expect(joined).toContain('E2E-%');
  expect(joined).toContain('E2E%');
});
