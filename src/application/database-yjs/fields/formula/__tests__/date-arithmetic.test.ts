import dayjs from 'dayjs';

import { inferFormulaType } from '../checker';
import { evaluateFormula } from '../evaluator';
import { parseFormula } from '../parser';
import { bool, date, EMPTY, num } from '../values';

const NOW = dayjs('2026-11-09T12:00:00').valueOf();
const MIDNIGHT = dayjs(NOW).startOf('day').valueOf();

function run(expression: string) {
  const ast = parseFormula(expression);

  inferFormulaType(ast, { getPropType: () => 'empty' });
  return evaluateFormula(ast, { getProp: () => EMPTY, now: () => NOW });
}

describe.each([
  ['dateAdd', 1],
  ['dateSubtract', -1],
] as const)('%s date precision', (fn, sign) => {
  it.each([
    ['hour', 3_600_000],
    ['hours', 3_600_000],
    ['minute', 60_000],
    ['minutes', 60_000],
    ['second', 1_000],
    ['seconds', 1_000],
  ] as const)('retains explicit %s in comparisons and list operations', (unit, milliseconds) => {
    const first = `${fn}(today(), 1, "${unit}")`;
    const second = `${fn}(today(), 2, "${unit}")`;

    expect(run(`${first} ${sign === 1 ? '<' : '>'} ${second}`)).toEqual(bool(true));
    expect(run(`${first} == ${second}`)).toEqual(bool(false));
    expect(run(`length(unique([${first}, ${second}]))`)).toEqual(num(2));
    expect(run(first)).toEqual(date({ start: MIDNIGHT + sign * milliseconds, includeTime: true }));
  });

  it('shifts both range endpoints with time precision', () => {
    const range = 'dateRange(parseDate("2026-11-09"), parseDate("2026-11-11"))';

    expect(run(`${fn}(${range}, 1, "hours") == ${fn}(${range}, 2, "hours")`)).toEqual(bool(false));
    expect(run(`${fn}(${range}, 1, "hours")`)).toEqual(
      date({
        start: MIDNIGHT + sign * 3_600_000,
        end: dayjs('2026-11-11').valueOf() + sign * 3_600_000,
        includeTime: true,
      })
    );
  });

  it.each(['days', 'weeks', 'months', 'quarters', 'years'])('keeps %s arithmetic date-only', (unit) => {
    const expected = dayjs(MIDNIGHT).add(sign, unit as dayjs.ManipulateType);

    expect(run(`${fn}(today(), 1, "${unit}")`)).toEqual(date({ start: expected.valueOf(), includeTime: false }));
    expect(run(`${fn}(parseDate("2026-11-09T08:30:00"), 1, "${unit}")`)).toEqual(
      date({ start: expected.hour(8).minute(30).valueOf(), includeTime: true })
    );
  });
});
