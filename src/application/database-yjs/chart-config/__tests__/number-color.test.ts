import { loadParityFixture } from '../../__tests__/dashboard-parity-helpers';
import { NUMBER_COLOR_NAMES, parseNumberConditionalColor } from '../../chart-extended-settings';
import { createNumberColorRule, matchesNumberRule, NUMBER_COLOR_OPERATORS, resolveNumberColor } from '../number-color';

interface ColorCase {
  name: string;
  value: number | null;
  numberColor?: string;
  conditional?: unknown;
  expect: string | null;
}

const fixture = loadParityFixture<{
  chipOrder: string[];
  newRule: { operator: string; value: number; color: string; idPrefix: string };
  cases: ColorCase[];
}>('number-color.json');

describe('resolveNumberColor (dashboard-parity/number-color.json)', () => {
  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const conditional = entry.conditional === undefined ? null : parseNumberConditionalColor(entry.conditional);

    expect(resolveNumberColor(entry.value, entry.numberColor, conditional)).toBe(entry.expect);
  });

  it('lists the chips in the fixture order', () => {
    expect(NUMBER_COLOR_NAMES).toEqual(fixture.chipOrder);
  });

  it('seeds a new rule with the fixture defaults', () => {
    const { idPrefix, ...defaults } = fixture.newRule;

    expect(createNumberColorRule(`${idPrefix}abc`)).toEqual({ id: `${idPrefix}abc`, ...defaults });
  });
});

describe('matchesNumberRule', () => {
  it('never matches a non-finite rule value', () => {
    expect(matchesNumberRule(1, { operator: 'gt', value: Number.NaN })).toBe(false);
    expect(matchesNumberRule(1, { operator: 'lt', value: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('has a symbol and a label for every operator', () => {
    expect(NUMBER_COLOR_OPERATORS.map((operator) => operator.value)).toEqual(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);
    NUMBER_COLOR_OPERATORS.forEach((operator) => {
      expect(operator.symbol).toBeTruthy();
      expect(operator.labelKey).toMatch(/^chart\.numberColor\./);
    });
  });
});
