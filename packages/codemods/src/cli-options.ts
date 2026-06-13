// packages/codemods/src/cli-options.ts
// Zod-validated CLI options for fleet-codemods. The transform name is constrained to the
// registered set (TRANSFORM_NAMES from the registry); parseCliArgs turns argv into a
// validated CliOptions, throwing a ZodError on an unknown or missing transform. --include
// <glob> is repeatable and accumulates extra source globs (in order) so a project-kind
// codemod can span packages beyond the origin tsconfig (e.g. pulling @fleet/domain source
// in alongside the worker so the barrel is real source, not just a .d.ts).
import { z } from 'zod';
import { TRANSFORM_NAMES } from './registry.js';

export const CliOptionsSchema = z
  .object({
    transform: z.enum(TRANSFORM_NAMES),
    tsConfigFilePath: z.string().min(1),
    dryRun: z.boolean(),
    include: z.array(z.string().min(1)),
  })
  .strict();

export type CliOptions = z.infer<typeof CliOptionsSchema>;

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let transform: string | undefined;
  let tsConfigFilePath = 'tsconfig.json';
  let dryRun = false;
  const include: string[] = [];
  let expect: 'tsconfig' | 'include' | undefined;
  for (const arg of argv) {
    if (expect === 'tsconfig') {
      tsConfigFilePath = arg;
      expect = undefined;
    } else if (expect === 'include') {
      include.push(arg);
      expect = undefined;
    } else if (arg === '--dry' || arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--tsconfig' || arg === '--project') {
      expect = 'tsconfig';
    } else if (arg === '--include') {
      expect = 'include';
    } else {
      transform = arg;
    }
  }
  return CliOptionsSchema.parse({ transform, tsConfigFilePath, dryRun, include });
}
