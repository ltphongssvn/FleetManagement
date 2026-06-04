// apps/driver-app/test/mobile-native-bundle-config.test.ts
// TDD: driver-app must serve a native Metro bundle reachable from iOS/Android
// devices, and the Maestro flow must drive the real login journey reliably.
//
// Verified invariants:
//   1. EXPO_PUBLIC_API_URL must be LAN-reachable (not localhost / 127.0.0.1).
//   2. REACT_NATIVE_PACKAGER_HOSTNAME must be set on the driver-app service.
//   3. driver-app Dockerfile CMD must NOT pin Metro to --web only.
//   4. driver-app Dockerfile CMD must NOT combine --offline with a host-mode flag.
//   5. driver-app Dockerfile CMD must pass --offline.
//   6. The Android Maestro flow openLink must target 10.0.2.2 (not localhost).
//   7. The flow must wait for the login SUBTITLE via extendedWaitUntil.
//   8. The flow must dismiss the Expo Go overlay with pressKey: back.
//   9. driver-app Dockerfile CMD must pass --clear.
//  10. The flow must hideKeyboard before submitting. After typing into the
//      password field the soft keyboard covers the submit button and the
//      post-login screen; without hideKeyboard the subsequent assert runs while
//      the keyboard still occludes the view. (Maestro 2026 RN guidance.)
//  11. The post-login marker "Trạng thái đồng bộ" must be awaited via
//      extendedWaitUntil, not a bare assertVisible: login does a network
//      round-trip then navigates, so the home screen is not instantly present.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const composePath = resolve(__dirname, '../../../compose.yaml');
const dockerfilePath = resolve(__dirname, '../Dockerfile');
const maestroFlowPath = resolve(__dirname, '../.maestro/driver-login-assignment.yaml');
const compose = readFileSync(composePath, 'utf8');
const dockerfile = readFileSync(dockerfilePath, 'utf8');
const maestroFlow = readFileSync(maestroFlowPath, 'utf8');
function extractDriverAppBlock(yaml: string): string {
  const m = /^ {2}driver-app:[\s\S]*?(?=\n {0,2}\S|$(?![\s\S]))/m.exec(yaml);
  return m?.[0] ?? '';
}
function dockerfileCmd(df: string): string {
  const m = /CMD\s+\[([^\]]+)\]/.exec(df);
  return m?.[1] ?? '';
}
function openLinkUrl(flow: string): string {
  const m = /openLink:\s*(\S+)/.exec(flow);
  return m?.[1] ?? '';
}
describe('driver-app mobile native bundle config', () => {
  const block = extractDriverAppBlock(compose);
  it('EXPO_PUBLIC_API_URL is LAN-reachable (not localhost / 127.0.0.1)', () => {
    const m = /EXPO_PUBLIC_API_URL:\s*(\S+)/.exec(block);
    expect(m, 'EXPO_PUBLIC_API_URL must be declared on driver-app service').not.toBeNull();
    const url = m?.[1] ?? '';
    expect(url).not.toMatch(/localhost/);
    expect(url).not.toMatch(/127\.0\.0\.1/);
  });
  it('REACT_NATIVE_PACKAGER_HOSTNAME is set so Metro advertises a reachable host', () => {
    expect(block).toMatch(/REACT_NATIVE_PACKAGER_HOSTNAME:\s*\S+/);
  });
  it('Dockerfile CMD does not restrict Metro to --web only', () => {
    const cmd = dockerfileCmd(dockerfile);
    expect(cmd, 'Dockerfile must declare a CMD').not.toBe('');
    expect(cmd).not.toMatch(/"--web"/);
  });
  it('Dockerfile CMD does not combine --offline with a host-mode flag', () => {
    const cmd = dockerfileCmd(dockerfile);
    expect(cmd).not.toMatch(/"--host"/);
    expect(cmd).not.toMatch(/"--lan"/);
    expect(cmd).not.toMatch(/"--tunnel"/);
    expect(cmd).not.toMatch(/"--localhost"/);
  });
  it('Dockerfile CMD passes --offline so non-interactive Metro skips Expo account auth', () => {
    const cmd = dockerfileCmd(dockerfile);
    expect(cmd).toMatch(/"--offline"/);
  });
  it('Android Maestro flow openLink targets emulator-reachable 10.0.2.2 (not localhost)', () => {
    const url = openLinkUrl(maestroFlow);
    expect(url, 'flow must contain an openLink: exp:// URL').not.toBe('');
    expect(url).not.toMatch(/localhost/);
    expect(url).toMatch(/exp:\/\/10\.0\.2\.2:8081/);
  });
  it('flow waits for the login subtitle via extendedWaitUntil before interacting', () => {
    const ewuBlocks = maestroFlow.match(/extendedWaitUntil:[\s\S]*?(?=\n- |\n*$)/g) ?? [];
    const subtitleWaited = ewuBlocks.some((b) =>
      /visible:\s*["']?Đăng nhập để xem lệnh điều xe/.test(b),
    );
    expect(subtitleWaited, 'subtitle must be guarded by extendedWaitUntil, not a bare assertVisible').toBe(true);
  });
  it('flow dismisses the Expo Go overlay with pressKey back (not tapping Continue)', () => {
    expect(maestroFlow, 'flow must pressKey: back to close the Expo bottom-sheet').toMatch(/pressKey:\s*[Bb]ack/);
    expect(maestroFlow, 'flow must NOT tap Continue (it re-triggers the tools menu)').not.toMatch(/text:\s*["']Continue["']/);
  });
  it('Dockerfile CMD passes --clear so Metro serves a fresh bundle each start', () => {
    const cmd = dockerfileCmd(dockerfile);
    expect(cmd).toMatch(/"--clear"/);
  });
  it('flow hides the keyboard before submitting login', () => {
    expect(maestroFlow, 'flow must hideKeyboard so the keyboard does not occlude submit / post-login screen').toMatch(/hideKeyboard/);
  });
  it('post-login marker is awaited via extendedWaitUntil (not a bare assert)', () => {
    const ewuBlocks = maestroFlow.match(/extendedWaitUntil:[\s\S]*?(?=\n- |\n*$)/g) ?? [];
    const syncWaited = ewuBlocks.some((b) => /visible:\s*["']?Trạng thái đồng bộ/.test(b));
    expect(syncWaited, 'post-login Trạng thái đồng bộ must be awaited via extendedWaitUntil').toBe(true);
  });
});
