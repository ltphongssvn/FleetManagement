// packages/codemods/src/cli-options.ts
// Zod-validated CLI options for fleet-codemods. The transform name is constrained to the
// registered set; parseCliArgs turns argv into a validated CliOptions, throwing a
// ZodError on an unknown or missing transform.
import { z } from 'zod';

export const TRANSFORM_NAMES = ['parse-one-number'] as const;

export const CliOptionsSchema = z
  .object({
    transform: z.enum(TRANSFORM_NAMES),
    tsConfigFilePath: z.string().min(1),
    dryRun: z.boolean(),
  })
  .strict();

export type CliOptions = z.infer<typeof CliOptionsSchema>;

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let transform: string | undefined;
  let tsConfigFilePath = 'tsconfig.json';
  let dryRun = false;
  let expectTsConfig = false;
  for (const arg of argv) {
    if (expectTsConfig) {
      tsConfigFilePath = arg;
      expectTsConfig = false;
    } else if (arg === '--dry' || arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--tsconfig' || arg === '--project') {
      expectTsConfig = true;
    } else {
      transform = arg;
    }
  }
  return CliOptionsSchema.parse({ transform, tsConfigFilePath, dryRun });
}
