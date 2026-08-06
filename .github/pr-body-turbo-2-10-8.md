## What

Bumps the repo-wide turbo devDependency 2.10.7 -> 2.10.8 via the registered
//#bump:turbo task, and adds a guard that makes the pin non-regressable.

## Why 2.10.8

Upstream fixes pnpm pruning dropping ROOT and ALIASED dependencies during
turbo prune -- the exact path Dockerfile.api relies on to build a slim image.
Also improves JIT input matching for affected-task selection.

## Root cause closed (not a version-bump treadmill)

//#bump:turbo captured the ACT of bumping; planTurboBump is unit-tested for its
pure logic. Nothing asserted the RESULT. A hand-edit, a bad merge resolution or
a revert could move the pin BACKWARDS and no gate would notice. This adds
scripts/turbo-version-floor.guard.test.ts: pin present, parseable semver, never
below the floor, range operator preserved.

## Gate-placement defect found and avoided

The guard was first written to test/turbo-version-floor-contract.test.ts. That
directory is executed by NO registered task: the root script test:scripts is
vitest run scripts, //#test:scripts wraps it verbatim, and ci.yml runs the same
script. Empirically confirmed -- turbo run test:scripts reported 34 files, all
under scripts/. The guard was relocated to scripts/ (matching the sibling
ci-fast-covers-test-scripts.guard.test.ts, whose header states the principle:
the gate it protects is the same suite that runs it). Verified after the move:
34 -> 35 files, 439 -> 443 tests.

FOLLOW-UP (separate arc, deliberately NOT in this PR): five pre-existing root
contract tests in test/ are gated by nothing -- coverage-thresholds-contract,
ci-reporters, mutation-ci, release-automation-contract. Wiring them in requires
first proving them green, which is its own RED-GREEN arc.

## Verification (all on 2.10.8)

- RED first: floor guard failed with turbo pinned at 2.10.7, below the floor
  2.10.8 -- then GREEN after the bump
- Cold build --force --concurrency=1: 9/9 successful
- Warm build: 9/9 FULL TURBO, hashes IDENTICAL to the cold run (no cache-key
  schema regression)
- lint + typecheck: 29/29
- test:unit + test:scripts: 18/18 (api alone 233 files / 1511 tests)
- lint:scripts + test:scripts after the guard landed: 2/2, zero lint problems
- Pre-push hooks: build verification + 90/90/90/90 coverage merge gate passed

## Notes

pnpm-workspace.yaml is included deliberately: the install added seven
minimumReleaseAgeExclude entries for the 2.10.8 platform packages. Omitting it
would leave every other worktree reporting a deps DRIFT against this lockfile.

The guard uses a labelled-object assertion rather than the 2-arg
expect(value, message) form, which this repo forbids via vitest/valid-expect.
