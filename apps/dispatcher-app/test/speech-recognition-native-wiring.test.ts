// apps/dispatcher-app/test/speech-recognition-native-wiring.test.ts
// Wiring guard for the ONE coverage-excluded module in the STT seam.
//
// Deliberately small. driver-app's equivalent carries thirteen source-text
// assertions because its adapter holds real logic behind the exclusion. Here
// the logic lives in speech-recognition-port.ts and executes against an
// injected fake, so only two things remain unprovable by execution: that the
// exclusion is actually declared, and that the adapter delegates rather than
// re-implementing. Source text is a weak instrument, used only where nothing
// stronger is available -- never as a substitute for running the code. Where
// it is wrong it errs toward failing: a string literal containing a forbidden
// token trips the gate rather than slipping past it.
//
// Comment lines are stripped before matching so prose about a forbidden token
// cannot trip an assertion about code (the codeOnly precedent from
// apps/api/test/vitest-maxworkers-ssot.guard.test.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8');
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;
const codeOnly = (s: string): string =>
  s
    .split(NL)
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith(LINE_COMMENT) && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join(NL);
const ADAPTER = 'src/voice/speech-recognition-native.ts';
describe('@fleet/dispatcher-app - STT native adapter wiring', () => {
  it('is coverage-excluded: expo-modules-core cannot resolve in the node lane', () => {
    expect(codeOnly(src('vitest.config.ts')).includes(ADAPTER)).toBe(true);
  });
  it('delegates to the pure port instead of re-implementing it', () => {
    const code = codeOnly(src(ADAPTER));
    expect(code.includes('gatherSpeechFacts(')).toBe(true);
    expect(code.includes('toSupportedPlatform(')).toBe(true);
    expect(code.includes('installedLocales')).toBe(false);
    expect(code.includes('catch')).toBe(false);
  });
});
