// ============================================================================
// File:     FleetManagement/eslint.config.mjs
// Purpose:  Root ESLint flat config (v9+) for the FleetManagement monorepo.
//           Shared rules inherited by all workspaces. Per-package overrides
//           extend this via ESLint's cascading flat config resolution.
//
// Why it exists:
//   turbo.jsonc lint task is wired (pre-commit hooks, CI gates, $TURBO_ROOT$
//   hashing) but had no actual ESLint config — making lint a no-op. This
//   file makes `turbo run lint` functional from the first .ts file.
//   Paired with Prettier via eslint-config-prettier (disables formatting
//   rules that conflict with Prettier).
//
// Key decisions:
//   - Flat config (eslint.config.mjs) not legacy .eslintrc: ESLint v9+
//     default. Legacy .eslintrc globs kept in turbo.jsonc inputs for
//     transitional safety (per ADR-001 FUTURE WORK).
//   - typescript-eslint recommended + strict + stylistic: maximum type
//     safety. Requires tsconfig project references (parserOptions.project).
//   - eslint-config-prettier last: disables formatting rules so Prettier
//     owns all formatting.
//   - Ignores: node_modules, dist, build, .next, .turbo, coverage,
//     playwright-report (matches .gitignore + turbo outputs).
//
// Related files:
//   - .prettierrc           — Prettier formatting rules
//   - turbo.jsonc            — lint task inputs hash this file
//   - .pre-commit-config.yaml — pnpm-lint hook mirrors CI
//   - docs/adr/001-turborepo-pipeline.md — lint decisions
// ============================================================================

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "out/**",
      ".next/**",
      ".turbo/**",
      ".expo/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "*.tsbuildinfo",
      "pnpm-lock.yaml",
    ],
  },

  // Base JS rules
  eslint.configs.recommended,

  // TypeScript strict + stylistic rules
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // TypeScript parser options (project-aware for type-checked rules)
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Custom rule overrides
  {
    rules: {
      // Ban explicit any — force unknown + runtime narrowing (Zod/class-validator)
      "@typescript-eslint/no-explicit-any": "error",

      // Enforce consistent type imports (tree-shaking + clean boundaries)
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Unused vars: allow underscore prefix for intentional discard
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Floating promises: must be awaited, returned, or void-annotated
      "@typescript-eslint/no-floating-promises": "error",

      // No misused promises (e.g., passing async to forEach)
      "@typescript-eslint/no-misused-promises": "error",

      // Require explicit return types on exported functions (API contract clarity)
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
    },
  },

  // Prettier must be last — disables conflicting formatting rules
  eslintConfigPrettier,
);
