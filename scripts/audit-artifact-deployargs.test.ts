// scripts/audit-artifact-deployargs.test.ts
// THE FLAGS MUST MATCH THE DOCKERFILES, asserted against the Dockerfiles.
//
// WHAT HAPPENED, 2026-08-18. deployArgs was written from the Dockerfile's
// visible `deploy --prod --no-optional` and MISSED the continuation line
// carrying --config.inject-workspace-packages=true. pnpm 10+ refuses a deploy
// from a non-injected workspace, so every run failed with
// ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE and the gate reported UNVERIFIABLE.
//
// The fail-closed design held -- it refused rather than passing on an unbuilt
// tree -- but the near-miss is the interesting part: pnpm's own error message
// offers --legacy as the alternative, and taking it would have produced a
// GREEN gate auditing a DIFFERENT tree from the one that ships. That is the
// exact fiction this task exists to eliminate, arrived at by following a
// remedy the tool suggested.
//
// So the flags are no longer asserted against my reading of the Dockerfile.
// They are asserted against the DOCKERFILE ITSELF: the test reads the file and
// requires every flag deployArgs emits to appear in it. A Dockerfile change
// that this planner does not follow now fails here rather than in CI, or worse,
// silently in a passing audit of the wrong tree.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPED_PACKAGES, deployArgs } from './audit-artifact.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The Dockerfile that builds each shipped package, by the same derivation the
 *  SHIPPED_PACKAGES list uses. */
const DOCKERFILE_FOR: Readonly<Record<string, string>> = {
  '@fleet/api': 'Dockerfile.api',
  '@fleet/main-worker': 'Dockerfile.worker',
};

function dockerfile(name: string): string {
  return readFileSync(resolve(repoRoot, name), 'utf8');
}

describe('deployArgs carries the flag pnpm 10+ requires', () => {
  // THE OBSERVED FAILURE. Without this, every deploy exits
  // ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE and the gate can never run.
  it('passes --config.inject-workspace-packages=true', () => {
    expect(deployArgs('@fleet/api', 'out')).toContain('--config.inject-workspace-packages=true');
  });

  // THE TRAP THE ERROR MESSAGE SETS. pnpm offers --legacy as the alternative,
  // and it WOULD make the deploy succeed -- while building a different tree
  // from the one that ships. A green gate over the wrong artifact is worse
  // than a red gate over the right one.
  it('NEVER passes --legacy, which would build a tree nobody deploys', () => {
    expect(deployArgs('@fleet/api', 'out')).not.toContain('--legacy');
  });
});

describe('every deployArgs flag appears in the Dockerfile that ships it', () => {
  // The assertion that makes the previous two durable: read the real file
  // rather than trusting a transcription of it.
  for (const pkg of SHIPPED_PACKAGES) {
    const file = DOCKERFILE_FOR[pkg] ?? '';
    it('matches ' + file + ' for ' + pkg, () => {
      const text = dockerfile(file);
      const flags = deployArgs(pkg, 'OUT').filter((a) => a.startsWith('--'));
      for (const flag of flags) {
        expect([flag, text.includes(flag)]).toEqual([flag, true]);
      }
    });
  }

  // Vacuity: a planner emitting no flags would satisfy the loop above
  // trivially, and a deploy without --prod would ship devDependencies.
  it('emits several flags, so the loop above cannot pass vacuously', () => {
    const flags = deployArgs('@fleet/api', 'out').filter((a) => a.startsWith('--'));
    expect(flags.length).toBeGreaterThanOrEqual(4);
  });

  // The DIRECTORY is ours, not the Dockerfile's: the image writes to
  // /tmp/api-deploy inside the build stage, while this gate writes to a
  // temporary directory it owns. Only the FLAGS have to agree.
  it('puts the output directory last, where pnpm expects it', () => {
    const args = deployArgs('@fleet/api', 'OUTDIR');
    expect(args[args.length - 1]).toBe('OUTDIR');
  });

  it('names a Dockerfile for every shipped package', () => {
    for (const pkg of SHIPPED_PACKAGES) {
      expect([pkg, DOCKERFILE_FOR[pkg] !== undefined]).toEqual([pkg, true]);
    }
  });
});
