// scripts/bootstrap-machine.ts
// PURE CORE for the machine bootstrap. No I/O, no spawning: every rule here is
// unit-tested without touching disk. The imperative shell is
// bootstrap-machine-cli.ts, mirroring the env-bootstrap and terminal-registry
// splits.
//
// WHY THIS EXISTS. Every credential guard this repo owns -- detect-secrets,
// detect-private-key, check-env-files, block-large-binaries -- runs ONLY from
// pre-commit. A clone with no hooks installed has none of them, silently.
// Prevention that must be remembered is not prevention; it is a coin flip that
// happens to keep landing heads.
//
// The subtler half: .pre-commit-config.yaml declares THREE hook types, and bare
// "pre-commit install" installs only pre-commit. Installing by hand on one
// machine left commit-msg and pre-push absent while looking finished. So the
// required set is DERIVED from the config rather than typed twice, and the
// decision reports which types are missing rather than reinstalling blindly.
import { z } from 'zod';

const NL = String.fromCharCode(10);

/** Git hook points this repo can install. "manual" and other pre-commit-only
 *  stages are deliberately excluded: they are not git hooks and installing
 *  them is a no-op that would make the installed set never match the wanted
 *  set, so bootstrap would report work to do on every single run. */
const INSTALLABLE_STAGES: readonly string[] = Object.freeze([
  'commit-msg',
  'post-checkout',
  'post-commit',
  'post-merge',
  'pre-commit',
  'pre-merge-commit',
  'pre-push',
  'pre-rebase',
  'prepare-commit-msg',
]);

/** Binaries the hooks shell out to. Absent, every hook fails at commit time --
 *  which is why a missing tool BLOCKS rather than proceeding to install. */
export const REQUIRED_TOOLS: readonly string[] = Object.freeze(['pre-commit', 'detect-secrets']);

/** What this repo's config declares today. Asserted against the real file by
 *  bootstrap-machine.guard.test.ts, so adding a stage to the config without
 *  updating this constant fails a test instead of silently under-installing. */
export const REQUIRED_HOOK_TYPES: readonly string[] = Object.freeze([
  'commit-msg',
  'pre-commit',
  'pre-push',
]);

/** Every git-installable stage the config names, sorted and deduplicated.
 *
 *  Deliberately a line scan rather than a YAML parse. The question asked is
 *  "which stage words appear", and that answer is identical either way, while
 *  a structural parse would couple this to pre-commit's schema -- which has
 *  already renamed these once (commit -> pre-commit, push -> pre-push, the
 *  deprecation this repo's own hook output warns about).
 *
 *  pre-commit is always included: it is the default stage, so hooks that
 *  declare no stages at all run there and would otherwise go uninstalled. */
export function parseDeclaredStages(configText: string): readonly string[] {
  const found = new Set<string>(['pre-commit']);
  for (const line of configText.split(NL)) {
    const marker = 'stages:';
    const at = line.indexOf(marker);
    if (at < 0) continue;
    for (const stage of INSTALLABLE_STAGES) {
      if (line.slice(at + marker.length).includes(stage)) found.add(stage);
    }
  }
  return Object.freeze([...found].sort());
}

export interface MachineState {
  readonly toolsPresent: readonly string[];
  readonly installedHookTypes: readonly string[];
  readonly isCi: boolean;
}

export type BootstrapFinding =
  | { readonly outcome: 'ready' }
  | { readonly outcome: 'skipped' }
  | { readonly outcome: 'install'; readonly hookTypes: readonly string[] }
  | { readonly outcome: 'blocked'; readonly missingTools: readonly string[] };

const HookTypesSchema = z.array(z.string()).min(1, 'refusing to install an empty hook set');

/** PURE. Ordered gate.
 *
 *  CI first: hooks never run in CI, the tools are not installed there, and this
 *  is reached from a prepare script that fires on every workflow's install. A
 *  hard failure there would redden eight pipelines to enforce a workstation
 *  concern.
 *
 *  Tools before hooks: installing hook types whose binaries are absent produces
 *  a clone that fails at commit time with a confusing error, which is strictly
 *  worse than not installing and saying why. */
export function decideBootstrap(state: MachineState): BootstrapFinding {
  if (state.isCi) return { outcome: 'skipped' };

  const missingTools = REQUIRED_TOOLS.filter((t) => !state.toolsPresent.includes(t));
  if (missingTools.length > 0) {
    return { outcome: 'blocked', missingTools: Object.freeze(missingTools) };
  }

  const missingHooks = REQUIRED_HOOK_TYPES.filter((h) => !state.installedHookTypes.includes(h));
  if (missingHooks.length > 0) {
    return { outcome: 'install', hookTypes: Object.freeze(HookTypesSchema.parse(missingHooks)) };
  }

  return { outcome: 'ready' };
}

/** PURE. One actionable line per finding. Names the condition and the remedy. */
export function describeFinding(finding: BootstrapFinding): string {
  if (finding.outcome === 'skipped') {
    return 'CI detected -- skipping hook install (hooks do not run in CI).';
  }
  if (finding.outcome === 'ready') {
    return 'hooks ready: ' + REQUIRED_HOOK_TYPES.join(', ') + ' installed.';
  }
  if (finding.outcome === 'install') {
    return 'installing hook types: ' + finding.hookTypes.join(', ');
  }
  return (
    'missing required tools: ' +
    finding.missingTools.join(', ') +
    '. Install them with: brew install ' +
    finding.missingTools.join(' ') +
    ' (or pipx install detect-secrets). Commits will NOT be secret-scanned until you do.'
  );
}
