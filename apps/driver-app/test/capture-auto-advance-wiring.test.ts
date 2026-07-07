// apps/driver-app/test/capture-auto-advance-wiring.test.ts
// RED-first (driver-min-interaction arc, U3): wiring guard. The photo-implies-
// progress bridge only works if the capture screen KNOWS which run it is
// photographing and how many stops remained. Contract:
//   - captureHrefForStop threads roadRunId, runState, and remaining (stops
//     without a committed photo BEFORE this capture) as route params;
//   - capture.tsx wires autoAdvanceAfterCapture with the forgiving factory
//     and fires it after UPLOAD_OK (fire-and-forget void, never awaited into
//     the UI path);
//   - assignments.tsx computes remaining from presentAssignmentStops .done
//     and passes item.roadRunId + item.state into the href builder.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHrefForStop } from '../src/assignments/capture-href.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8');

describe('capture auto-advance wiring', () => {
  it('captureHrefForStop threads roadRunId, runState, and remaining', () => {
    const href = captureHrefForStop('to-1', {
      stopKind: 'loading', stopIndex: 0, sequence: 1,
      roadRunId: 'rr-9', runState: 'planned', remaining: 2,
    });
    expect(href).toContain('transportOrderId=to-1');
    expect(href).toContain('stopKind=loading');
    expect(href).toContain('stopIndex=0');
    expect(href).toContain('stopSequence=1');
    expect(href).toContain('roadRunId=rr-9');
    expect(href).toContain('runState=planned');
    expect(href).toContain('remaining=2');
  });

  it('capture screen fires autoAdvanceAfterCapture after UPLOAD_OK', () => {
    const s = src('app/(app)/capture.tsx');
    expect(s.includes('autoAdvanceAfterCapture')).toBe(true);
    expect(s.includes('makeForgivingLifecycleMutationFn')).toBe(true);
    expect(s.includes('UPLOAD_OK') && s.includes('autoAdvanceAfterCapture')).toBe(true);
    expect(s.includes('void autoAdvanceAfterCapture') || s.includes('void runAutoAdvance')).toBe(true);
  });

  it('assignments card passes run context into the href builder', () => {
    const s = src('app/(app)/assignments.tsx');
    expect(s.includes('roadRunId: item.roadRunId')).toBe(true);
    expect(s.includes('runState: item.state')).toBe(true);
    expect(s.includes('remaining')).toBe(true);
  });
});
