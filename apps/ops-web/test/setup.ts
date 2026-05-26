// apps/ops-web/test/setup.ts
// Vitest global setup — registers jest-dom matchers for DOM assertions
// and polyfills ResizeObserver, which JSDOM does not provide but Headless
// UI 2.x uses inside its combobox-close path. Without this polyfill,
// closing a Headless UI Combobox in tests throws ReferenceError.
//
// Also stubs next/navigation's useRouter so client components that call
// router.refresh() (e.g. CreateOrderForm post-T3 button state recovery)
// render under jsdom without 'app router to be mounted' invariant errors.
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
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
