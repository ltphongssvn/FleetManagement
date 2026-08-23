// scripts/dockerfile-deploy-mode.test.ts
// Regression guard (production outage, 2026-08-05): every Dockerfile that runs
// pnpm deploy must INJECT workspace packages, never link them.
//
// THE OUTAGE. api and worker crash-looped on Railway with
//   ERR_MODULE_NOT_FOUND: Cannot find package '@fleet/observability'
//   ERR_MODULE_NOT_FOUND: Cannot find package '@fleet/sync-protocol'
// pnpm deploy in LEGACY mode writes symlinks back into the build tree. They
// resolve inside the builder, which is why the deploy directory looks correct
// there, but each runtime stage is a fresh node:22-alpine that copies only
// /tmp/*-deploy, so /repo does not exist and every @fleet/* link dangles.
// Injected deploy writes hardlinks plus a localized virtual store, which
// survive COPY --from. Measured: 0 of 2059 links escaping, 40MB smaller.
//
// WHY A GUARD AND NOT JUST THE FIX. The first fix corrected only the shared
// root Dockerfile -- the one compose builds -- so main-e2e went green while
// production stayed broken. Railway CANNOT use multi-stage targets, so it
// builds per-service Dockerfile.* wrappers instead, and nothing in the repo
// knew those files existed. This guard DISCOVERS root Dockerfiles rather than
// listing them, so a wrapper added tomorrow is covered without anyone
// remembering to update a list.
//
// CODE-ONLY VIEW (pg-global-setup-no-reuse-orphan-guard.test.ts precedent):
// drop comment lines so an assertion about INSTRUCTIONS is never tripped by
// prose that merely mentions a flag -- including this file's own header. The
// first draft matched the word "deploy" inside Dockerfile.ops-web's comments
// and flagged a correct file. A guard that cries wolf gets ignored, so the
// comment strip is load-bearing, not tidiness. Dockerfiles comment with HASH,
// not the double slash the TypeScript guards strip.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const NL = String.fromCharCode(10);
const HASH = String.fromCharCode(35);
const repoRoot = new URL('..', import.meta.url).pathname;
const isCommentLine = (line: string): boolean => line.trimStart().startsWith(HASH);
const codeOnly = (src: string): string =>
  src
    .split(NL)
    .filter((line) => !isCommentLine(line))
    .join(NL);
/** Root Dockerfiles, DISCOVERED. A hardcoded list is exactly what let
 *  Dockerfile.api and Dockerfile.worker stay broken while "the Dockerfile" was
 *  fixed. */
function rootDockerfiles(): readonly string[] {
  return readdirSync(repoRoot)
    .filter((f) => f === 'Dockerfile' || f.startsWith('Dockerfile.'))
    .sort();
}
const codeOf = (name: string): string => codeOnly(readFileSync(repoRoot + name, 'utf8'));
/** True only when the file actually RUNS a pnpm deploy, comments excluded. */
const runsPnpmDeploy = (name: string): boolean => {
  const code = codeOf(name);
  return code.includes('pnpm ') && code.includes(' deploy ');
};
describe('Dockerfile deploy mode (production outage guard)', () => {
  it('finds root Dockerfiles to scan (guard is not vacuously green)', () => {
    expect(rootDockerfiles().length).toBeGreaterThan(0);
  });
  it('discovers the per-service Railway wrappers, not just the compose Dockerfile', () => {
    const found = rootDockerfiles();
    expect(found).toContain('Dockerfile');
    expect(found).toContain('Dockerfile.api');
    expect(found).toContain('Dockerfile.worker');
  });
  it('at least one Dockerfile runs pnpm deploy (the rules below have a subject)', () => {
    expect(rootDockerfiles().filter(runsPnpmDeploy).length).toBeGreaterThan(0);
  });
  it('NO Dockerfile runs pnpm deploy in legacy mode', () => {
    const offenders = rootDockerfiles().filter((f) => codeOf(f).includes('--legacy'));
    expect(offenders).toEqual([]);
  });
  it('EVERY Dockerfile that runs pnpm deploy injects workspace packages', () => {
    const missing = rootDockerfiles()
      .filter(runsPnpmDeploy)
      .filter((f) => !codeOf(f).includes('inject-workspace-packages=true'));
    expect(missing).toEqual([]);
  });
  it('injection is scoped per-invocation, never a workspace-wide setting', () => {
    // A repo-wide inject-workspace-packages breaks catalog: resolution, which
    // this repo uses in apps/api and packages/observability.
    const unscoped = rootDockerfiles()
      .filter((f) => codeOf(f).includes('inject-workspace-packages'))
      .filter((f) => !codeOf(f).includes('--config.inject-workspace-packages=true'));
    expect(unscoped).toEqual([]);
  });
  it('each Railway wrapper builds workspace DEPENDENCIES, not just the leaf package', () => {
    // pnpm deploy copies packages as they exist on disk; it does not build
    // them. A turbo filter without the ... suffix can deploy a package whose
    // dist/ was never emitted.
    const bad = ['Dockerfile.api', 'Dockerfile.worker'].filter((f) => {
      const line = codeOf(f)
        .split(NL)
        .find((l) => l.includes('turbo run build'));
      return !line?.includes('...');
    });
    expect(bad).toEqual([]);
  });
  it('ops-web is correctly EXEMPT: Next standalone inlines its dependencies', () => {
    // Not an exception carved out to make the suite pass -- Dockerfile.ops-web
    // genuinely runs no pnpm deploy. Pinned so a future edit that adds one
    // cannot slip past the rules above unnoticed.
    expect(runsPnpmDeploy('Dockerfile.ops-web')).toBe(false);
  });
});
