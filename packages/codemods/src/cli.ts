#!/usr/bin/env node
// packages/codemods/src/cli.ts
// fleet-codemods CLI entrypoint: --list prints the registered codemods; otherwise parse +
// Zod-validate argv, build a ts-morph Project from the tsconfig, run the named transform
// across it via the orchestrator, print the JSON summary, and exit non-zero on per-file
// errors.
import { Project } from 'ts-morph';
import { parseCliArgs } from './cli-options.js';
import { runCodemod } from './orchestrator.js';
import { getCodemod, formatCodemodList } from './registry.js';

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    process.stdout.write(formatCodemodList() + '\n');
    return;
  }
  const options = parseCliArgs(argv);
  const codemod = getCodemod(options.transform);
  if (codemod === undefined) {
    throw new Error('No codemod registered for ' + options.transform);
  }
  const project = new Project({ tsConfigFilePath: options.tsConfigFilePath });
  const result = runCodemod({ project, transform: codemod.transform, dryRun: options.dryRun });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.errored > 0) {
    process.exitCode = 1;
  }
}

main();
