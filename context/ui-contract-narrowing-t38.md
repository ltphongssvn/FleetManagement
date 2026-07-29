# A presentational re-layout is not presentational if it narrows a contract

Lesson from T38 (cf887ab) and its repair (PR #424).

Companion to context/parallel-worktree-stale-ground-truth.md, which covers the
PROCESS failure that arc exposed (stale ground truth in a 50-worktree fleet).
This file covers the ENGINEERING failure: what actually broke, and why a change
that changed no behaviour on purpose broke four contracts by accident.

## What T38 believed it was doing

Making the dispatch board table-first: the create form moves behind a drawer,
the table becomes the primary above-the-fold surface. The new form documents
itself as a presentational re-layout emitting byte-identical FormData names
into the unchanged create-order action and schema. Zero create-contract change.

That claim was TRUE and still insufficient. The create contract is what the
SERVER consumes. A UI surface has other contracts nobody had written down, and
all four broke at once. The whole E2E gate went red on develop, promote stopped,
and every terminal lost its path to Railway.

## The four contracts, and why each one is a contract

1. READINESS. data-hydrated lived only on the create form, so specs used
   form-is-hydrated as a proxy for board-is-interactive. Moving the form behind
   a drawer made that proxy wrong in BOTH directions: board-only specs could no
   longer find it, and once a helper opened the drawer for them, the drawer
   covered the very rows they needed to click.

   Readiness is a property of the PAGE. Binding it to one conditionally-rendered
   child means the signal disappears exactly when that child does.

2. QUERYABLE SURFACE. The re-layout kept the FormData names and dropped every
   id. 54 selectors broke that had nothing to do with presentation. Field names
   and field ids are two different contracts with two different consumers; the
   server reads one and every test reads the other.

3. POINTER SURFACE. The drawer was hand-rolled: a full-viewport button styled
   absolute inset-0 as its backdrop. It intercepted every pointer event on the
   board beneath it. Nothing about the intended change required that; it came in
   free with the markup.

4. CONFIRMATION LIFETIME. onCreated closed the drawer, which unmounted the form
   and took the So Lenh success banner with it. The dispatcher lost the order
   number at the instant it was assigned. This one was a PRODUCTION defect, not
   a test defect, and it had shipped silently: eight specs raced the unmount and
   sometimes won, so it read as flake.

## The generalisable rule

Ask what a surface PROMISES, not what it renders. A create form promises:
its field names to the server, its field ids and test ids to the suite, its
readiness signal to anything that must wait, its confirmation to the human, and
an unobstructed page to everything underneath. Moving it changes the last three
even when the first two are untouched.

The practical test before calling a change presentational: list every consumer
of the surface, and for each, state which property it depends on. Anything you
cannot name a consumer for is not yet a contract; anything you can is one, and
narrowing it is a breaking change regardless of intent.

## Why it stayed hidden until E2E

The unit suite passed throughout. Every broken contract is cross-component or
cross-process: a drawer covering a table, a signal on a sibling, a banner
outliving its parent. A component test that renders the form in isolation
cannot observe any of them. This is what the browser gate is FOR, and it is why
a red E2E must be triaged as a real finding rather than assumed flaky.

## Diagnosis notes worth keeping

The decisive evidence was the Playwright TRACE, not the failure message. The
trace showed the Server Action POST had fired and no console errors existed,
which ruled out validation and hydration in one step and pointed straight at
the unmount. Both retries failed identically, which is the signature of a
deterministic bug rather than contention.

An earlier attempt to fix the racing combobox with a retry loop was discarded:
retries are the documented anti-pattern that hides a root cause and inflates CI
time. The real fix was to stop opening a drawer the spec never needed.

Also worth recording: the generic 2026 answer for a modal is the native dialog
element with showModal, which gives the top layer, the backdrop, the focus trap
and Escape for free. It was REJECTED here on evidence. ComboboxField anchors its
listbox through a Floating UI portal, and a top-layer dialog paints over that
portal, so the options would be invisible inside the drawer. Headless UI Dialog
is the vendor-sanctioned pairing and was verified against the real stack rather
than assumed. A best practice that loses to the stack you actually have is not
the best practice for that stack.

## Guard

scripts/e2e-create-drawer-selectors.guard.test.ts pins all of it in the FAST PR
gate, with no browser: the retired test id, the retired id selector, the CSS
tag plus text selector shape, the full set of required field ids, the board
readiness signal, the library-owned dialog, and the persistent live region.

That last one matters beyond this arc. A role=status container mounted on
demand is never monitored by assistive technology (WCAG 4.1.3), so the guard
asserts the container is unconditional and only its CONTENT is conditional.
