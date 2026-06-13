// packages/codemods/src/registry.ts
// Single source of truth for the codemods available to the CLI: name, human-readable
// description, kind, and the transform implementation. Powers CLI dispatch, the --list
// flag, and the transform-name enum (cli-options imports TRANSFORM_NAMES from here).
import { type SourceFile } from 'ts-morph';
import { type TransformOutcome } from './contracts.js';
import { transformParseOneNumber } from './transforms/parse-one-number.js';

export const TRANSFORM_NAMES = ['parse-one-number'] as const;
export type TransformName = (typeof TRANSFORM_NAMES)[number];

export interface PerFileCodemod {
  readonly kind: 'per-file';
  readonly name: TransformName;
  readonly description: string;
  readonly transform: (sourceFile: SourceFile) => TransformOutcome;
}

export type Codemod = PerFileCodemod;

export const CODEMODS: readonly Codemod[] = [
  {
    kind: 'per-file',
    name: 'parse-one-number',
    description: 'Promote the private parseOneNumber function to an exported declaration.',
    transform: transformParseOneNumber,
  },
];

export function getCodemod(name: string): Codemod | undefined {
  return CODEMODS.find((c) => c.name === name);
}

export function formatCodemodList(): string {
  return CODEMODS.map((c) => c.name + '  [' + c.kind + ']  ' + c.description).join('\n');
}
