// scripts/turbo-release-age.ts
// THE SEVEN LINES //#bump:turbo FORGOT.
//
// WHAT WENT WRONG, 2026-08-18. PR #602 bumped the turbo devDependency to
// ^2.10.10 and raised the guard floor in turbo-version-floor.guard.test.ts --
// both correct, both in the same commit, exactly as that guard's header
// demands. It did NOT add 2.10.10 to minimumReleaseAgeExclude in
// pnpm-workspace.yaml, and nothing noticed: the pin guard reads package.json
// only, so develop shipped a version its own supply-chain policy had not
// exempted. PR #606 added the seven lines by hand.
//
// minimumReleaseAgeExclude is pnpm's quarantine escape hatch: a package newer
// than the configured minimum age is REFUSED unless it is listed here. turbo
// needs SEVEN entries -- the runner plus six platform binaries -- because pnpm
// resolves the optional platform package for the host, and a Mac, a Linux
// runner and a WSL2 box each hit a different one. Miss any and that host alone
// fails to install, which is why the omission survived a green CI run.
//
// THE REAL DEFECT IS NOT THE MISSING LINES. bump-turbo.ts rewrites exactly one
// string in package.json and runs an install; the exclude list is maintained by
// hand, in a second file, by whoever remembers. That is the two-sources-of-truth
// shape this repo keeps removing -- the same one ci.yml's aggregate check
// eliminated for required contexts, and the one //#env:recipients eliminated by
// GENERATING .sops.yaml rather than asking anyone to keep two files aligned.
// 2.10.11 would repeat it exactly.
//
// So the seven lines become DERIVED. This module owns the package list and the
// line format; bump:turbo writes them, and a guard asserts the pin and the
// exclude agree, so a future bump that forgets fails a test instead of a
// developer's install on one platform.
//
// PURE, so every rule here is unit-testable without a filesystem: the
// side-effecting rewrite lives in the driver.

/** The turbo packages pnpm may quarantine. The runner plus every platform
 *  binary, because the optional one pnpm picks depends on the HOST -- listing
 *  only the runner leaves a Mac or a Windows box refused while Linux CI passes,
 *  which is precisely how a missing entry stays invisible. */
export const TURBO_PLATFORM_PACKAGES: readonly string[] = Object.freeze([
  '@turbo/darwin-64',
  '@turbo/darwin-arm64',
  '@turbo/linux-64',
  '@turbo/linux-arm64',
  '@turbo/windows-64',
  '@turbo/windows-arm64',
  'turbo',
]);

/** A scoped name needs YAML quoting: a leading @ starts an alias node, so an
 *  unquoted `@turbo/...` is a parse error rather than a string. The existing
 *  file already quotes exactly these and leaves bare `turbo@...` unquoted, so
 *  the rule is derived from the name rather than applied blanketly -- rendering
 *  differently from the committed file would produce a diff on every run. */
function needsQuoting(pkg: string): boolean {
  return pkg.startsWith('@');
}

/** One exclude entry: `pkg@a || b || c`, quoted when the name requires it.
 *  Versions are joined in the order given, never sorted -- the file's history is
 *  chronological, and re-sorting would rewrite six lines on every bump. */
export function excludeLineFor(pkg: string, versions: readonly string[]): string {
  const body = pkg + '@' + versions.join(' || ');
  return needsQuoting(pkg) ? "'" + body + "'" : body;
}

/** Every turbo exclude line for a given version list. */
export function turboExcludeLines(versions: readonly string[]): readonly string[] {
  return TURBO_PLATFORM_PACKAGES.map((pkg) => excludeLineFor(pkg, versions));
}

/** The versions an existing line already carries.
 *
 *  Parses rather than pattern-matches the whole line, so a hand-edited entry
 *  with different spacing or quoting is still read correctly -- this file is
 *  human-edited by design and a brittle reader would silently see nothing and
 *  report every version missing. */
export function versionsInExcludeLine(line: string): readonly string[] {
  const trimmed = line.trim().replace(/^-\s*/, '').replace(/^'|'$/g, '');
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return [];
  return trimmed
    .slice(at + 1)
    .split('||')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** The version list with `version` appended if absent.
 *
 *  IDEMPOTENT: re-running a bump at the same version must produce a byte-
 *  identical file, or //#bump:turbo would dirty the tree on a no-op and the
 *  dirty-tree refusal in its own driver would start failing legitimate runs. */
export function withTurboVersion(existing: readonly string[], version: string): readonly string[] {
  return existing.includes(version) ? existing : [...existing, version];
}

/** Which turbo packages are missing an exclude entry for `version`.
 *
 *  THE GUARD'S QUESTION, and it takes the parsed file rather than a path so the
 *  assertion is pure. Returns package names, not a boolean: a failure that says
 *  WHICH platform is unexempted is actionable, and "the exclude list is wrong"
 *  is not. */
export function missingTurboExcludes(lines: readonly string[], version: string): readonly string[] {
  return TURBO_PLATFORM_PACKAGES.filter((pkg) => {
    const line = lines.find((l) => {
      const t = l.trim().replace(/^-\s*/, '').replace(/^'|'$/g, '');
      return t.startsWith(pkg + '@');
    });
    if (line === undefined) return true;
    return !versionsInExcludeLine(line).includes(version);
  });
}
