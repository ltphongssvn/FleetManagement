# Stale ground truth in a 50-worktree fleet

Lesson from the T38 table-first dispatch board arc (PR #414) and its repair.

## What happened

PR #414 made the dispatch board table-first and moved the create form behind a drawer. It preserved
the create CONTRACT byte-for-byte and broke the create SELECTOR contract, so the whole E2E gate went
red on develop and promote to Railway stopped for every terminal.

T38 then set out to repair its own regression. It read origin/develop once, established the failure
precisely, and over roughly two hours designed and built a complete roll-forward slice: a RED
selector-parity spec, id and test-id restoration at source, a keep-the-drawer-open change, a new e2e
helper, and a mechanical rewrite of 21 call sites across 16 Playwright specs.

Every piece of it was discarded. While that work was being written, the terminal
t49-wt1-e2e-create-drawer shipped a better fix to develop: readiness moved off the create form onto
the board root, the success banner became a persistent WCAG 4.1.3 live region owned by the board,
the hand-rolled overlay became a Headless UI Dialog, and all of it was pinned by a fast no-browser
guard in the PR gate.

The rename to create-order-form was the single worst part: that is the exact test id the new guard
RETIRES by name. The repair would have failed the gate it was written to satisfy.

## The mechanism

origin/develop moved by 94, then 18, then 19, then 43 commits inside one session. A read of
origin/develop is a snapshot with a shelf life measured in minutes, not a fact that stays true for
the length of a work session. The longer the slice, the more certainly it is being built against
history.

The contention is worst exactly where it hurts most. A regression that blocks the fleet promote is,
by construction, the thing every terminal can see and the thing someone is most likely already
fixing. Urgency and collision probability rise together.

## Rules this changes

1. Re-read origin/develop immediately before WRITING code, not merely before planning it. Grounding
   a plan and grounding an edit are two separate reads.

2. Before designing any repair of a shared surface, check whether another terminal already owns it.
   The census from sync:worktrees names every live branch; a slug matching the broken surface means
   stop and read their work first. gh pr list over the affected paths answers the same question for
   branches already in review.

3. Treat a fleet-blocking regression as high-contention by default. The correct first move is to
   look for the fix in flight, not to start one.

4. A new shared helper is a claim that none exists. Search e2e/helpers and the scripts guards before
   adding one. This session created a duplicate helper while develop already shipped the canonical
   version.

5. When ground truth and local work disagree, origin/develop wins and the local slice is dropped
   without ceremony. Sunk design effort is not evidence.

## What worked

The registered ops made the recovery cheap and unambiguous. sync:develop refused a dirty tree and
later surfaced exactly one conflicted file, which held the evidence that develop had the better
design. pr:follow correctly reported #414 stalled at develop-gates, because that merge SHA never
earned a green E2E. inspect:prod-deploy then proved the feature shipped anyway under the repair
commit, verdict EFFECTIVE. worktree:close removed the worktree only after confirming nothing could
be lost.

Discarding a slice took three commands and left no residue. That is the payoff for keeping every
operation a captured task instead of a hand-rolled CLI.
