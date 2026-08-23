// scripts/e2e/stack-up.test.ts
// Outside-in RED: the contract for the from-scratch E2E stack bring-up BEFORE it
// exists. SSOT = stackUpConfigSchema (fail-fast over the compose project, the
// services to build/start, readiness targets, and the Android AVD/APK/package).
// Pure, unit-testable planners describe WHAT to do; the side-effecting runner is
// the entrypoint only. Imports a module that does not exist yet -> MUST fail at
// import (RED for the right reason: module-not-found on the SUT).
import { describe, it, expect } from 'vitest';
import {
  stackUpConfigSchema,
  composeServices,
  readinessProbes,
  androidPlan,
  envConfig,
  defaultConfig,
} from './stack-up.ts';

const base = {
  composeProject: 'fleet-pilot',
  apiUrl: 'http://localhost:3000',
  opsWebUrl: 'http://localhost:3001',
  avd: 'fleet_e2e',
  device: 'emulator-5554',
  apkPath: 'apps/driver-app/android/app/build/outputs/apk/release/app-release.apk',
  driverPackageId: 'com.fleetmanagement.driver',
};

describe('stackUpConfigSchema', () => {
  it('accepts a fully-specified config and yields typed values', () => {
    const c = stackUpConfigSchema.parse(base);
    expect(c.composeProject).toBe('fleet-pilot');
    expect(c.device).toBe('emulator-5554');
  });
  it('rejects a non-URL apiUrl (fail-fast, no silent fallback)', () => {
    expect(stackUpConfigSchema.safeParse({ ...base, apiUrl: 'nope' }).success).toBe(false);
  });
  it('rejects an empty AVD name', () => {
    expect(stackUpConfigSchema.safeParse({ ...base, avd: '' }).success).toBe(false);
  });
  it('rejects an apkPath that is not an .apk', () => {
    expect(stackUpConfigSchema.safeParse({ ...base, apkPath: 'foo/app.txt' }).success).toBe(false);
  });
  it('defaults includeOpsWeb to true when unset', () => {
    expect(stackUpConfigSchema.parse(base).includeOpsWeb).toBe(true);
  });
});

describe('composeServices', () => {
  it('lists the core stack in dependency-safe order, infra before api', () => {
    const svc = composeServices(stackUpConfigSchema.parse(base));
    for (const s of [
      'postgres',
      'redis',
      'mock-oauth2',
      'localstack',
      'api',
      'worker',
      'ops-web',
    ]) {
      expect(svc).toContain(s);
    }
    expect(svc.indexOf('postgres')).toBeLessThan(svc.indexOf('api'));
    expect(svc.indexOf('api')).toBeLessThan(svc.indexOf('ops-web'));
  });
  it('omits ops-web when includeOpsWeb is false', () => {
    const svc = composeServices(stackUpConfigSchema.parse({ ...base, includeOpsWeb: false }));
    expect(svc).not.toContain('ops-web');
    expect(svc).toContain('api');
  });
  it('never includes driver-app (phone/LAN-only, not part of the core bring-up)', () => {
    expect(composeServices(stackUpConfigSchema.parse(base))).not.toContain('driver-app');
  });
});

describe('readinessProbes', () => {
  it('derives the api /health/ready probe and the ops-web base from config', () => {
    const p = readinessProbes(stackUpConfigSchema.parse(base));
    expect(p).toContain('http://localhost:3000/health/ready');
    expect(p).toContain('http://localhost:3001');
  });
  it('drops the ops-web probe when includeOpsWeb is false', () => {
    const p = readinessProbes(stackUpConfigSchema.parse({ ...base, includeOpsWeb: false }));
    expect(p).toContain('http://localhost:3000/health/ready');
    expect(p).not.toContain('http://localhost:3001');
  });
});

describe('androidPlan', () => {
  it('targets the configured device for boot/install/reverse', () => {
    const a = androidPlan(stackUpConfigSchema.parse(base));
    expect(a.device).toBe('emulator-5554');
    expect(a.avd).toBe('fleet_e2e');
    expect(a.apkPath).toMatch(/app-release\.apk$/);
    expect(a.reverse).toEqual({ from: 'tcp:3000', to: 'tcp:3000' });
  });
});

// ---- per-worktree port derivation ----
// compose-identity.ts writes FLEET_PORT_* into each worktree's .env so parallel
// stacks do not fight over 3000/3001. docker compose reads that file; this
// process does not, so stack:up probed localhost:3000 regardless and reported a
// healthy stack belonging to ANOTHER worktree -- or a dead one as broken.
describe('envConfig', () => {
  const base = {
    FLEET_COMPOSE_PROJECT: 'fleet-abc123def456',
    FLEET_PORT_API: '3010',
    FLEET_PORT_OPS_WEB: '3011',
  };

  it('derives the probe URLs from the worktree ports', () => {
    const c = envConfig(base);
    expect(c.apiUrl).toBe('http://localhost:3010');
    expect(c.opsWebUrl).toBe('http://localhost:3011');
  });

  it('derives the compose project so it targets this worktree stack', () => {
    expect(envConfig(base).composeProject).toBe('fleet-abc123def456');
  });

  // CI maps ports 1:1 and sets none of these, so an absent env must leave the
  // committed defaults untouched -- the fallback is what keeps CI unaffected.
  it('falls back to defaultConfig when nothing is set', () => {
    const c = envConfig({});
    expect(c.apiUrl).toBe(defaultConfig.apiUrl);
    expect(c.opsWebUrl).toBe(defaultConfig.opsWebUrl);
    expect(c.composeProject).toBe(defaultConfig.composeProject);
  });

  it('honours FLEET_SKIP_ANDROID for a web-only run', () => {
    expect(envConfig({ FLEET_SKIP_ANDROID: '1' }).includeAndroid).toBe(false);
  });
});

// androidPlan hardcoded tcp:3000 while envConfig derives the API port, so on a
// worktree using 3010 adb reverse forwarded the WRONG port and the driver app
// silently talked to another worktree's api -- the same class this arc fixes,
// one function over.
describe('androidPlan port derivation', () => {
  it('reverses the port the api is actually on', () => {
    const plan = androidPlan(envConfig({ FLEET_PORT_API: '3010' }));
    expect(plan.reverse).toStrictEqual({ from: 'tcp:3010', to: 'tcp:3010' });
  });

  it('still reverses 3000 under the CI defaults', () => {
    expect(androidPlan(defaultConfig).reverse).toStrictEqual({ from: 'tcp:3000', to: 'tcp:3000' });
  });
});
