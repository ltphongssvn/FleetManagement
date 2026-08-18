// scripts/gate-coverage-preflight.test.ts
// The coverage gate fails fast when no container runtime is reachable.
//
// Measured cost, twice in one session: apps/api test:coverage uses
// testcontainers. With Docker Desktop down the gate still runs eleven
// workspaces to completion -- roughly four minutes and ~2500 passing tests --
// then dies at the twelfth with
//   [pg-global-setup] pre-start reap failed (non-fatal): spawnSync docker EIO
//   Error: Could not find a working container runtime strategy
// followed by ~200 lines of 0%-coverage threshold errors naming every file in
// apps/api and none of the actual cause.
//
// The signal was already present and discarded: pg-global-setup catches the
// EIO and logs it as non-fatal, which is correct for a reap, but the runtime's
// absence is then thrown away and the process dies one step later. The
// fail-fast opportunity is missed by exactly one step.
//
// 2026 practice is to probe the daemon before the expensive work and emit
// actionable guidance rather than a stack trace -- the shape Spring Boot
// shipped as a FailureAnalyzer for this same condition.
//
// The remedy text is host-specific on purpose: WSL interop is disabled here,
// so `docker desktop start` is not reachable from this shell and must be run
// from PowerShell. Omitting that sends the operator in a circle.
import { describe, expect, it } from 'vitest';
import {
  containerRuntimeProbeArgs,
  containerRuntimeUnavailableMessage,
  needsContainerRuntime,
} from './gate-coverage.js';
describe('coverage gate container-runtime preflight', () => {
  it('uses a daemon-only probe without pulling images or starting containers', () => {
    const args = containerRuntimeProbeArgs();
    expect(args[0]).toBe('docker');
    expect(args).toContain('info');
    expect(args).not.toContain('run');
    expect(args).not.toContain('pull');
  });
  it('reports that the sweep depends on a container runtime', () => {
    expect(needsContainerRuntime()).toBe(true);
  });
  it('names the unavailable capability and the dependent workspace', () => {
    const message = containerRuntimeUnavailableMessage();
    expect(message).toMatch(/container runtime/i);
    expect(message).toMatch(/apps\/api/);
    expect(message).toMatch(/testcontainers/i);
  });
  it('includes a remedy valid for a WSL host with interop disabled', () => {
    const message = containerRuntimeUnavailableMessage();
    expect(message).toMatch(/PowerShell/);
    expect(message).toMatch(/docker desktop start/);
  });
  it('states that the sweep was skipped rather than broken', () => {
    const message = containerRuntimeUnavailableMessage();
    expect(message).toMatch(/before|skipped|rather than/i);
  });
});
