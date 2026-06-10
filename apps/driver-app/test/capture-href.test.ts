// apps/driver-app/test/capture-href.test.ts
// outside-in strict TDD RED (L1): the assignment card must deep-link each stop
// to its per-warehouse proof screen. captureHrefForStop builds the Expo Router
// href from the transport order id + the stop's capture descriptor
// (stopKind/stopIndex from presentAssignmentStops). loading carries its 0-based
// stopIndex; unloading omits stopIndex (single unloading warehouse). Without
// these params the capture screen renders invalid_stop, so the href MUST carry
// them — this is what makes per-warehouse capture reachable via normal UI nav.
import { describe, it, expect } from 'vitest';
import { captureHrefForStop } from '../src/assignments/capture-href.js';
const TO = '32e1d5a6-7f7d-4ce0-a3d1-c6db60c8986d';
describe('captureHrefForStop', () => {
  it('builds a loading href with the 0-based stopIndex', () => {
    expect(captureHrefForStop(TO, { stopKind: 'loading', stopIndex: 0, sequence: 1 })).toBe(
      '/capture?transportOrderId=' + TO + '&stopKind=loading&stopIndex=0&stopSequence=1',
    );
    expect(captureHrefForStop(TO, { stopKind: 'loading', stopIndex: 3, sequence: 4 })).toBe(
      '/capture?transportOrderId=' + TO + '&stopKind=loading&stopIndex=3&stopSequence=4',
    );
  });
  it('builds an unloading href without a stopIndex', () => {
    expect(captureHrefForStop(TO, { stopKind: 'unloading', stopIndex: null, sequence: 5 })).toBe(
      '/capture?transportOrderId=' + TO + '&stopKind=unloading&stopSequence=5',
    );
  });
  it('always includes the transportOrderId so the upload can target the order', () => {
    const href = captureHrefForStop(TO, { stopKind: 'loading', stopIndex: 1, sequence: 2 });
    expect(href.startsWith('/capture?transportOrderId=' + TO)).toBe(true);
  });
});
