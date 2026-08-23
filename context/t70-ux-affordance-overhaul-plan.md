<!-- context/t70-ux-affordance-overhaul-plan.md -->

# T70 - UX affordance overhaul: arc plan and defect ledger

Worktree: t70-wt1-ux-affordance-overhaul Branch: feature/ux-affordance-overhaul (cut off
origin/develop @ 2d96450) Ground truth for every claim below: origin/develop, read via git show, not
the local worktree and not memory (50+ concurrent worktrees push continuously).

---

## 1. The complaint, restated as an engineering problem

Dispatchers (ops-web), drivers (driver-app) and the owner (owner-app) report that they do not know
how to use the software, that the GUI is hard to use, and that functions are not prominent.
Restated: the interface does not carry its own affordances. A user must already know what is
clickable, what a symbol means, and what to do next, because the UI does not say so. The target
state is that a first-time user completes a daily job with zero training.

## 2. Recon evidence gathered (all from origin/develop)

- apps/ops-web/src/features/dispatch/DispatchView.tsx - 479 lines, board + toolbar
- apps/ops-web/src/features/dispatch/board-stops.tsx - 230 lines, per-stop cells
- apps/ops-web/src/features/dispatch/NaturalLanguageCreateForm.tsx - 154 lines
- apps/ops-web/src/features/shell/AppShell.tsx - 49 lines, nav shell
- apps/ops-web/src/app/page.tsx - 81 lines, board RSC
- apps/ops-web/src/lib/i18n.ts - 115 lines, VI/EN dictionary, largely UNUSED by the dispatch
  surfaces (they hardcode Vietnamese strings inline)
- packages/design-tokens/src/semantic.ts - 41 semantic roles, already the SSOT
- git grep for Tooltip / onboard / EmptyState / aria-describedby / title= across apps/ops-web/src
  returns exactly ONE hit (board-stops.tsx:144 title=). There is no help primitive, no empty-state
  primitive, no tooltip primitive in the app.

## 3. 2026 industry grounding (live web search, before any design decision)

- WCAG 2.2 is the working standard in 2026; audits reference it. New AA criteria that bite here:
  2.4.11 Focus Not Obscured, 2.5.7 Dragging Movements, 2.5.8 Target Size Minimum (24x24 CSS px, or
  24px spacing offset). New Level A: 3.2.6 Consistent Help (a help mechanism must sit in the same
  relative position on every page that has one) and 3.3.7 Redundant Entry (never ask twice; offer
  the prior value).
- 3.3.2 Labels or Instructions: placeholder text alone does NOT satisfy the label requirement,
  because it disappears on first keystroke. Every combobox in the create drawer is currently
  placeholder-only.
- 3.3.1 Error Identification: colour alone is not an error indicator; the error must be described in
  text.
- Affordance practice (UXPin, 2026): reserve hidden affordances for secondary or power-user actions,
  never for a critical task or a primary navigation path. Pattern affordances - buttons that look
  like buttons, links that look like links, disabled states that read as constrained - reduce
  learning time to near zero. Weak or inconsistent affordances are the specific failure mode of
  hand-generated UI.
- Enterprise UX 2026: the classic failure is an internal fleet dashboard that is engineered rather
  than designed - screens of data tables with no hierarchy, and a workflow needing twelve clicks
  where the old spreadsheet needed two - so staff quietly revert to Excel. Density is acceptable;
  absent hierarchy is not.

## 4. Defect ledger

Each defect has a stable ID. Slices reference these IDs; the DoD is that every in-scope ID is closed
by a test, not by inspection.

### 4.1 Dispatch board - apps/ops-web (screenshot 1)

- UX-01 No help affordance anywhere in the product. WCAG 3.2.6 unmet by absence.
- UX-02 Toolbar has no hierarchy: search box, three filter pills, the primary Tao lenh dieu xe
  button, Xuat Excel and a date range all carry equal visual weight and wrap unpredictably, so the
  page title itself breaks around the search input. The primary action is not prominent.
- UX-03 The em-dash is overloaded. It means no weight data, no stop in that slot, not applicable,
  and incomplete reconciliation - four meanings, one glyph, no legend. The Chenh lech column shows
  it on every row.
- UX-04 A stop cell mixes an artifact (the Phieu Can link plus a bare kg number) with a status (Chua
  toi) with no label distinguishing them.
- UX-06 The empty board renders a dead-end sentence, Chua co lenh dieu xe nao, with no call to
  action to create the first one.
- UX-07 The filter pills are anchors inside role=tablist using aria-current=page. That is not the
  tab pattern; keyboard and screen-reader users get a mismatched model.
- UX-08 Den trang accepts a page number but submits only on Enter. The contract is invisible - no
  button, no hint.
- UX-09 The board search likewise submits only on Enter, with no submit control and no hint that
  Enter is required.
- UX-10 Only the So lenh cell is a link. The rest of the row has no hover or focus feedback, so
  users do not discover that rows lead anywhere.
- UX-11 Target size: the filter pills at px-3 py-1 text-sm and the inline Nhap KL text button at
  text-xs are below the 24x24 CSS px floor. WCAG 2.5.8 fail.

### 4.2 Create drawer - apps/ops-web (screenshot 2)

- UX-12 Eight comboboxes are placeholder-only (Chon so xe, Chon tai xe, ...). Placeholder-as-label
  fails WCAG 3.3.2 and leaves an empty sentence with no indication of what is required.
