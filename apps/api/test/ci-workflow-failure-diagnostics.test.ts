// apps/api/test/ci-workflow-failure-diagnostics.test.ts
// Business invariant (permanent rule): a CI step that BRINGS UP the compose
// stack must dump its own container diagnostics when it fails. A later
// if: failure() step is NOT sufficient and must never be relied on alone.
//
// REAL INCIDENT (2026-08-11, PR #560 and #563). The API exited 1 during
// maybeMigrate. CI printed exactly one line:
//
//   dependency failed to start: container fleet-pilot-api-1 exited (1)
//
// and nothing else. e2e.yml already had TWO log dumps -- one in the health-wait
// step, one in an if: failure() step after Playwright -- and neither produced a
// byte, because docker compose up aborts the bringup step itself the moment a
// dependency exits. The health-wait step never ran, and the trailing dump ran
// against a job that had already failed several steps earlier. Diagnosing the
// crash required linking the Railway CLI and reading production deploy logs for
// a failure CI had reproduced perfectly and then discarded.
//
// THE RULE, stated so it generalises: evidence must be captured by the step
// that fails, not by a step that runs afterwards. A follow-up step is a
// best-effort supplement; it is not a capture strategy, because it depends on
// the failing step having survived long enough to reach it.
//
// The 2026 CI convention this encodes: on failure print docker ps -a (which
// containers exited) and docker compose logs (why), each with || true so the
// diagnostic itself can never mask or replace the real exit code.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const E2E_WF = join(REPO_ROOT, '.github', 'workflows', 'e2e.yml');

function workflow(): string {
  return readFileSync(E2E_WF, 'utf8');
}

// The bringup step's script: from the compose build line to the end of that
// step's block. Read as text rather than parsed YAML so the guard has no
// runtime dependency, matching ci-workflow-shell-parse.test.ts.
function bringupScript(): string {
  const text = workflow();
  const start = text.indexOf('docker compose build --no-cache');
  expect(start, 'bringup step not found in e2e.yml').toBeGreaterThan(-1);
  const nextStep = text.indexOf('- name:', start);
  return text.slice(start, nextStep === -1 ? undefined : nextStep);
}

describe('e2e.yml captures container diagnostics at the point of failure', () => {
  it('the bringup step reports which containers exited', () => {
    expect(bringupScript()).toContain('docker ps -a');
  });

  it('the bringup step dumps compose logs itself, not via a later step', () => {
    expect(bringupScript()).toContain('docker compose logs');
  });

  it('the bringup diagnostics cannot mask the real exit code', () => {
    // Every diagnostic command is || true so a missing container or a docker
    // hiccup cannot turn a red build green -- nor can it swallow the failure.
    const script = bringupScript();
    const diagnosticLines = script
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('docker ps -a') || l.startsWith('docker compose logs'));
    expect(diagnosticLines.length).toBeGreaterThan(0);
    for (const line of diagnosticLines) {
      expect(line, 'diagnostic must not affect exit status: ' + line).toContain('|| true');
    }
  });

  it('the bringup step still fails the job after dumping', () => {
    expect(bringupScript()).toContain('exit 1');
  });

  it('keeps the trailing failure dump as a supplement', () => {
    // Retained deliberately: it covers failures AFTER bringup (a Playwright
    // crash, a mid-run container death). It is a supplement, never the only
    // capture -- that assumption is what produced the incident.
    expect(workflow()).toContain('if: failure()');
  });

  it('the trailing dump runs even when a later step tore the stack down', () => {
    // Jaeger issue #5912: a log step placed after teardown captures nothing.
    // always() ordering plus ps -a keeps the record honest.
    const text = workflow();
    const dumpIdx = text.indexOf('Dump container logs on failure');
    expect(dumpIdx).toBeGreaterThan(-1);
    expect(text.slice(dumpIdx)).toContain('docker ps -a');
  });
});
