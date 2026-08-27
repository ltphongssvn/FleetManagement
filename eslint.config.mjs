// ============================================================================
// File:     FleetManagement/eslint.config.mjs
// Purpose:  Root ESLint flat config (v9+) for the FleetManagement monorepo.
// Rationale: See docs/adr/001-turborepo-pipeline.md for lint decisions.
// Related:  .prettierrc, turbo.jsonc, .pre-commit-config.yaml
// ============================================================================

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import vitest from '@vitest/eslint-plugin';

export default tseslint.config(
  // Global ignores — use **/pattern for nested workspace matches
  {
    ignores: [
      'apps/driver-app/metro.config.js',
      'apps/owner-app/metro.config.js',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/.stryker-tmp/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/*.tsbuildinfo',
      'pnpm-lock.yaml',
      '**/postcss.config.mjs',
      '**/next-env.d.ts',
      '**/drizzle.config.ts',
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
            '*.config.ts',
            '*.config.mjs',
            'vitest.config.ts',
            'vitest.integration.config.ts',
            'vitest.coverage.config.ts',
          ],
          defaultProject: 'tsconfig.base.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Test files: relax some rules that don't apply to tests; enable vitest hygiene
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    plugins: { vitest },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-identical-title': 'error',
      // assertFunctionNames extends the rule's notion of "an assertion" to
      // custom helpers, which is the documented mechanism rather than a
      // per-file eslint-disable. expectRefused narrows a discriminated union
      // BEFORE reading its payload: writing expect(d.reason) inline against
      // BootstrapDecision is a type error, and a cast would assert the shape
      // the author expected while narrowing PROVES it. Without this entry the
      // rule reports "Test has no assertions" for every refusal case -- a false
      // positive that pressures the author to inline the cast and lose the
      // proof, which is exactly how a sound guard gets switched off.
      'vitest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'expectTypeOf', 'fc.assert', 'expectRefused'] },
      ],
      // maxArgs: 2 because VITEST -- unlike Jest -- supports a second argument to
      // expect() carrying a custom failure message: expect(value, "why").toBe(x).
      // The rule's minArgs/maxArgs both default to 1, the count vanilla Jest
      // expect supports, so the default configuration reports every Vitest
      // message argument as "Expect takes at most 1 argument". That is a known
      // false positive for Vitest (vitest-dev/eslint-plugin-vitest#503, fixed in
      // PR #518; oxc-project/oxc#18851 tracks the same gap in oxlint), and the
      // options exist precisely for runtimes whose expect takes more arguments.
      //
      // WHY THIS MATTERS HERE RATHER THAN BEING WAIVED. The guard specs under
      // scripts/*.guard.test.ts carry their diagnostics in that argument: a
      // guard that fails without naming the offending package, subpath and
      // condition costs the next reader an investigation. Dropping the messages
      // to satisfy a false positive would degrade every guard in the repo to
      // "expected false to be true". Verified working: the messages appear in
      // full during mutation verification of the RN-resolution guard.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
    },
  },
  // e2e specs live under e2e/ and are NOT in any app/package tsconfig include,
  // so the root projectService (defaultProject: tsconfig.base.json, which does
  // not include them) cannot bind them -> "was not found by the project
  // service" parse error. Bind e2e files to e2e/tsconfig.json (include: **/*.ts)
  // so type-aware rules resolve them.
  {
    files: ['e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './e2e/tsconfig.json',
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
    files: ['scripts/**/*.ts', 'scripts/**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './scripts/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // LINT-AS-ARCHITECTURE: E2E timing budgets live in ONE module, never in a spec.
  //
  // THE DEFECT THIS PREVENTS, with receipts. Six spec files each declared their
  // own `const ROW_VISIBILITY_BUDGET_MS = 15_000`, copy-pasted. That is why a
  // July budget raise on the khachhang specs healed nothing: the other four kept
  // their own copies and kept failing, and the same seeded-row flake recurred
  // across five-plus sessions (2026-08-02, 08-06 on PR #505, 08-08 on PR #532),
  // alternating between dispatch-board-driver-vehicle-display and
  // manual-net-weight-entry.
  //
  // Raising a budget was never the fix -- the root cause is an unwaited
  // read-model hop, and helpers/wait-for-projection.ts is the answer (see PR
  // #514). But the DUPLICATION is what made the treadmill possible: it
  // guaranteed that even a correct change could only reach one caller at a time.
  //
  // A comment in a helper is documentation, which people do not read, and a
  // review note is reactive and inconsistent. Encoding it as a rule turns the
  // architectural decision into a machine-checked constraint that fails the
  // build -- caught at CI time, not weeks later in production. AST selector, not
  // a text match: `const ROW_VISIBILITY_BUDGET_MS` in a comment must not trip
  // this, and a rename to any other budget-shaped identifier must still trip it.
  //
  // The message is written as an instruction, because it is the first thing the
  // next author reads when they trip it.
  //
  // NAMED EXACTLY, and the precision was earned. The first draft matched
  // /_BUDGET_MS$/ -- any budget-shaped identifier -- and immediately flagged
  // RECOVERY_BUDGET_MS in dispatch-order-button-state-recovery.spec.ts. That
  // constant is NOT a row-visibility budget: it bounds how long the create
  // drawer may take to close after submit, which is that spec's own business
  // invariant. Forcing it through the SSOT would have renamed a drawer-close
  // budget into a row-visibility one and coupled two unrelated invariants --
  // the same collapsing of distinct meanings that keeping
  // OPTIMISTIC_RENDER_BUDGET_MS separate from ROW_VISIBILITY_BUDGET_MS exists
  // to prevent.
  //
  // This is the documented failure mode of lint-as-architecture: a rule that
  // flags legitimate uses generates false positives and gets DISABLED, and a
  // guard developers switch off protects nothing. The remedy is to state the
  // forbidden pattern precisely rather than to carve per-file
  // eslint-disable escapes, which ESLint itself says must not be the default
  // way to resolve a violation.
  //
  // MAINTENANCE COST, accepted knowingly: naming the constants means a THIRD
  // budget added to helpers/budgets.ts must be added to this selector too, or
  // the rule silently stops covering it. That is the trade for not flagging
  // correct code.
  {
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'VariableDeclarator[id.name=/^(ROW_VISIBILITY_BUDGET_MS|OPTIMISTIC_RENDER_BUDGET_MS)$/]',
          message:
            'E2E timing budgets are declared once in e2e/helpers/budgets.ts -- ' +
            'import ROW_VISIBILITY_BUDGET_MS or OPTIMISTIC_RENDER_BUDGET_MS ' +
            'instead of declaring a per-spec copy. Six copies of this constant ' +
            'are why the seeded-row flake survived a budget raise. If an ' +
            'assertion needs a LARGER budget to pass, it is racing an async ' +
            'pipeline: call settleBoardAfterCreate from helpers/wait-for-projection ' +
            'before asserting a server-derived field, rather than waiting longer.',
        },
      ],
    },
  },

  // LINT-AS-ARCHITECTURE: a package barrel publishes a NAMED surface, never `*`.
  //
  // THE DEFECT THIS PREVENTS, with receipts. packages/sync-protocol/src/index.ts
  // opens with "Named exports only (no wildcard re-export) to prevent namespace
  // pollution" -- and then carried two wildcards anyway, order-timeline-contract
  // (introduced by 8bbec76 and never revisited) and device-binding-contract. A
  // convention stated in a comment is documentation, and documentation does not
  // fail a build. Both were known: a July session recorded the first as "a
  // pre-existing deviation, recorded in the audit ledger, not a license", which
  // is precisely how debt survives -- acknowledged, then carried.
  //
  // WHY IT MATTERS BEYOND STYLE. A star re-export republishes whatever the module
  // happens to export, so the barrel stops being the authority on the public
  // surface: a new internal helper becomes public API by accident, and every
  // static-analysis tool has to guess. That is the stated rationale of the
  // upstream proposal for this exact rule (import-js/eslint-plugin-import#2493:
  // "export * breaks static analysis"), which was never shipped -- the plugin
  // has no-namespace for wildcard IMPORTS only. Bundler cost is measured too:
  // 2026 barrel benchmarks put the star form at a large server-side penalty
  // against the named form.
  //
  // AST SELECTOR, NOT TEXT MATCHING, and this file already learned that lesson
  // twice (the budget and process.env rules below/above). It also matters here
  // concretely: the barrel's own explanatory comments discuss wildcards in
  // prose, and a grep-based guard would flag the comment that explains why the
  // wildcard is gone. ExportAllDeclaration matches the STATEMENT and nothing
  // else.
  //
  // SCOPED TO PACKAGE BARRELS. A wildcard inside a package's internals is a
  // different judgment call and is not what this rule is about; firing on it
  // would be the false-positive that gets a rule disabled.
  {
    files: ['packages/*/src/index.ts', 'apps/*/src/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message:
            'A package barrel publishes a NAMED surface: list the symbols ' +
            "explicitly instead of `export * from './module.js'`. A wildcard " +
            'republishes whatever that module exports, so the barrel stops being ' +
            'the authority on what is public -- a new internal helper becomes API ' +
            'by accident, dead-export analysis cannot see the surface, and ' +
            'bundlers lose the named form they tree-shake best.',
        },
      ],
    },
  },

  // Two import bans for production source, in ONE rule entry on purpose.
  //
  // Flat config REPLACES rule options rather than merging them, so a second
  // config object with an overlapping files scope would silently switch the
  // first ban off. A separate block for the barrel rule did exactly that in
  // draft -- it would have disabled the test-import ban for every file it
  // covered while looking like an addition.
  //
  // (1) TEST IMPORTS IN PRODUCTION CODE. Unchanged.
  //
  // (2) A PACKAGE SOURCE FILE IMPORTING ITS OWN BARREL. apps/driver-app/src had
  // two: notification-setup-native.ts and native-bootstrap.ts both imported the
  // very barrel that re-exports them, which is a cycle by construction -- the
  // documented way barrel cycles start. native-bootstrap.ts showed the
  // incoherence inside ONE file: its static imports went through the barrel
  // while its dynamic imports four lines below named the same neighbourhood
  // directly. It also degrades analysis: a barrel is the package's PUBLIC
  // surface, so when internals consume it every internal symbol looks
  // externally used.
  //
  // regex, NOT group. group patterns are gitignore-style, and a specifier like
  // '../index.js' opens with a dot segment that wildcard matching does not
  // treat as an ordinary path part -- a '**/index.js' group silently matched
  // nothing, and the rule passed while the violation sat in the tree. regex is
  // the documented alternative for exactly this and cannot be combined with
  // group in the SAME pattern object, hence two objects.
  //
  // TESTS ARE EXEMPT by the files scope (src only). A test importing the barrel
  // is a CONSUMER exercising the public surface; constants.test.ts exists to
  // assert precisely that the barrel resolves.
  {
    files: ['apps/*/src/**/*.ts', 'workers/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vitest', '**/test/**', '@fleet/test-fixtures'],
              message: 'Test imports are forbidden in production code',
            },
            {
              // ANCESTOR barrels only: './index.js', '../index.js',
              // '../../index.js'. NOT a barrel BELOW this file --
              // packages/domain/src/index.ts legitimately aggregates
              // './identity/index.js' and './transport/index.js', which is the
              // intended sub-barrel hierarchy and closes no cycle, because a
              // sub-barrel never re-exports the root. The first draft banned any
              // relative specifier ending in index.js and flagged exactly those
              // two correct lines -- the false positive that gets a rule
              // disabled, which this config documents three times over.
              regex: '^[.][.]?(/[.][.])*/index[.](js|ts)$',
              message:
                'Import the sibling module directly, not your own package barrel. ' +
                'The barrel re-exports this file, so importing it back is a cycle ' +
                'by construction -- and it makes every internal symbol look like ' +
                'public API to dead-code analysis. Tests may import the barrel; ' +
                'source may not.',
            },
          ],
        },
      ],
    },
  },

  // Forbid raw process.env inside Nest MODULES: configuration must come through
  // the validated boundary (ConfigService over EnvSchema), never the raw object.
  //
  // THE DEFECT THIS PREVENTS. eas-inbound.module.ts read
  //   new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", ...)
  // while its sibling auth.module.ts read
  //   config.getOrThrow("REDIS_URL")
  // Two faults in one line: the raw read skips the z.url() validation
  // env.config.ts performs at the trust boundary, and it restates a default
  // that schema already owns. A malformed REDIS_URL passed silently, and a
  // misconfigured production would quietly dial localhost instead of failing.
  //
  // AST SELECTORS, NOT TEXT MATCHING. A grep-style guard false-positives on the
  // words "process.env" in a comment and false-negatives on process["env"].
  // Both member-access forms are matched here: property.name for dot access,
  // property.value for the computed form.
  //
  // SCOPED TO *.module.ts ON PURPOSE. Legitimate raw readers exist and must
  // keep working: observability/*-bootstrap.ts runs via `node --import` BEFORE
  // the Nest container exists, and src/scripts/* are standalone CLI entrypoints
  // with no DI container. A blanket ban would fire on correct code, which is
  // how a rule earns a blanket eslint-disable.
  {
    files: ['apps/*/src/**/*.module.ts', 'workers/*/src/**/*.module.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Read config via ConfigService (validated by EnvSchema), not raw process.env.',
        },
        {
          selector: "MemberExpression[object.name='process'][property.value='env']",
          message: 'Read config via ConfigService (validated by EnvSchema), not raw process.env.',
        },
      ],
    },
  },

  // A NestJS MODULE class is a decorator carrier with no members BY DESIGN.
  // no-extraneous-class exists to stop people wrapping utility functions in a
  // class instead of using a module -- a real defect, and the rule stays on
  // everywhere else. It cannot know that @Module() classes are the framework's
  // own unit of composition, so it fires on every correct one.
  //
  // allowWithDecorator IS THE RULE'S OWN ANSWER, not a workaround: the option
  // exists precisely to exempt decorated classes. Using it removes the whole
  // category instead of adding one eslint-disable per module -- and AppModule
  // already carried such a comment, which is exactly how the treadmill starts:
  // every new module copies it, and nobody ever revisits whether the rule
  // should have been configured.
  //
  // This config's own lint-as-architecture note says it plainly: state the
  // forbidden pattern precisely rather than carve per-file escapes, which
  // ESLint itself says must not be the default way to resolve a violation.
  //
  // SCOPED TO *.module.ts, not global: a decorated class elsewhere (a
  // @Injectable() with no members, say) is still worth reporting.
  {
    files: ['apps/*/src/**/*.module.ts', 'workers/*/src/**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },

  // Custom rule overrides
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
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
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  // Prettier must be last
  eslintConfigPrettier,
);
