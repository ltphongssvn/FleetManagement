// packages/codemods/src/transforms/extract-parse-one-number.ts
// Project-level codemod: extract parseOneNumber out of whatever origin file defines it into
// a dedicated @fleet/domain module (packages/domain/src/number-format/parse-one-number.ts),
// re-export it from the domain barrel, and rewrite the origin to import it from
// '@fleet/domain'. The extracted module's content is derived from the relocated function.
// Idempotent: a no-op once parseOneNumber no longer lives outside @fleet/domain.
import { type Project } from 'ts-morph';
import { type ProjectChange } from '../contracts.js';

const TARGET = 'parseOneNumber';
const DOMAIN_SEGMENT = '/packages/domain/';
const DOMAIN_BARREL_SUFFIX = '/packages/domain/src/index.ts';
const MODULE_RELATIVE = './number-format/parse-one-number.js';
const DOMAIN_SPECIFIER = '@fleet/domain';

export function extractParseOneNumber(project: Project): readonly ProjectChange[] {
  const origin = project
    .getSourceFiles()
    .find(
      (sf) => !sf.getFilePath().includes(DOMAIN_SEGMENT) && sf.getFunction(TARGET) !== undefined,
    );
  if (origin === undefined) {
    return [];
  }

  const barrel = project
    .getSourceFiles()
    .find((sf) => sf.getFilePath().endsWith(DOMAIN_BARREL_SUFFIX));
  if (barrel === undefined) {
    throw new Error(
      'extract-parse-one-number: @fleet/domain barrel (packages/domain/src/index.ts) not found in project',
    );
  }

  const fn = origin.getFunctionOrThrow(TARGET);
  const fnText = fn.getText();
  const modulePath = barrel.getDirectoryPath() + '/number-format/parse-one-number.ts';
  const header = '// packages/domain/src/number-format/parse-one-number.ts\n';
  const moduleFile = project.createSourceFile(modulePath, header + fnText + '\n', {
    overwrite: true,
  });
  moduleFile.getFunctionOrThrow(TARGET).setIsExported(true);

  barrel.addExportDeclaration({ moduleSpecifier: MODULE_RELATIVE });

  fn.remove();
  origin.insertImportDeclaration(0, { namedImports: [TARGET], moduleSpecifier: DOMAIN_SPECIFIER });

  return [
    { filePath: moduleFile.getFilePath(), change: 'created' },
    { filePath: barrel.getFilePath(), change: 'modified' },
    { filePath: origin.getFilePath(), change: 'modified' },
  ];
}
