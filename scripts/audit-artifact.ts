// scripts/audit-artifact.ts
// AUDIT WHAT SHIPS, not the whole workspace graph.
//
// THE TREADMILL THIS ENDS. ci.yml gates merges on
//   pnpm audit --audit-level=high --prod
// run against the WORKSPACE. That tree is not what ships. pnpm materialises
// optional peers regardless (pnpm#11155), so apps/api pulls
//   drizzle-orm -> expo-sqlite -> expo -> metro -> image-size
// even though apps/api declares no Expo dependency and never imports
// expo-sqlite. Dockerfile.api builds with
//   pnpm --filter=@fleet/api deploy --prod --no-optional
//     --config.inject-workspace-packages=true
// which prunes that entire subtree.
//
// So advisories against packages that CANNOT REACH PRODUCTION block every
// branch in the repo. pnpm-workspace.yaml records the cost in its own comments:
// "Seven of the last ten commits to this file are floor raises for advisories
// that never ship." Each one is an override or an ignoreGhsas entry written,
// reviewed and merged for a package absent from every image -- and each entry
// crowds the allowlist a little more, which is how a real finding eventually
// slips past unread.
//
// Two attempted fixes are recorded there and both failed by construction. A
// convergence override on image-size is inert (metro declares ^1.0.2; an exact
// 2.0.3 never satisfies it), and a bounded floor would drag metro across a
// major -- the exact failure the js-yaml comment records, where an unbounded
// floor pulled cosmiconfig into 5.x and imported a NEW advisory. The problem
// was never the override syntax. It was auditing the wrong tree.
//
// THIS IS A VEX-STYLE EXPLOITABILITY STATEMENT, which is 2026 practice: gate on
// what ships. The claim is verifiable rather than asserted -- build the deploy
// tree the Dockerfile builds, and audit THAT.
//
// NOT A WEAKENING. The full-tree audit still runs and still reports; it simply
// stops BLOCKING for packages that are not in any image. A dev-only advisory is
// real and gets fixed on its own cadence, which is exactly what ci.yml's second
// audit step already says in its own comment.
//
// POSITIVE CONTROLS ARE MANDATORY, and that is the part a naive version gets
// wrong. An empty or broken deploy tree audits clean, and "no vulnerabilities"
// from a tree containing nothing is the confident zero this repo refuses
// everywhere. The verdict below therefore REQUIRES evidence that the artifact
// was actually built before it will accept a pass.

/** The packages that ship as their own image, each built with `pnpm deploy`.
 *
 *  DERIVED FROM THE DOCKERFILES, not from intuition: Dockerfile.api and
 *  Dockerfile.worker each run `pnpm --filter=<pkg> deploy --prod --no-optional`.
 *  ops-web is deliberately ABSENT -- it ships a Next.js standalone bundle
 *  (module-traced, not a pnpm tree), so a deploy-tree audit would be auditing
 *  something it does not ship. Auditing it here would be worse than not
 *  auditing it: a pass would name a tree nobody deploys. */
export const SHIPPED_PACKAGES: readonly string[] = Object.freeze([
  '@fleet/api',
  '@fleet/main-worker',
]);

/** Build one package's deploy tree, exactly as its Dockerfile does.
 *
 *  --prod drops devDependencies; --no-optional drops the optional peers that
 *  put metro and the Expo SDK in the workspace graph.
 *
 *  --config.inject-workspace-packages=true is REQUIRED and is copied from the
 *  Dockerfiles rather than chosen here. pnpm 10+ refuses a deploy from a
 *  workspace without it -- ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE -- and offers
 *  --legacy as the alternative. Taking the --legacy path would build a
 *  DIFFERENT tree from the one that ships, which is precisely the fiction this
 *  task exists to eliminate: an audit of a tree nobody deploys proves nothing.
 *  Every flag here matches Dockerfile.api and Dockerfile.worker exactly. */
export function deployArgs(pkg: string, outDir: string): readonly string[] {
  return [
    '--filter=' + pkg,
    'deploy',
    '--prod',
    '--no-optional',
    '--config.inject-workspace-packages=true',
    outDir,
  ];
}

/** Audit a built deploy tree.
 *
 *  No --prod: the tree ALREADY contains only production dependencies, so the
 *  flag would be redundant, and passing it would hide the fact that the
 *  pruning is the deploy step's job rather than the audit's. */
export function auditArgs(): readonly string[] {
  return ['audit', '--audit-level=high'];
}

/** What happened for one shipped package. */
export interface ArtifactOutcome {
  readonly pkg: string;
  /** Did `pnpm deploy` produce a tree at all? */
  readonly built: boolean;
  /** How many dependency directories the tree contains. A POSITIVE CONTROL:
   *  zero means the probe is broken, not that the artifact is clean. */
  readonly packageCount: number;
  /** The audit's exit code, or null when the audit never ran. */
  readonly auditStatus: number | null;
}

export const ARTIFACT_EXIT = {
  ok: 0,
  /** A real advisory against something that actually ships. */
  vulnerable: 1,
  /** The artifact could not be built or was empty -- the probe is broken, and a
   *  broken probe must never read as a clean bill of health. */
  unverifiable: 3,
} as const;

/** The smallest tree that can plausibly be a deployed service. Chosen well
 *  below any real count (@fleet/api resolves hundreds) purely to catch the
 *  degenerate case where deploy succeeds and produces nothing. */
export const MIN_PLAUSIBLE_PACKAGES = 10;

/** The verdict over every shipped artifact.
 *
 *  FAILS CLOSED, and the ordering matters: unverifiable DOMINATES vulnerable.
 *  A run that could not build its artifacts cannot honestly report either a
 *  pass or a specific finding -- reporting "vulnerable" from a tree that was
 *  never built would send the operator to fix a package that may not even be
 *  present.
 *
 *  An EMPTY outcome list is unverifiable too, never ok: a loop that ran zero
 *  times is the confident zero this repo refuses -- the same shape as
 *  `git worktree list` yielding no records, or a coverage gate whose child
 *  never started. */
export function artifactVerdict(outcomes: readonly ArtifactOutcome[]): number {
  if (outcomes.length === 0) return ARTIFACT_EXIT.unverifiable;
  const unverifiable = outcomes.some(
    (o) => !o.built
      || o.packageCount < MIN_PLAUSIBLE_PACKAGES
      || o.auditStatus === null,
  );
  if (unverifiable) return ARTIFACT_EXIT.unverifiable;
  return outcomes.some((o) => o.auditStatus !== 0)
    ? ARTIFACT_EXIT.vulnerable
    : ARTIFACT_EXIT.ok;
}

/** The operator line. Names the package and the reason, because "the artifact
 *  audit failed" is not actionable and this gate blocks merges. */
export function describeArtifact(o: ArtifactOutcome): string {
  if (!o.built) return o.pkg + ': NOT BUILT -- pnpm deploy produced no tree';
  if (o.packageCount < MIN_PLAUSIBLE_PACKAGES) {
    return o.pkg + ': EMPTY TREE (' + String(o.packageCount)
      + ' packages) -- the probe is broken, not the artifact clean';
  }
  if (o.auditStatus === null) return o.pkg + ': AUDIT DID NOT RUN';
  return o.auditStatus === 0
    ? o.pkg + ': clean (' + String(o.packageCount) + ' shipped packages)'
    : o.pkg + ': ADVISORY against a SHIPPED package -- this one must be fixed';
}