- UX-13 The drawer panel is transparent with the close control floating above it, so the form has no
  clear boundary against the dimmed board behind it.
- UX-14 No required-field marking, no progress or grouping, no review step. Errors appear only after
  submit, below the sentence, far from the field.
- UX-16 The mad-libs sentence wraps across lines, so the visual order and the tab order diverge;
  focus styling is browser default.

### 4.3 Order detail - apps/ops-web (screenshot 3)

- UX-17 Trang thai renders the raw machine state, started, in English, to a Vietnamese dispatcher. A
  state vocabulary already exists in @fleet/domain (ROAD_RUN_STATES, ROAD_RUN_STATE_TONE) but no
  Vietnamese label map is bound.
- UX-18 The cannot-cancel explanation renders as an unstyled full-width bar at the very bottom,
  detached from the action it explains; it reads as a footer.
- UX-19 The page offers no visible primary action, so a user cannot tell what this screen is for.

### 4.4 Co so du lieu - apps/ops-web (attached PDF)

- UX-20 Eight stacked paginated tables (Can xu ly, Tai xe, Thiet bi, Khach hang, Ten hang, So xe,
  Kho nhan hang, Kho giao hang) on one endless page with no in-page navigation, no landmarks and no
  anchors. Finding a section is a scroll hunt.
- UX-21 Row actions (Luu SDT, Xoa, Dat lai mat khau, Phan cong) are rendered as low-contrast grey
  text, not as controls. They neither look clickable nor meet the target-size floor, and their
  disabled state is indistinguishable.
- UX-22 The Can xu ly queue conveys status by colour alone - red Chua giao and Chua dang ky, green
  plate - which fails WCAG 1.4.1.
- UX-23 The destructive Xoa action carries the same weight as Luu SDT, with no danger tone and no
  signalled confirmation.
- UX-24 The same driver appears in both Can xu ly and the main roster with a different action set in
  each, so the model of where to act is inconsistent.

### 4.5 driver-app and owner-app

- UX-25 Ledger deferred to slice B recon. Both apps must inherit the same affordance primitives
  through @fleet/design-tokens react-native rather than re-deriving them, or the divergence returns
  immediately.

## 5. Root cause (what the source-level fix must remove)

There is no shared affordance layer. Every screen hand-rolls interactive markup with ad hoc Tailwind
classes; there is no Button, IconButton, EmptyState, HelpHint or FieldLabel primitive bound to the
design-tokens semantic SSOT, and no contract naming the vocabulary of tone, emphasis, empty-state
reason or help topic. Therefore affordance, disclosure and guidance are re-decided per file and are
simply absent wherever the author did not think of them. Repairing screens one at a time is the
treadmill. The root fix is a Zod-first affordance contract plus a primitive set every surface
consumes, and a gate that fails the build when a surface hand-rolls an interactive element outside
the primitives.

## 6. Slice plan - outside-in strict TDD, one commit per slice

- S0 Recon of driver-app and owner-app; close UX-25 into concrete IDs.
- S1 RED then GREEN: Zod SSOT in @fleet/domain for the affordance vocabulary - ACTION_TONES,
  ACTION_EMPHASIS, EMPTY_STATE_REASONS, HELP_TOPICS - each an as-const array with z.enum and z.infer
  only, exhaustive Vietnamese label maps typed Record over the enum so an unlabelled member cannot
  compile. Barrel-export contract test so consumers import from the package root.
- S2 RED then GREEN: ops-web primitives bound to the semantic tokens - Button, IconButton,
  EmptyState, HelpHint, FieldLabel, SectionNav - each asserting the 24x24 target floor, a
  focus-visible ring, and correct ARIA.
- S3 Board (UX-02, UX-03, UX-04, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11).
- S4 Create drawer (UX-12, UX-13, UX-14, UX-16).
- S5 Order detail (UX-17, UX-18, UX-19).
- S6 Co so du lieu (UX-20, UX-21, UX-22, UX-23, UX-24).
- S7 Persistent help entry point in the shell, same relative position on every page (UX-01, WCAG
  3.2.6).
- S8 driver-app and owner-app parity through @fleet/design-tokens react-native.
- S9 Ratchet gate: a test that fails when a raw interactive element is authored outside the
  primitives, plus an e2e accessibility smoke pass.

## 7. Explicitly out of scope - owned by other live worktrees

Do not touch these; they are another terminal-s arc and would collide.

- Vietnamese date format (the mm/dd/yyyy inputs) - t65, feature/vietnamese-date-format
- Driver table search and pagination - t46, fix/driver-table-search-pagination
- Excel export columns - t67, feature/excel-export-all-columns
- Board detail phieu can panel - t59, feature/board-detail-phieu-can-panel
- Driver action consolidation - t55, feature/driver-action-consolidation
- Devices approval UI - t7-wt2, feature/devices-approval-ui
- Admin shell layout - fix/admin-shell-layout
- Cancel requires reason - fix/cancel-requires-reason

## 8. Definition of done

Investigation, worktree, RED, GREEN, full gates, PR, merge, release, deploy, manual browser and
device verification at xe.vominhchau.com, then a lesson file in context/ recording the root cause
rather than the individual widget fixes. Every in-scope UX id above must be closed by a named test.
