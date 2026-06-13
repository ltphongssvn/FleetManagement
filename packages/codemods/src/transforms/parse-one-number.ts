// packages/codemods/src/transforms/parse-one-number.ts
// parse-one-number codemod: promote the private `parseOneNumber` function declaration
// to an EXPORTED declaration so its Vietnamese number-format rules become directly
// unit-testable/auditable. Reference-safe AST edit via ts-morph (vs fragile text
// replacement): locate the FunctionDeclaration by name, set the export modifier.
// Idempotent: a no-op when the target is absent or already exported.
import { type SourceFile } from 'ts-morph';
import { type TransformOutcome } from '../contracts.js';

const TARGET = 'parseOneNumber';

export function transformParseOneNumber(sourceFile: SourceFile): TransformOutcome {
  const fn = sourceFile.getFunction(TARGET);
  if (fn === undefined || fn.isExported()) return { changed: false };
  fn.setIsExported(true);
  return { changed: true };
}
