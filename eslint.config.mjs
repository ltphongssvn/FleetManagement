// ============================================================================
// File:     FleetManagement/eslint.config.mjs
// Purpose:  Root ESLint flat config (v9+) for the FleetManagement monorepo.
// Rationale: See docs/adr/001-turborepo-pipeline.md for lint decisions.
// Related:  .prettierrc, turbo.jsonc, .pre-commit-config.yaml
// ============================================================================

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // Global ignores — use **/pattern for nested workspace matches
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.expo/**",
      "**/coverage/**",
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
          ],
          defaultProject: "tsconfig.base.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Test files: relax some rules that don't apply to tests
  {
    files: ["**/test/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
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
