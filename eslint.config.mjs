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
      "apps/owner-app/metro.config.js",
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
  // Root scripts/ live outside every workspace package, so the root
  // projectService could not bind them either: they were shoehorned into
  // allowDefaultProject, which caps at 8 files and made linting the DIRECTORY
  // impossible (>8 matches -> "Too many files have matched the default
  // project"). Individual files linted fine, which is exactly why the gap went
  // unnoticed and why root tooling had no lint task at all. Same fix as e2e/
  // above: bind them to a dedicated scripts/tsconfig.json so type-aware rules
  // resolve, and drop scripts/* from allowDefaultProject.
  {
    files: ["scripts/**/*.ts", "scripts/**/*.mts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./scripts/tsconfig.json",
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

  // Plain-JavaScript tooling (.mjs/.cjs/.js). scripts/tsconfig.json sets
  // allowJs:true + checkJs:false, so TypeScript does not type-check these files and
  // every value is implicitly any. Running type-aware rules over them produced ~88
  // no-unsafe-* reports describing the ABSENCE of type information, not defects.
  // disableTypeChecked is typescript-eslint documented mechanism for this
  // subset-of-the-codebase case; upstream issue #9583 proposes making it the DEFAULT
  // for precisely this allowJs-without-checkJs configuration.
  //
  // MUST BE LAST (before prettier): disableTypeChecked only switches off the PRESET
  // type-aware rules. The Custom rule overrides block above re-enables several by
  // hand with no files scope, so when this block came first those rules were
  // reinstated on JS and ESLint CRASHED (rule requires type information, but
  // parserOptions are not set to generate it). The docs call this out: turn off
  // other type-aware rules explicitly. Hence the rules block below.
  //
  // explicit-function-return-type is off because a return-type annotation is not
  // expressible in plain JS, so the rule can never be satisfied there.
  //
  // Node globals are declared because the root config never set
  // languageOptions.globals. Only JS was affected: typescript-eslint disables
  // no-undef for .ts files, since TypeScript itself catches undefined identifiers.
  {
    files: ["**/*.mjs", "**/*.cjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },

  // Prettier must be last
  eslintConfigPrettier,
);
