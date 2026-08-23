// scripts/audit-artifact-cli.ts
// Driver for //#audit:artifact -- build each shipped deploy tree, audit it, and
// report a verdict that fails closed.
//
// WHY THIS EXISTS. ci.yml gates merges on `pnpm audit --prod` over the
// WORKSPACE graph, which is not what ships: pnpm materialises optional peers
// regardless, so apps/api carries metro and the Expo SDK through a drizzle-orm
// optional peer it never imports, while Dockerfile.api prunes exactly that
// subtree with --no-optional. Seven of the last ten commits to
// pnpm-workspace.yaml are floor raises for advisories that reach no image.
//
// This builds the tree the Dockerfile builds and audits THAT. Every decision
// lives in audit-artifact.ts, which is pure and unit-tested; this file learns
// facts and prints them.
//
// POSITIVE CONTROLS, not optional. An audit of an empty directory reports no
// vulnerabilities, and that reads exactly like success -- so the package count
// is carried into the verdict and an implausibly small tree is UNVERIFIABLE
// rather than clean. The same confident-zero refusal estate:verify applies to a
// worktree list with no records.
//
// NO DEFENSIVE ?? ON CAPTURED OUTPUT. spawnSync with encoding:'utf8' types
// stdout and stderr as string, never null, so a nullish fallback is dead code
// -- and guarding a state the types make unrepresentable is the redundant-check
// anti-pattern this repo names elsewhere. The lint caught it, as it did twice
// earlier in this same session.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ARTIFACT_EXIT,
  SHIPPED_PACKAGES,
  artifactVerdict,
  auditArgs,
  deployArgs,
  describeArtifact,
  type ArtifactOutcome,
} from './audit-artifact.js';

const NL = String.fromCharCode(10);

/** How many dependency directories a deploy tree contains.
 *
 *  Counts node_modules/.pnpm entries, which is where pnpm materialises the
 *  actual packages -- the top-level node_modules holds only symlinks, so
 *  counting it would report a plausible number for a tree with nothing real
 *  in it. Returns 0 when the directory is absent, which the verdict treats as
 *  unverifiable rather than clean.
 *
 *  EXPORTED and pure over a path so the fallback shape is testable; the caller
 *  supplies the directory. */
export function countPackages(treeDir: string): number {
  const store = join(treeDir, 'node_modules', '.pnpm');
  if (!existsSync(store)) return 0;
  try {
    return readdirSync(store).length;
  } catch {
    return 0;
  }
}

/* v8 ignore start -- side-effecting driver; every decision above and in
   audit-artifact.ts is unit-tested */
function out(s: string): void {
  process.stdout.write('[audit:artifact] ' + s + NL);
}
function errline(s: string): void {
  process.stderr.write('[audit:artifact] ' + s + NL);
}

/** Build and audit ONE shipped package. Never throws: a failure becomes an
 *  outcome the verdict can reason about, because an exception here would exit
 *  with a stack trace and no report -- and a gate that crashes tells a caller
 *  nothing about the artifact. */
function auditOne(pkg: string, root: string): ArtifactOutcome {
  const dir = join(root, pkg.replace(/[^a-z0-9]+/gi, '-'));
  const deploy = spawnSync('pnpm', [...deployArgs(pkg, dir)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const built = deploy.error === undefined && deploy.status === 0 && existsSync(dir);
  if (!built) {
    // The deploy output is the only diagnosis available, and a gate that
    // refuses without saying why is a stall.
    errline(pkg + ': deploy failed' + NL + deploy.stderr.trim());
    return { pkg, built: false, packageCount: 0, auditStatus: null };
  }
  const packageCount = countPackages(dir);
  const audit = spawnSync('pnpm', [...auditArgs()], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // A spawn ERROR means the audit never ran; a non-zero STATUS means it ran and
  // found something. Collapsing the two is the conflation gate-coverage.ts
  // needed fixing for, so null is reserved for "did not run".
  const auditStatus = audit.error !== undefined ? null : audit.status;
  if (auditStatus !== null && auditStatus !== 0) {
    process.stderr.write(audit.stdout + NL);
  }
  return { pkg, built, packageCount, auditStatus };
}

function mainAuditArtifact(): number {
  const root = mkdtempSync(join(tmpdir(), 'fleet-artifact-audit-'));
  try {
    out('auditing what SHIPS: ' + SHIPPED_PACKAGES.join(', '));
    const outcomes = SHIPPED_PACKAGES.map((pkg) => auditOne(pkg, root));
    for (const o of outcomes) out(describeArtifact(o));
    const verdict = artifactVerdict(outcomes);
    if (verdict === ARTIFACT_EXIT.ok) {
      out('every shipped artifact is clean at --audit-level=high.');
    } else if (verdict === ARTIFACT_EXIT.vulnerable) {
      errline('BLOCKED: an advisory reaches production. This one cannot be');
      errline('deferred to auditConfig.ignoreGhsas -- it is in a shipped image.');
    } else {
      errline('CANNOT VERIFY: an artifact was not built, or was empty.');
      errline('A tree with nothing in it audits clean, so this is NOT a pass.');
    }
    return verdict;
  } finally {
    // The tree carries a full node_modules; leaving it behind fills the
    // runner's disk across a matrix.
    rmSync(root, { recursive: true, force: true });
  }
}

const isMain = process.argv[1]?.endsWith('audit-artifact-cli.ts') ?? false;
if (isMain) {
  process.exit(mainAuditArtifact());
}
/* v8 ignore stop */
