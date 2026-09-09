import {
  createNumberGroupingPolicy,
  defaultNumberGroupConfiguration,
  getNumberGroupLabel,
  NumberGroupMode,
  parseNumberGroupCell,
  parseNumberGroupConfiguration,
  validateNumberGroupConfiguration,
} from '../number-grouping';

const content = (overrides = {}) => JSON.stringify({ ...defaultNumberGroupConfiguration(NumberGroupMode.Range), ...overrides });

describe('desktop numeric grouping compatibility', () => {
  it('keeps old hide-only settings in Legacy mode and normalizes explicit decimal configuration', () => {
    expect(parseNumberGroupConfiguration('{"hide_empty":true}')).toEqual({ ...defaultNumberGroupConfiguration(), hide_empty: true });
    expect(parseNumberGroupConfiguration(content({ range_start: '-0.00', range_end: '+100.00', range_interval: '10.0' })))
      .toEqual(defaultNumberGroupConfiguration(NumberGroupMode.Range));
    expect(parseNumberGroupConfiguration(content({ mode: 99 }))).toEqual(defaultNumberGroupConfiguration());
  });

  it.each([
    ['0', 'number_interval_0_10'], ['9.999', 'number_interval_0_10'],
    ['10', 'number_interval_10_20'], ['99.99', 'number_interval_closed_90_100'],
    ['100', 'number_interval_closed_90_100'], ['-0.001', 'number_below_0'],
    ['100.001', 'number_above_100'], ['', null], ['invalid', null],
  ])('groups %s using lower-inclusive intervals and an inclusive final end', (value, id) => {
    expect(createNumberGroupingPolicy(content()).groupIdForCell(value)).toBe(id);
  });

  it('keeps empty intervals and both overflow groups with decimal, nondivisible bounds', () => {
    const policy = createNumberGroupingPolicy(content({ range_start: '-0.5', range_end: '0.6', range_interval: '0.5' }));

    expect(policy.configuredGroupIds()).toEqual([
      'number_below_-0.5', 'number_interval_-0.5_0', 'number_interval_0_0.5',
      'number_interval_closed_0.5_0.6', 'number_above_0.6',
    ]);
    expect(policy.groupIdForCell('0.6')).toBe('number_interval_closed_0.5_0.6');
    expect(policy.groupIdForCell('-0.0000000000000000000000000001')).toBe('number_interval_-0.5_0');
    expect(policy.retainsEmptyGroups).toBe(true);
    expect(policy.configuredGroupIds().map((id) => policy.valueForGroup(id))).toEqual(['-1', '-0.5', '0', '0.5', '1.1']);
    policy.configuredGroupIds().forEach((id) => expect(policy.groupIdForCell(policy.valueForGroup(id))).toBe(id));
  });

  it('normalizes numeric equality and sorts exact groups beyond JS integer precision', () => {
    const policy = createNumberGroupingPolicy(content({ mode: NumberGroupMode.Exact, sort_descending: true }));

    expect(['1', '1.00', '01.0'].map(policy.groupIdForCell)).toEqual(Array(3).fill('number_value_1'));
    expect(policy.groupIdForCell('-0.0')).toBe('number_value_0');
    expect(policy.groupIdForCell('')).toBeNull();
    expect(['number_value_2', 'number_value_9007199254740993', 'number_value_10', 'number_value_9007199254740992', 'number_value_-2']
      .sort(policy.compareGroupIds)).toEqual(['number_value_9007199254740993', 'number_value_9007199254740992', 'number_value_10', 'number_value_2', 'number_value_-2']);
    expect(policy.configuredGroupIds()).toEqual([]);
    expect(policy.valueForGroup('number_value_1.00')).toBeUndefined();
    expect(policy.valueForGroup('number_value_-0.5')).toBe('-0.5');
    expect(policy.valueForGroup('number_interval_0_10')).toBeUndefined();
  });

  it('preserves legacy fixed-100 identities, including the smallest negative decimal', () => {
    const policy = createNumberGroupingPolicy();

    expect(policy.groupIdForCell('-0.0000000000000000000000000001')).toBe('number_range_-100_0');
    expect(policy.groupIdForCell('100')).toBe('number_range_100_200');
    expect(policy.valueForGroup('number_range_-100_0')).toBe('-100');
    expect(policy.isValidGroupId('number_range_5_105')).toBe(false);
  });

  it.each([
    [{ range_start: '' }, 'invalidNumber'], [{ range_start: ' 0' }, 'invalidNumber'],
    [{ range_end: '1e2' }, 'invalidNumber'], [{ range_end: '1_000' }, 'invalidNumber'],
    [{ range_interval: '0.00000000000000000000000000001' }, 'invalidNumber'],
    [{ range_start: '100' }, 'invalidBounds'], [{ range_interval: '0' }, 'invalidInterval'],
    [{ range_interval: '-1' }, 'invalidInterval'], [{ range_interval: '0.01' }, 'tooManyRanges'],
    [{ range_start: '79228162514264337593543950333', range_end: '79228162514264337593543950335', range_interval: '1' }, 'precisionExceeded'],
    [{ range_start: '7922816251426433759354395032', range_end: '7922816251426433759354395033', range_interval: '0.01' }, 'precisionExceeded'],
  ])('rejects invalid configuration %j with a stable error', (overrides, error) => {
    expect(validateNumberGroupConfiguration({ ...defaultNumberGroupConfiguration(NumberGroupMode.Range), ...overrides }))
      .toEqual({ valid: false, error });
  });

  it('allows exactly 1000 intervals and retains the range settings in Exact mode', () => {
    const configuration = { ...defaultNumberGroupConfiguration(NumberGroupMode.Exact), range_interval: '0.1' };

    expect(validateNumberGroupConfiguration(configuration)).toEqual({ valid: true, configuration });
    expect(createNumberGroupingPolicy(content({ range_interval: '0.1' })).configuredGroupIds()).toHaveLength(1002);
  });

  it.each([
    ['number_value_-0.5', '-0.5'], ['number_interval_-0.5_0', '-0.5–<0'],
    ['number_interval_closed_90_100', '90–100'], ['number_below_0', 'Below 0'],
    ['number_above_100', 'Above 100'], ['number_range_-100_0', '-100 to 0'],
  ])('labels %s without rounding', (id, label) => expect(getNumberGroupLabel(id)).toBe(label));

  it.each([
    ['1e3', '1000'], ['1E3', '1'], ['12abc', '12'], ['1,000', '1'],
    ['-.2', '2'], ['.2', '0.2'], ['-$0.2', '0.2'], ['0.5%', '0.5'],
    ['$1.234', '1.234'], ['prefix1e3', null], ['1e-29', null], ['0e29', null],
    ['1.0000000000000000000000000000e-1', null],
    ['0.00000000000000000000000000005', '0.0000000000000000000000000001'],
    ['79228162514264337593543950335', '79228162514264337593543950335'],
    ['79228162514264337593543950335.4', '79228162514264337593543950335'],
    ['79228162514264337593543950335.5', null],
    ['79228162514264337593543950336', null],
    [1, null], [null, null], [undefined, null],
  ])('matches desktop raw-cell parsing for %j', (raw, expected) => expect(parseNumberGroupCell(raw)).toBe(expected));
});
