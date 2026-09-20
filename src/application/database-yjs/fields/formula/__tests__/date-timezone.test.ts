/** @jest-environment node */
import { execFileSync } from 'child_process';
import path from 'path';

import { FormulaValue, num, text } from '../values';

const cases: Array<[string, FormulaValue]> = [
  ['formatDate(dateAdd(parseDate("2024-03-09T12:00:00"), 1, "days"), "YYYY-MM-DD HH:mm")', text('2024-03-10 12:00')],
  [
    'dateBetween(dateAdd(parseDate("2024-03-09T12:00:00"), 1, "days"), parseDate("2024-03-09T12:00:00"), "hours")',
    num(23),
  ],
  ['dateBetween(parseDate("2024-03-10T12:00:00"), parseDate("2024-03-09T12:00:00"), "days")', num(1)],
  ['formatDate(dateAdd(parseDate("2024-11-02T12:00:00"), 1, "days"), "YYYY-MM-DD HH:mm")', text('2024-11-03 12:00')],
  [
    'dateBetween(dateAdd(parseDate("2024-11-02T12:00:00"), 1, "days"), parseDate("2024-11-02T12:00:00"), "hours")',
    num(25),
  ],
  ['dateBetween(parseDate("2024-11-03T12:00:00"), parseDate("2024-11-02T12:00:00"), "days")', num(1)],
  ['formatDate(parseDate("2024-03-10T02:30:00"), "YYYY-MM-DD HH:mm")', text('2024-03-10 03:30')],
  ['timestamp(parseDate("2024-11-03T01:30:00"))', num(Date.parse('2024-11-03T01:30:00-04:00'))],
  ['timestamp(parseDate("2024-11-03T01:30:00-05:00"))', num(Date.parse('2024-11-03T01:30:00-05:00'))],
];

describe('formula dates in America/New_York', () => {
  let results: FormulaValue[];

  beforeAll(() => {
    // A separate process sets TZ before Date/dayjs initialize, without changing
    // the timezone of other Jest suites. It executes the production evaluator.
    const script = `
      const fs = require('fs');
      const ts = require('typescript');
      require.extensions['.ts'] = (module, filename) => {
        module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText, filename);
      };
      const { parseFormula } = require('./src/application/database-yjs/fields/formula/parser.ts');
      const { inferFormulaType } = require('./src/application/database-yjs/fields/formula/checker.ts');
      const { evaluateFormula } = require('./src/application/database-yjs/fields/formula/evaluator.ts');
      const results = JSON.parse(fs.readFileSync(0, 'utf8')).map(source => {
        const ast = parseFormula(source);
        inferFormulaType(ast, { getPropType: () => 'empty' });
        return evaluateFormula(ast, { getProp: () => ({ type: 'empty' }), now: () => 0 });
      });
      process.stdout.write(JSON.stringify(results));
    `;

    results = JSON.parse(
      execFileSync(process.execPath, ['-e', script], {
        cwd: path.resolve(__dirname, '../../../../../..'),
        env: { ...process.env, TZ: 'America/New_York' },
        input: JSON.stringify(cases.map(([expression]) => expression)),
        encoding: 'utf8',
        timeout: 10000,
      })
    );
  });

  it.each(cases.map(([expression, expected], index) => ({ expression, expected, index })))(
    'handles daylight-saving transitions: $expression',
    ({ expected, index }) => expect(results[index]).toEqual(expected)
  );
});
