// apps/ops-web/test/setup.ts
// Vitest global setup — registers jest-dom matchers for DOM assertions
// and polyfills ResizeObserver, which JSDOM does not provide but Headless
// UI 2.x uses inside its combobox-close path. Without this polyfill,
// closing a Headless UI Combobox in tests throws ReferenceError.
//
// Also stubs next/navigation's useRouter so client components that call
// router.refresh() (e.g. CreateOrderForm post-T3 button state recovery)
// render under jsdom without 'app router to be mounted' invariant errors.
import { vi, afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// RTL queries are global to document.body; without auto-cleanup, renders
// from one test leak into the next (duplicate elements). This config does
// not set globals:true, so RTL's afterEach(cleanup) must be registered here.
afterEach(() => {
  cleanup();
});
// waitFor/findBy* carry their OWN default timeout (1000ms, asyncUtilTimeout),
// independent of the vitest testTimeout already raised to 30s for CPU
// contention under the parallel coverage gate. Under that same contention a
// useActionState re-render can exceed 1s (passes in ms in isolation), flaking
// findByText. 10s: well under testTimeout so real hangs still fail with DOM
// state printed, far above any contention window.
configure({ asyncUtilTimeout: 10_000 });
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
  };
}
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
