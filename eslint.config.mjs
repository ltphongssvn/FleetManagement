// ============================================================================
// File:     FleetManagement/eslint.config.mjs
// Purpose:  Root ESLint flat config (v9+) for the FleetManagement monorepo.
// Rationale: See docs/adr/001-turborepo-pipeline.md for lint decisions.
// Related:  .prettierrc, turbo.jsonc, .pre-commit-config.yaml
// ============================================================================

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import vitest from "@vitest/eslint-plugin";

export default tseslint.config(
  // Global ignores — use **/pattern for nested workspace matches
  {
    ignores: [
      "apps/driver-app/metro.config.js",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.expo/**",
      "**/coverage/**",
      "**/.stryker-tmp/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/*.tsbuildinfo",
      "pnpm-lock.yaml",
      "**/postcss.config.mjs",
      "**/next-env.d.ts",
      "**/drizzle.config.ts",
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
        projectService: {
          allowDefaultProject: [
            "*.config.ts",
            "*.config.mjs",
            "vitest.config.ts",
            "vitest.integration.config.ts",
            "vitest.coverage.config.ts",
            "scripts/*.ts",
            "scripts/e2e/*.ts",
            "scripts/e2e/*.mts",
            "scripts/ci/*.ts",
          ],
          defaultProject: "tsconfig.base.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Test files: relax some rules that don't apply to tests; enable vitest hygiene
  {
    files: ["**/test/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    plugins: { vitest },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "warn",
      "vitest/no-identical-title": "error",
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "expectTypeOf", "fc.assert"] }],
      "vitest/valid-expect": "error",
    },
  },
  // e2e specs live under e2e/ and are NOT in any app/package tsconfig include,
  // so the root projectService (defaultProject: tsconfig.base.json, which does
  // not include them) cannot bind them -> "was not found by the project
  // service" parse error. Bind e2e files to e2e/tsconfig.json (include: **/*.ts)
  // so type-aware rules resolve them.
  {
    files: ["e2e/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./e2e/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Forbid test imports in production code
  {
    files: ["apps/*/src/**/*.ts", "workers/*/src/**/*.ts", "packages/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["vitest", "**/test/**", "@fleet/test-fixtures"],
          message: "Test imports are forbidden in production code",
        }],
      }],
    },
  },

  // Custom rule overrides
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
    },
  },

  // Prettier must be last
  eslintConfigPrettier,
);
