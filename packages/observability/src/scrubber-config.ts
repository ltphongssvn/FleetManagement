// packages/observability/src/scrubber-config.ts
// Runtime-validated config for createScrubber. Catches dev typos (empty
// patterns, non-RegExp values) before they reach a redaction code path.
import { z } from 'zod';

const regexSchema = z.custom<RegExp>((v) => v instanceof RegExp, 'must be a RegExp');

export const scrubberConfigSchema = z
  .object({
    /** Max recursion depth before bailing. */
    depthLimit: z.number().int().min(0).max(50).optional(),
    /** Regex matching object keys whose values should be redacted. */
    piiKeyPattern: regexSchema.optional(),
    /** Header names (lowercase) whose values should be redacted. */
    piiHeaders: z.array(z.string().min(1)).optional(),
    /** Regexes that match PII substrings inside string values. */
    piiValuePatterns: z.array(regexSchema).optional(),
    /** Hook called when scrub catches a throw. */
    onScrubError: z.custom<(err: unknown) => void>((v) => typeof v === 'function').optional(),
  })
  .strict();

export type ScrubberConfig = z.infer<typeof scrubberConfigSchema>;

/**
 * Validate a config; throws ZodError on invalid input.
 * Returns the parsed config (which may have stripped extras due to .strict()).
 */
export function validateScrubberConfig(config: unknown): ScrubberConfig {
  return scrubberConfigSchema.parse(config);
}
