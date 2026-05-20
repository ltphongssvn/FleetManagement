// apps/ops-web/test/setup.ts
// Vitest global setup — registers jest-dom matchers for DOM assertions
// and polyfills ResizeObserver, which JSDOM does not provide but Headless
// UI 2.x uses inside its combobox-close path. Without this polyfill,
// closing a Headless UI Combobox in tests throws ReferenceError.
import '@testing-library/jest-dom/vitest';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
  };
}
