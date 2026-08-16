# gh pr merge --auto is the wrong instrument in this repo

## What happened

PR #572 sat 60 minutes at `pr-merged` with `autoMergeRequest: null`. Diagnosing
that as "automerge was never enabled", I reached for `gh pr merge --auto` on the
next PR. Right symptom, wrong fix.

## Why --auto does not work here

GitHub's native auto-merge is unreliable when required checks come from
repository **rulesets** rather than classic branch protection. It enables,
checks go green, and the merge never fires. This repo gates `develop` and `main`
with rulesets (`develop-protection`, `main-protection`), so `--auto` reproduces
the exact stall it appears to fix — and does so silently, which is worse than
never arming it. Community issue 162623, still open in 2026.

This is already documented in the `//#pr:automerge` task description. The task
was written for precisely this reason (`f0ba074`, PR #434), and I reached past
it for the raw CLI anyway.

## The sanctioned instrument

    pnpm exec turbo run pr:automerge --concurrency=1 -- <prNumber>

A synchronous poll-then-merge, not a flag handed to GitHub:

- polls `mergeStateStatus` plus check state
- when checks are green but the branch is BEHIND, runs `gh pr update-branch` and
  re-polls, rather than stalling (`450fdd5`)
- merges with `gh pr merge --merge` — a true merge commit, NEVER
  `--squash`/`--rebase`, because preserving original commit SHAs keeps the
  promote pipeline's SHA-ancestry checks reliable (`f568304`)
- acts only on the PR base (feature → develop), never develop → main, so it
  cannot race promote.yml

Observed on PR #586: ENABLE, two WAIT polls, MERGE — 68 seconds end to end,
then `pr:follow` carried it through all seven stages to Railway.

## Rule

Never `gh pr merge --auto` in this repo. A PR that merged after `--auto` was set
is not evidence the flag worked; it is evidence the checks were green anyway.

The general lesson is one this repo keeps relearning: when a registered task
exists for an operation, the raw CLI equivalent is not a shortcut to it. It is a
different operation that happens to share a name, and the task exists precisely
because the raw form failed once already.

## Related

- `scripts/pr-automerge.ts`, `//#pr:automerge` in `turbo.jsonc`
- `//#pr:follow` remains the release DoD gate; automerge only lands the PR
