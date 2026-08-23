// apps/api/test/format-db-error.test.ts
// Root-cause fix (2026-07-19): the admin/audit CLI scripts caught errors and
// printed only err.message. Since drizzle-orm 0.44.0 a failed query throws a
// DrizzleQueryError whose message is just the SQL text; the ACTUAL database
// error (auth failure, permission denied, undefined relation) lives on
// err.cause (the node-postgres DatabaseError, carrying .code/.detail/.severity).
// Dropping .cause made every prod failure look identical and undiagnosable --
// a live incident: audit-assignment-uniqueness against prod printed Failed
// query: ... with no reason, while the real cause was password authentication
// failed. formatDbError walks the cause chain and surfaces the driver error.
//
// Pure string formatter: crosses no trust boundary, defines no duplicated
// contract shape -> plain TS by the two-axis rule, no Zod.
import { describe, it, expect } from 'vitest';
import { formatDbError } from '../src/scripts/format-db-error.js';

describe('@fleet/api - formatDbError', () => {
  it('returns a plain Error message when there is no cause', () => {
    expect(formatDbError(new Error('boom'))).toBe('boom');
  });

  it('surfaces the underlying cause message behind a wrapper', () => {
    const wrapper = new Error('Failed query: SELECT 1');
    (wrapper as { cause?: unknown }).cause = new Error('password authentication failed');
    const out = formatDbError(wrapper);
    expect(out).toContain('Failed query: SELECT 1');
    expect(out).toContain('password authentication failed');
  });

  it('includes a pg error code and detail when the cause carries them', () => {
    const wrapper = new Error('Failed query: INSERT ...');
    (wrapper as { cause?: unknown }).cause = Object.assign(
      new Error('permission denied for table driver_vehicle_assignment'),
      {
        code: '42501',
        detail: 'role fleet_app lacks SELECT',
      },
    );
    const out = formatDbError(wrapper);
    expect(out).toContain('42501');
    expect(out).toContain('permission denied for table driver_vehicle_assignment');
    expect(out).toContain('role fleet_app lacks SELECT');
  });

  it('walks a multi-level cause chain to the root driver error', () => {
    const root = Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' });
    const mid = new Error('query failed');
    (mid as { cause?: unknown }).cause = root;
    const top = new Error('Failed query: SELECT 1');
    (top as { cause?: unknown }).cause = mid;
    const out = formatDbError(top);
    expect(out).toContain('ECONNRESET');
    expect(out).toContain('connection terminated');
  });

  it('handles a non-Error thrown value without throwing', () => {
    expect(formatDbError('just a string')).toContain('just a string');
    expect(formatDbError(null)).toBeTypeOf('string');
  });

  it('does not repeat the same message twice when cause equals wrapper text', () => {
    const wrapper = new Error('same');
    (wrapper as { cause?: unknown }).cause = new Error('same');
    expect(formatDbError(wrapper).match(/same/g)?.length).toBe(1);
  });
});
