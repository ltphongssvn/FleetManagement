#!/usr/bin/env node
// packages/codemods/src/cli.ts
// fleet-codemods CLI entrypoint: parse + Zod-validate argv, build a ts-morph Project from
// the tsconfig, run the named transform across it via the orchestrator, print the JSON
// summary, and exit non-zero if any file errored.
import { Project } from 'ts-morph';
import { parseCliArgs } from './cli-options.js';
import { runCodemod, type Transform } from './orchestrator.js';
import { transformParseOneNumber } from './transforms/parse-one-number.js';

const REGISTRY: Readonly<Record<string, Transform>> = {
  'parse-one-number': transformParseOneNumber,
};

function main(): void {
  const options = parseCliArgs(process.argv.slice(2));
  const transform = REGISTRY[options.transform];
  if (transform === undefined) {
    throw new Error('No transform registered for ' + options.transform);
  }
  const project = new Project({ tsConfigFilePath: options.tsConfigFilePath });
  const result = runCodemod({ project, transform, dryRun: options.dryRun });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.errored > 0) {
    process.exitCode = 1;
  }
}

main();
