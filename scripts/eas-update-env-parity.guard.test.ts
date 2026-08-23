// scripts/eas-update-env-parity.guard.test.ts
// The `eas update` step in eas-driver-build.yml must carry the SAME env the
// preview BUILD profile carries.
//
// WHY THIS CANNOT BE LEFT TO CARE. `eas build` reads the env block from the
// eas.json profile; `eas update` DOES NOT -- Expo documents this asymmetry, and
// it is the single sharpest edge in the whole OTA path. A published bundle
// inherits whatever env the CI step happened to export, so:
//   * APP_ENV missing  -> app.config.ts resolveAppEnv() falls back to
//     'development' -> updates DISABLED in the bundle the drivers receive.
//   * EXPO_PUBLIC_API_URL missing -> the app points at localhost and every
//     request fails on a phone.
// Neither shows up at publish time. expo-updates applies on the NEXT launch, so
// the first symptom is 22 drivers holding a dead app mid-shift.
//
// The values therefore appear TWICE by necessity -- once in eas.json for the
// build, once in the workflow step for the update -- and two hand-maintained
// copies of one fact is the drift shape this repo keeps closing. This asserts
// they agree, so changing eas.json without the workflow (or the reverse) fails
// the PR instead of the drivers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// eas.json is FILE INPUT -- parsed at the boundary, not cast.
const EasJsonSchema = z.object({
  build: z.object({
    preview: z.object({
      channel: z.string(),
      env: z.record(z.string(), z.string()),
    }),
  }),
});

const eas = EasJsonSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'apps/driver-app/eas.json'), 'utf8')),
);
const workflow = readFileSync(resolve(ROOT, '.github/workflows/eas-driver-build.yml'), 'utf8');

/** The env block of the `eas update` step. Anchored on the step name so a
 *  renamed step fails loudly rather than silently matching nothing -- the
 *  vacuous-parse failure this repo refuses. */
function updateStepEnv(): Record<string, string> {
  const step = /- name: Publish OTA update[\s\S]*?run: \|/.exec(workflow)?.[0] ?? '';
  const envBlock = /env:\n([\s\S]*?)\n\s*run:/.exec(step)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of envBlock.split('\n')) {
    const m = /^\s+([A-Z_][A-Z0-9_]*):\s*(\S.*?)\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

// The env keys that MUST match. Not "every key in the profile": the Sentry
// flags are build-phase concerns that an update never runs, so requiring them
// would be a false coupling. These two are the ones a published bundle bakes in.
const MUST_MATCH = Object.freeze(['APP_ENV', 'EXPO_PUBLIC_API_URL'] as const);

describe('eas update publishes with the same env as the preview build', () => {
  const stepEnv = updateStepEnv();

  // Vacuity guard FIRST: a parse that finds nothing makes every comparison
  // below trivially true.
  it('finds the publish step and its env block', () => {
    expect(workflow).toContain('- name: Publish OTA update');
    expect(Object.keys(stepEnv).length).toBeGreaterThanOrEqual(MUST_MATCH.length);
  });

  it('carries the same APP_ENV and API URL as the preview profile', () => {
    for (const key of MUST_MATCH) {
      expect({ key, value: stepEnv[key] }).toEqual({
        key,
        value: eas.build.preview.env[key],
      });
    }
  });

  // APP_ENV is what app.config.ts keys OTA enablement on. If the published
  // bundle carries anything but preview, the drivers receive a bundle with
  // updates switched off and can never be reached again without a rebuild.
  it('publishes with APP_ENV=preview, the value that ENABLES updates', () => {
    expect(stepEnv['APP_ENV']).toBe('preview');
  });

  // The branch must be the channel the drivers' installed binaries subscribe
  // to; publishing to any other branch reaches nobody.
  it('publishes to the branch matching the preview channel', () => {
    expect(workflow).toContain('--branch ' + eas.build.preview.channel);
  });

  // Publishing per-platform would push two updates for one commit.
  it('publishes exactly once per commit, not once per matrix platform', () => {
    const step = /- name: Publish OTA update[\s\S]*?run: \|/.exec(workflow)?.[0] ?? '';
    expect(step).toContain("matrix.platform == 'android'");
  });

  // The publish must happen on the fingerprint MATCH branch -- the case the
  // workflow previously skipped, shipping nothing.
  it('publishes exactly when the native fingerprint already has a build', () => {
    const step = /- name: Publish OTA update[\s\S]*?run: \|/.exec(workflow)?.[0] ?? '';
    expect(step).toContain("steps.fp.outputs.skip == 'true'");
  });

  it('the native-build dispatch still runs only when the fingerprint does NOT match', () => {
    const dispatch = /- name: Dispatch build[\s\S]*?run: \|/.exec(workflow)?.[0] ?? '';
    expect(dispatch).toContain("steps.fp.outputs.skip != 'true'");
  });
});
