# Twelve-factor audit (T20)

Arc: feature/twelve-factor-audit -> PR #430 -> v2.51.0 -> Railway.
Verdict EFFECTIVE via inspect:prod-deploy. Nine factors audited clean;
three violated and fixed; one finding deferred to its owning terminal.

## Factor IX -- Disposability: the hook nobody called

The app had every graceful-shutdown behavior correctly written --
DB pool close, outbox relay drain, CommandsGateway in-flight push
await -- all wired to onModuleDestroy. None of them ever ran, because
Nest only invokes that hook when enableShutdownHooks() is called, and
it never was.

The lesson is about the shape of the bug, not the missing line. This
class of defect is invisible to unit tests (each handler tests fine in
isolation), invisible in code review (the handlers look complete), and
invisible in dev (nobody SIGTERMs a dev server and checks the pool).
It only manifests on a platform that restarts the process -- which
Railway does on every single deploy. Correct-looking code wired to a
lifecycle nobody activated is worse than absent code: absent code gets
noticed.

The guard is the test, not the fix: assert the WIRING call itself
(enableShutdownHooks called exactly once), because the fix is one line
and one line is exactly what a future refactor silently drops.

Shutdown was also made BOUNDED. A graceful path that can hang forever
is not graceful -- it just moves the failure from lost work to a stuck
container the platform cannot replace. app.close() races a
SHUTDOWN_DEADLINE_MS deadline and exits non-zero on timeout.

## Factor III -- Config: silent defaults are the anti-pattern

Seven ops-web BFF routes each carried their own
process.env FLEET_API_URL fallback to http://api:3000 -- a Docker
Compose service name, unresolvable on Railway. A missing env var in
production therefore produced a DNS failure per request, surfaced to
the dispatcher as a generic load error, with nothing in the logs naming
the actual cause.

The defect is the SILENCE, not the duplication. Consolidating seven
copies of a wrong default into one copy of a wrong default fixes
nothing. The fix is fail-fast: throw in production, keep the compose
default only outside it -- the contract load-board, load-board-page and
load-order-review already enforced. A deploy-varying value that has a
plausible-looking default is more dangerous than one with none, because
the default lets a misconfigured deploy boot and fail later, far from
the cause.

## Factor XI -- Logs: unstructured output is unqueryable

main-worker wrote console text. Once shipped to an aggregator, text is
not searchable by field, so an operator cannot ask which job failed for
which manifest. Now a structured JSON event stream on stdout -- the
process writes events, the platform owns routing and retention.

## Process lessons (these cost more time than the fixes)

### A test that passes on first run is not RED

The forwarder fail-fast spec passed all four cases immediately. The
instinct is to accept it and move on. That instinct is wrong: a test
that has never failed has proven nothing about whether it CAN fail.

The cause here was real and would have been missed: the branch already
contained the fix. The merge with develop had kept src/lib/api-url.ts
and the _forward.ts import of it, so the guard was live before the test
existed. The finding was already remediated and mislabelled as open.

Resolution is mutation, not assertion-counting: revert the subject to
the develop version, confirm 3 of 4 cases fail, restore, confirm 4 of 4
pass. Only then is it a regression pin with teeth. Commit the fact that
it passed first-run and why -- otherwise the next reader assumes RED.

### origin/develop is ground truth; a stale branch invents conflicts

This branch sat 346 commits behind. Every conflict it produced was
avoidable. Worse, the resolutions were nearly WRONG in a way that would
have passed review: develop had promoted the reference forwarder to an
app-wide _forward.ts with mint-on-miss refresh, superseding this
branch per-route de-duplication entirely.

Resolving by memory would have reinstated seven dead routes. Resolving
by reading origin/develop showed the correct move was to TAKE DEVELOP
for the routes and keep only the host seam. A branch conflict is a
question about which design won, and only the remote can answer it.

Also: develop advanced 10 commits DURING the conflict resolution, and
80 more before the PR. In a 50-worktree environment the target moves
while you aim. Re-sync immediately before every gate and every push.

### A green gate is not a shipped change

The promote workflow reported success while skipping steps 5-7: its
gate found develop E2E red, set ready=false, and exited 0 by design.
Reading only the job conclusion would have concluded promotion
happened. It had not -- main sat 34 commits behind.

A workflow that exits 0 after doing nothing is correct behavior and a
reporting trap. Verify the EFFECT (is the commit in main, is it live),
never the exit code. pr:follow and inspect:prod-deploy exist for
exactly this and both are non-zero-on-failure, so they gate scripts
rather than merely printing.

### Cross-worktree ownership

The develop E2E failure (18 specs) was NOT this branch to fix. Root
cause was T38 cf887ab putting the create form behind a createOpen
drawer; the specs assert it on load. Two terminals already held live
uncommitted work on those exact files. Finding #423 already claimed
meant leaving it alone -- touching it would have produced a three-way
collision on 18 shared files.

Finding III-4 (E2E_API_CONTAINER unset in the T16 runner child) was
deferred to T16 for the same reason. An audit that fixes everything it
finds, regardless of ownership, is a merge-conflict generator.

## Deferred

- III-4: E2E_API_CONTAINER unset in the T16 runner child process (T16)
