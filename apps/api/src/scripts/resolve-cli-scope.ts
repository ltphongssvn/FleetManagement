// apps/api/src/scripts/resolve-cli-scope.ts
// Single seam for admin-CLI pilot-scope resolution (Factor XII + schema-
// first). Replaces the per-script raw process.env[FLEET_PILOT_SCOPE] read
// plus a local const ScopeSchema = z.uuid() duplicated across repair-ghost-
// runs / repair-complete-delivered-runs / projection-rebuild. An explicit
// --scope flag (or a leading positional, for scripts that allow it) wins;
// otherwise the value comes from the env. BOTH paths validate against the
// SAME FLEET_PILOT_SCOPE definition from the EnvSchema SSOT
// (EnvSchema.shape.FLEET_PILOT_SCOPE), which carries the canonical default,
// so there is no duplicated local schema and no coupling to unrelated env
// (DATABASE_URL etc.). Runs BEFORE any Nest/DB boot so a bad scope fails
// fast, before side effects.
import { EnvSchema } from '../config/env.config.js';
// Scope contract taken directly from the app env SSOT -- not a re-declared
// z.guid(). Includes the .default(...) applied on the env path.
const ScopeSchema = EnvSchema.shape.FLEET_PILOT_SCOPE;
export interface ResolveCliScopeOptions {
  readonly allowPositional?: boolean;
}
export function resolveCliScope(
  argv: readonly string[],
  env: Record<string, unknown>,
  options: ResolveCliScopeOptions = {},
): string {
  const flagIdx = argv.indexOf('--scope');
  if (flagIdx >= 0) {
    return ScopeSchema.parse(argv[flagIdx + 1]);
  }
  if (options.allowPositional === true && argv[0] !== undefined && !argv[0].startsWith('--')) {
    return ScopeSchema.parse(argv[0]);
  }
  return ScopeSchema.parse(env['FLEET_PILOT_SCOPE']);
}
