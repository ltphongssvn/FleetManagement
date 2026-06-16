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
    for (const s of ['postgres', 'redis', 'mock-oauth2', 'localstack', 'api', 'worker', 'ops-web']) {
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
