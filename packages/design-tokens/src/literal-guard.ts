// packages/design-tokens/src/literal-guard.ts
// Raw-color-literal RATCHET: the enforcement half of the design-token SSOT.
//
// WHAT IT GUARDS, AND WHY tokens:check WAS NOT ENOUGH.
// tokens:check proves globals.css matches the token SSOT. Nothing proved that
// COMPONENTS actually consume the roles. So a page could be migrated to
// semantic roles on Wednesday and have a raw text-slate-900 reintroduced on
// Friday by a different worktree, with every gate green. That is not
// hypothetical: 16b0511 did exactly that to a page 5ae52ec had just cleaned.
// With 50+ concurrent worktrees a manual sweep cannot outrun reintroduction,
// so the migration needs a mechanism, not more diligence.
//
// WHY A RATCHET RATHER THAN A BOOLEAN GATE.
// develop carries 274 literal occurrences across 17 files. A gate that fails on
// all of them is red from the first commit and gets switched off, which is worse
// than no gate because it also removes the appetite for a real one. A ratchet
// tolerates the existing debt, rejects any INCREASE, and lets each migration
// lower a ceiling that can never be raised again. Enforcement arrives on day
// one; the debt drains monotonically.
//
// WHY TSV AND NOT JSON.
// The baseline is a file every migrating worktree edits. In JSON, two worktrees
// migrating two different components collide on braces, commas and trailing
// whitespace -- a merge conflict produced entirely by the format, not the
// change. One atomic tab-separated line per file means parallel migrations
// touch disjoint lines and never conflict. This is the same reasoning that led
// Notion to move its own lint ratchet off JSON.
//
// This module is PURE: scanning, parsing, formatting, comparison. All I/O and
// directory walking lives in the ops-web driver
// (apps/ops-web/scripts/token-literal-ratchet.mts), which owns files inside its
// own package boundary -- the same split as emit-ops-web.ts and build-tokens.mts.
// It lives here rather than beside the driver because apps/ops-web/scripts is
// outside both the vitest include (test/**) and the coverage include (src/**);
// logic placed there would be untestable by construction, which is precisely how
// a four-branch JWT parser survived untested in app/page.tsx for weeks.

// Tailwind default colour ramps. A literal is one of these followed by a numeric
// stop. Semantic roles are excluded automatically: they are named for MEANING
// (surface-root, text-on-dark, border-subtle) and never carry a numeric stop, so
// no allow-list is needed and none can drift.
const RAMPS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose',
] as const;

// Utility prefixes that take a colour. Gradient stops (from/via/to) are included
// because AppShell layers its backdrop entirely through them.
const PREFIXES = [
  'bg', 'text', 'border', 'ring', 'divide', 'outline',
  'shadow', 'decoration', 'accent', 'caret', 'fill', 'stroke',
  'from', 'via', 'to', 'placeholder',
] as const;

const LITERAL_SOURCE =
  '(?:' + PREFIXES.join('|') + ')-(?:' + RAMPS.join('|') + ')-[0-9]+';

// className attributes only. Prose, comments and ordinary strings are not styling
// and must not be counted -- a comment that documents the prohibition would
// otherwise register as a violation of it (a false flag this project has hit
// before). Both quote styles are accepted; the repo uses single quotes in JSX.
const CLASSNAME_ATTR = new RegExp(
  'className=' + String.fromCharCode(91) + String.fromCharCode(39) +
  String.fromCharCode(34) + String.fromCharCode(93) +
  '(' + String.fromCharCode(91) + '^' + String.fromCharCode(39) +
  String.fromCharCode(34) + String.fromCharCode(93) + '*)' +
  String.fromCharCode(91) + String.fromCharCode(39) +
  String.fromCharCode(34) + String.fromCharCode(93),
  'g',
);

// Count each literal once. An opacity modifier (bg-slate-950/60) is ONE literal:
// the migration replaces the whole utility, so counting the suffix separately
// would inflate the budget and let a real regression hide inside the slack.
const LITERAL_GLOBAL = new RegExp(LITERAL_SOURCE, 'g');

export function countRawColorLiterals(source: string): number {
  let total = 0;
  for (const attr of source.matchAll(CLASSNAME_ATTR)) {
    const classes = attr.at(1) ?? '';
    total += Array.from(classes.matchAll(LITERAL_GLOBAL)).length;
  }
  return total;
}

export type RatchetBaseline = Map<string, number>;

const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const HASH = String.fromCharCode(35);

const BANNER = [
  HASH + ' apps/ops-web/design-token-ratchet.tsv',
  HASH + ' AUTO-GENERATED baseline for tokens:lint. Counts may only DECREASE.',
  HASH + ' Refresh after a migration: turbo run tokens:lint --filter=@fleet/ops-web -- --tighten',
  HASH + ' TSV, one atomic line per file, so parallel worktrees never conflict.',
  HASH + ' <path relative to apps/ops-web>' + TAB + '<allowed raw literals>',
].join(NL);

// Sorted so the file is stable across runs: an unstable ordering would produce
// spurious diffs and reintroduce the merge conflicts TSV exists to prevent.
// Zero-count entries are dropped -- a fully migrated file leaves the ledger, and
// re-listing it at 0 would be indistinguishable from a file never scanned.
export function formatRatchetTsv(counts: RatchetBaseline): string {
  const rows = Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([file, count]) => file + TAB + String(count))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return BANNER + NL + rows.join(NL) + NL;
}

export function parseRatchetTsv(tsv: string): RatchetBaseline {
  const out: RatchetBaseline = new Map();
  for (const raw of tsv.split(NL)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith(HASH)) continue;
    const parts = line.split(TAB);
    const file = (parts.at(0) ?? '').trim();
    const count = Number.parseInt(parts.at(1) ?? '', 10);
    if (file.length === 0) continue;
    if (Number.isNaN(count)) continue;
    if (count <= 0) continue;
    out.set(file, count);
  }
  return out;
}

export interface RatchetDelta {
  readonly file: string;
  readonly baseline: number;
  readonly current: number;
}

export interface RatchetVerdict {
  readonly ok: boolean;
  readonly regressions: readonly RatchetDelta[];
  readonly improvements: readonly RatchetDelta[];
  readonly baselineTotal: number;
  readonly currentTotal: number;
}

// Fails CLOSED on any increase. A file absent from the baseline has an implicit
// budget of zero, so a NEW file carrying literals is a regression rather than a
// silent pass -- the confident-zero hazard the other guards in this repo also
// refuse. A decrease is reported as an improvement so the driver can tell the
// operator the ratchet is ready to tighten.
export function compareRatchet(
  baseline: RatchetBaseline,
  current: RatchetBaseline,
): RatchetVerdict {
  const regressions: RatchetDelta[] = [];
  const improvements: RatchetDelta[] = [];
  const files = new Set([...baseline.keys(), ...current.keys()]);
  for (const file of Array.from(files).sort()) {
    const allowed = baseline.get(file) ?? 0;
    const found = current.get(file) ?? 0;
    if (found > allowed) regressions.push({ file, baseline: allowed, current: found });
    else if (found < allowed) improvements.push({ file, baseline: allowed, current: found });
  }
  const sum = (m: RatchetBaseline): number =>
    Array.from(m.values()).reduce((acc, n) => acc + n, 0);
  return {
    ok: regressions.length === 0,
    regressions,
    improvements,
    baselineTotal: sum(baseline),
    currentTotal: sum(current),
  };
}
