# Retirement: feature/co-so-du-lieu (t4-wt6)

Status: RETIRED, not merged. Branch left intact on origin as immutable
history; no PR opened; no force-delete.

## Why retired (evidence-based)

This branch built a vehicle-only Phan cong nhanh (quick-assign) flow onto the
Co so du lieu drivers section. Verification against prod + git history showed
it was overtaken and now conflicts with shipped and locked work:

1. Built on a DEAD component. The quick-assign wiring (0b63587) and its
   coverage (23c19b4) target DriversSection, which a71158e (PR #352, Phase B,
   shipped in v2.42.2) superseded with DriversAdminSection. page.tsx renders
   DriversAdminSection; DriversSection appears only in a stale page.tsx
   comment and is rendered nowhere. So that work is orphan.

2. Pattern the design review disfavored. The adjudicated Cơ sở dữ liệu design
   (t26 Phase D) accepts an E1 44px ellipsis action-menu for row actions and
   explicitly rejected a modal/react-hook-form rewrite. QuickAssignModal is a
   dialog affordance, i.e. close to the rejected category, not the chosen one.

3. Direct overlap with locked, queued t26 steps:
   - t26 D1 (E1 + R-A11Y) redesigns DriversAdminSection row actions -- the exact
     renderAssignControls/renderOpsControls a port would have touched.
   - t26 D2 (E3 + D-MIN) drops the raw device UUID from the Thiet bi column --
     the same leak this branch would have fixed. Doing either here collides.

4. Most hardening already shipped independently. 936e47c (DataTable/rowAttrs)
   and d5add71 (ensureOk + boundary parse) are already on develop via Phase A
   (PR #375). Re-merging them is redundant.

## Salvageable artifacts (clean, non-conflicting; for t26 to adopt or drop)

Two files are unique to this branch and self-contained. They are NOT wired to
the dead DriversSection and carry no orphan coupling:

- packages/sync-protocol/src/quick-assign-contract.ts
    QuickAssignInputSchema { vehicleId: z.guid() } + parseQuickAssignInput.
    Vehicle-only by design (device enrollment removed, PR #302). 7 unit tests.
- apps/ops-web/src/features/admin/QuickAssignModal.tsx
    Native <dialog> quick-assign modal. Plate-labeled, uuid-valued options
    (honors no-raw-UUID-in-UI). Component-agnostic; not bound to DriversSection.
    10 unit tests, 100% coverage.

If t26 E1 wants a quick-assign affordance, lift these two files as-is. If E1
keeps assignment inline in the action-menu, drop them. They are on origin at
feature/co-so-du-lieu (tip c46767f) if needed later.

## Lesson

Root cause of the wasted arc: built before verifying which component page.tsx
actually renders, and before checking parallel-worktree ownership of the
surface. The fix is procedural -- for any UI change, first confirm the mounted
component (grep the page route) AND search parallel worktrees / locked design
for ownership of that surface, BEFORE writing code. sync:develop keeps the
base current but does not reveal a design-level supersession; that needs the
search-first + read-the-page step up front.
