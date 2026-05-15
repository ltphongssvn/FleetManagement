// apps/driver-app/test/mobile-native-bundle-config.test.ts
// TDD RED: driver-app must serve a native Metro bundle reachable from
// iOS/Android devices, otherwise Expo Go cannot mount the app and the
// login screen never appears on the phone.
//
// Verified invariants (each currently fails -> RED):
//   1. EXPO_PUBLIC_API_URL must be LAN-reachable (not localhost / 127.0.0.1).
//      The value is baked into the JS bundle that the phone downloads, so
//      "localhost" on the phone means the phone itself, not the dev host.
//   2. REACT_NATIVE_PACKAGER_HOSTNAME must be set on the driver-app service
//      so Metro advertises a host the phone can reach in the QR/bundle URL.
//      Without it, Expo auto-detects the container's internal Docker IP.
//   3. driver-app Dockerfile CMD must NOT pin Metro to --web only; native
//      bundles must be served for iOS/Android.
//   4. driver-app Dockerfile CMD must pass --host lan so Metro binds to
//      the LAN-reachable interface inside the container.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const composePath = resolve(__dirname, '../../../compose.yaml');
const dockerfilePath = resolve(__dirname, '../Dockerfile');
const compose = readFileSync(composePath, 'utf8');
const dockerfile = readFileSync(dockerfilePath, 'utf8');

function extractDriverAppBlock(yaml: string): string {
  const m = /^ {2}driver-app:[\s\S]*?(?=\n {0,2}\S|$(?![\s\S]))/m.exec(yaml);
  return m?.[0] ?? '';
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
    const cmdMatch = /CMD\s+\[([^\]]+)\]/.exec(dockerfile);
    expect(cmdMatch, 'Dockerfile must declare a CMD').not.toBeNull();
    const cmd = cmdMatch?.[1] ?? '';
    expect(cmd).not.toMatch(/\"--web\"/);
  });

  it('Dockerfile CMD passes --host lan so Metro binds a LAN-reachable interface', () => {
    const cmdMatch = /CMD\s+\[([^\]]+)\]/.exec(dockerfile);
    const cmd = cmdMatch?.[1] ?? '';
    expect(cmd).toMatch(/\"--host\"\s*,\s*\"lan\"/);
  });
});
