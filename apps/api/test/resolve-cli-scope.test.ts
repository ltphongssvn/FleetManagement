// apps/api/test/resolve-cli-scope.test.ts
// Factor XII + schema-first: admin CLI scripts resolve their pilot scope
// through ONE validated loader (validateRebuildEnv, derived from the
// EnvSchema SSOT), not a per-script raw process.env read + local z.uuid().
// resolveCliScope is the single seam: explicit --scope/positional wins and
// is validated against the same schema; otherwise the validated env default.
import { describe, it, expect } from 'vitest';
import { resolveCliScope } from '../src/scripts/resolve-cli-scope.js';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
describe('@fleet/api - resolveCliScope', () => {
  it('uses the --scope flag value when present, validated as a uuid', () => {
    expect(resolveCliScope(['--scope', A], { FLEET_PILOT_SCOPE: B })).toBe(A);
  });
  it('falls back to the validated env FLEET_PILOT_SCOPE when no flag', () => {
    expect(resolveCliScope([], { FLEET_PILOT_SCOPE: B })).toBe(B);
  });
  it('uses the schema default when neither flag nor env is set', () => {
    expect(resolveCliScope([], {})).toBe('00000000-0000-0000-0000-000000000000');
  });
  it('accepts a positional arg as scope when allowPositional is true', () => {
    expect(resolveCliScope([A], { FLEET_PILOT_SCOPE: B }, { allowPositional: true })).toBe(A);
  });
  it('ignores a positional arg by default (flag-only scripts)', () => {
    expect(resolveCliScope([A], { FLEET_PILOT_SCOPE: B })).toBe(B);
  });
  it('rejects a non-uuid --scope value', () => {
    expect(() => resolveCliScope(['--scope', 'not-a-uuid'], {})).toThrow();
  });
});
