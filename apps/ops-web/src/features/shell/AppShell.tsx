// apps/ops-web/src/features/shell/AppShell.tsx
// Professional app shell with vivid gradient backdrop, animated color blobs, dark glass nav.
// Consolidation: the Doi xe (/admin/drivers) + Du lieu (/admin/reference) nav
// links are replaced by ONE Co so du lieu link (/admin/co-so-du-lieu).
// Remaining nav: Dieu phoi (/) + Co so du lieu -- each linked to a real route.
import type { ReactNode, JSX } from 'react';
import { LogoutButton } from '@/features/auth/LogoutButton';
export function AppShell({
  children,
  username,
}: {
  children: ReactNode;
  username?: string;
}): JSX.Element {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-900">
      {/* Layered animated gradient background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-900 to-violet-950" />
        <div className="absolute -top-40 -left-40 h-[36rem] w-[36rem] rounded-full bg-indigo-500/40 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-[40rem] w-[40rem] rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-[32rem] w-[32rem] rounded-full bg-cyan-400/25 blur-3xl" />
        <div className="absolute inset-0 [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </div>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-400 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-white/20">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M3 7a2 2 0 0 1 2-2h9v10H3V7Zm11 1h3.586a1 1 0 0 1 .707.293l2.414 2.414a1 1 0 0 1 .293.707V15h-7V8ZM6.5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                </svg>
              </div>
              <span className="text-sm font-semibold tracking-tight text-white">Điều phối xe</span>
            </div>
            <nav className="hidden items-center gap-1 md:flex">
              <a
                href="/"
                className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-inset ring-white/15"
              >
                Điều phối
              </a>
              <a
                href="/admin/co-so-du-lieu"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
              >
                Cơ sở dữ liệu
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {username && (
              <span className="hidden sm:inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/15">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {username}
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
