// scripts/audit-artifact.test.ts
// The rules that decide whether a SHIPPED artifact is clean.
//
// The gate this replaces blocked merges on advisories against packages absent
// from every image. The gate that replaces it must not make the opposite
// mistake -- passing because it audited nothing. These tests pin the
// fail-closed ordering hardest, because a permissive bug here is invisible:
// it looks exactly like a clean repo.
import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_EXIT,
  MIN_PLAUSIBLE_PACKAGES,
  SHIPPED_PACKAGES,
  artifactVerdict,
  auditArgs,
  deployArgs,
  describeArtifact,
  type ArtifactOutcome,
} from './audit-artifact.js';

function clean(pkg: string): ArtifactOutcome {
  return { pkg, built: true, packageCount: 400, auditStatus: 0 };
}

describe('SHIPPED_PACKAGES is derived from the Dockerfiles', () => {
  // Dockerfile.api and Dockerfile.worker each run
  // `pnpm --filter=<pkg> deploy --prod --no-optional`.
  it('names exactly the two packages built with pnpm deploy', () => {
    expect([...SHIPPED_PACKAGES].sort()).toEqual(['@fleet/api', '@fleet/main-worker']);
  });

  // ops-web ships a Next.js STANDALONE bundle -- module-traced, not a pnpm
  // tree. Auditing a deploy tree for it would pass on something nobody
  // deploys, which is worse than not auditing it here at all.
  it('EXCLUDES ops-web, which ships a traced standalone bundle', () => {
    expect(SHIPPED_PACKAGES).not.toContain('@fleet/ops-web');
  });

  it('is frozen, so the shipped set cannot be widened at runtime', () => {
    expect(Object.isFrozen(SHIPPED_PACKAGES)).toBe(true);
  });
});

describe('deployArgs mirrors the Dockerfile exactly', () => {
  const args = deployArgs('@fleet/api', '/tmp/out');

  // An audit of a tree built differently from the image is an audit of a
  // fiction, so both flags are copied rather than chosen.
  it('passes --prod, dropping devDependencies', () => {
    expect(args).toContain('--prod');
  });

  // THE FLAG THAT MATTERS. Without it pnpm materialises optional peers and the
  // metro/Expo subtree reappears -- the exact tree this gate exists to stop
  // auditing.
  it('passes --no-optional, dropping the optional-peer subtree', () => {
    expect(args).toContain('--no-optional');
  });

  it('filters to the named package and writes to the given directory', () => {
    expect(args[0]).toBe('--filter=@fleet/api');
    expect(args).toContain('deploy');
    expect(args[args.length - 1]).toBe('/tmp/out');
  });
});

describe('auditArgs audits the built tree', () => {
  // The tree is ALREADY production-only, so --prod would be redundant -- and
  // passing it would imply the audit does the pruning, when the deploy step
  // does.
  it('does NOT pass --prod: the deploy step already pruned', () => {
    expect(auditArgs()).not.toContain('--prod');
  });

  it('gates at high severity, matching the workflow it replaces', () => {
    expect(auditArgs().join(' ')).toContain('--audit-level=high');
  });
});

describe('artifactVerdict: a real advisory blocks', () => {
  it('passes when every shipped artifact audits clean', () => {
    expect(artifactVerdict([clean('@fleet/api'), clean('@fleet/main-worker')]))
      .toBe(ARTIFACT_EXIT.ok);
  });

  // The whole point: an advisory against something that ACTUALLY SHIPS still
  // stops the merge. Narrowing the scope must not weaken the control.
  it('FAILS when a shipped artifact carries an advisory', () => {
    expect(artifactVerdict([
      clean('@fleet/api'),
      { pkg: '@fleet/main-worker', built: true, packageCount: 300, auditStatus: 1 },
    ])).toBe(ARTIFACT_EXIT.vulnerable);
  });
});

describe('artifactVerdict: a broken probe is never a clean bill of health', () => {
  // The confident zero, in its natural habitat. An audit of an empty directory
  // reports no vulnerabilities, and that reads exactly like success.
  it('is UNVERIFIABLE when the artifact was never built', () => {
    expect(artifactVerdict([
      { pkg: '@fleet/api', built: false, packageCount: 0, auditStatus: 0 },
    ])).toBe(ARTIFACT_EXIT.unverifiable);
  });

  it('is UNVERIFIABLE when the tree is implausibly small', () => {
    expect(artifactVerdict([
      { pkg: '@fleet/api', built: true, packageCount: 2, auditStatus: 0 },
    ])).toBe(ARTIFACT_EXIT.unverifiable);
  });

  it('is UNVERIFIABLE when the audit never ran', () => {
    expect(artifactVerdict([
      { pkg: '@fleet/api', built: true, packageCount: 400, auditStatus: null },
    ])).toBe(ARTIFACT_EXIT.unverifiable);
  });

  // A loop that ran zero times -- the same shape as `git worktree list`
  // yielding no records, or a coverage gate whose child never started.
  it('is UNVERIFIABLE for an EMPTY outcome list, never ok', () => {
    expect(artifactVerdict([])).toBe(ARTIFACT_EXIT.unverifiable);
  });

  // ORDERING. A run that could not build its artifacts cannot honestly report a
  // specific finding either: naming a vulnerable package from a tree that was
  // never built sends the operator to fix something possibly absent.
  it('UNVERIFIABLE dominates VULNERABLE when both are present', () => {
    expect(artifactVerdict([
      { pkg: '@fleet/api', built: false, packageCount: 0, auditStatus: null },
      { pkg: '@fleet/main-worker', built: true, packageCount: 300, auditStatus: 1 },
    ])).toBe(ARTIFACT_EXIT.unverifiable);
  });

  it('keeps every exit code distinct, so a caller can branch', () => {
    const codes = Object.values(ARTIFACT_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // The threshold is a sanity floor, not a measurement: a real deploy tree
  // resolves hundreds of packages.
  it('sets the plausibility floor well below any real deploy tree', () => {
    expect(MIN_PLAUSIBLE_PACKAGES).toBeGreaterThan(0);
    expect(MIN_PLAUSIBLE_PACKAGES).toBeLessThan(100);
  });
});

describe('describeArtifact names the package and the reason', () => {
  it('distinguishes an unbuilt artifact from a clean one', () => {
    expect(describeArtifact({ pkg: '@fleet/api', built: false, packageCount: 0, auditStatus: null }))
      .toContain('NOT BUILT');
  });

  // The message must say the PROBE is broken, not that the artifact passed --
  // that distinction is the entire fail-closed argument.
  it('says an empty tree means a broken probe, not a clean artifact', () => {
    const msg = describeArtifact({ pkg: '@fleet/api', built: true, packageCount: 1, auditStatus: 0 });
    expect(msg).toContain('EMPTY TREE');
    expect(msg).toContain('probe is broken');
  });

  it('reports a clean artifact with its package count as evidence', () => {
    expect(describeArtifact(clean('@fleet/api'))).toContain('400');
  });

  // A finding here is qualitatively different from a workspace-graph finding:
  // it reaches production, so it cannot be deferred to an ignoreGhsas entry.
  it('marks a real finding as SHIPPED, so it cannot be deferred', () => {
    expect(describeArtifact({ pkg: '@fleet/api', built: true, packageCount: 400, auditStatus: 1 }))
      .toContain('SHIPPED');
  });
});
