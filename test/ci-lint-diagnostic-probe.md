// test/ci-lint-diagnostic-probe.md
// Temporary CI diagnostic (to be removed once root cause confirmed).
// Purpose: the driver-app no-unsafe-* lint errors reproduce ONLY in CI, never
// locally. Local typescript-estree DEBUG shows api-url.ts binds correctly to
// apps/driver-app/tsconfig.json (real program, no any). CI shows old-code line
// numbers + a 26s driver-app lint (vs ~4s local), suggesting the project
// service fails to bind in CI and falls back to an empty program.
//
// Next CI run: the Lint step is temporarily wrapped to emit
// typescript-estree project-service resolution for api-url.ts, so we can read
// the actual configFileName + "Default project allowed path" in CI logs and
// confirm the fallback empirically before changing eslint config.
