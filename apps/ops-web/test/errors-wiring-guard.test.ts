// apps/ops-web/test/errors-wiring-guard.test.ts
// RED-first (Phase 4.2): source-assertion guard making dispatcher-visible raw
// error text UNREPRESENTABLE in ops-web, the twin of the driver-app screen
// guard. Three surfaces:
//   ACTIONS (create/cancel/export): the !res.ok branch must read the response
//   body and produce message via vnApiErrorMessage(res.status, body[, ctx]);
//   the raw concatenations ("API request failed: " / "Export failed: ") must
//   be gone. Forms keep rendering result.message -- unchanged by design.
//   BOUNDARIES (error.tsx, global-error.tsx): fixed Vietnamese copy; NEVER
//   error.message (a boundary receives arbitrary internals: pg strings, env
//   dumps). error.tsx additionally reports to Sentry (parity with global).
//   ADMIN PAGES (drivers, reference): import the presenter; no raw e.message
//   in dispatch()/setError()/alert() payloads.
// Fails RED until all surfaces are rewired.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(resolve(here, '../src', rel), 'utf8');

const ACTIONS = [
  'features/dispatch/create-order.action.ts',
  'features/dispatch/cancel-order.action.ts',
  'features/dispatch/export-orders-excel.action.ts',
] as const;

const BOUNDARIES = ['app/error.tsx', 'app/global-error.tsx'] as const;

// reference/page.tsx is deliberately EXEMPT: its client (T5b) throws
// ALREADY-PRESENTED server Vietnamese (e.g. the da-ton-tai 409 copy) and the
// page must surface that message verbatim -- routing it through the
// presenter would swallow intentional copy (conflict-consistency test).
// The driver CRUD surface was extracted into the shared DriversAdminSection
// (both the thin /admin/drivers shell and the Co so du lieu page render it), so
// the presenter wiring lives there now -- assert the guard on the section.
const ADMIN_PAGES = ['features/admin/DriversAdminSection.tsx'] as const;

describe('ops-web error wiring guard', () => {
  it.each([...ACTIONS])('%s routes !res.ok through vnApiErrorMessage on a read body', (file) => {
    const s = src(file);
    expect(s.includes('vnApiErrorMessage(')).toBe(true);
    // Both import forms count: ../errors/present-problem (dispatch siblings)
    // and @/features/errors/present-problem (app pages).
    expect(s.includes('errors/present-problem')).toBe(true);
    expect(s.includes('API request failed')).toBe(false);
    expect(s.includes('Export failed')).toBe(false);
    expect(s.includes('res.statusText')).toBe(false);
  });

  it.each([...BOUNDARIES])('%s shows fixed Vietnamese copy and never error.message', (file) => {
    const s = src(file);
    expect(s.includes('error.message')).toBe(false);
    expect(s.includes(String.fromCharCode(272,227,32,120,7843,121,32,114,97,32,108,7895,105))).toBe(true);
    expect(s.includes('Sentry.captureException')).toBe(true);
  });

  it.each([...ADMIN_PAGES])('%s imports the presenter and renders no raw e.message', (file) => {
    const s = src(file);
    expect(s.includes('features/errors/present-problem')).toBe(true);
    expect(s.includes('vnExceptionMessage(')).toBe(true);
    // Precise raw-exception forms only: state.message (already-presented
    // action/store output) legitimately contains the substring e.message.
    expect(s.includes('instanceof Error ? e.message')).toBe(false);
    expect(s.includes(' e.message')).toBe(false);
  });

  it('auth strings in actions are dispatcher Vietnamese, not English internals', () => {
    for (const file of ACTIONS) {
      const s = src(file);
      expect(s.includes('Not authenticated')).toBe(false);
    }
  });
});
