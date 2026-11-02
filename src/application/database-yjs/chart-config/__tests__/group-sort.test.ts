import { loadParityFixture } from '../../__tests__/dashboard-parity-helpers';
import { CHART_X_SORTS, ChartXSort } from '../../chart-extended-settings';
import { EMPTY_GROUP_KEY } from '../group-keys';
import { compareChartLabels, sortChartGroups } from '../group-sort';

import { decodeHint } from './fixture-helpers';

jest.mock('@/utils/normalize-text', () => {
  const actual = jest.requireActual<typeof import('@/utils/normalize-text')>('@/utils/normalize-text');

  return { ...actual, normalizeDashboardText: jest.fn(actual.normalizeDashboardText) };
});

const normalizeMock = jest.requireMock('@/utils/normalize-text').normalizeDashboardText as jest.Mock;

interface SortCase {
  name: string;
  xSort: ChartXSort;
  manualOrder?: string[];
  groups: { key: string; label: string; hint: { rank?: number | string; tie?: string; label?: boolean }; value?: number }[];
  expect: string[];
}

const fixture = loadParityFixture<{ sort: SortCase[]; labelCompare: [string, string, number][] }>('group-keys.json');

describe('sortChartGroups (dashboard-parity/group-keys.json#sort)', () => {
  it.each(fixture.sort.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const groups = entry.groups.map((group) => ({ ...group, hint: decodeHint(group.hint) }));

    expect(sortChartGroups(groups, entry.xSort, entry.manualOrder).map((group) => group.key)).toEqual(entry.expect);
  });

  it.each(CHART_X_SORTS.map((sort) => [sort]))('puts the empty group last for %s', (sort) => {
    const groups = [
      { key: EMPTY_GROUP_KEY, label: 'A', hint: { rank: -1 }, value: 100 },
      { key: 'o-b', label: 'B', hint: { rank: 1 }, value: 1 },
      { key: 'o-a', label: 'Z', hint: { rank: 0 }, value: 2 },
    ];

    expect(sortChartGroups(groups, sort, [EMPTY_GROUP_KEY]).at(-1)?.key).toBe(EMPTY_GROUP_KEY);
  });

  it('does not change its input', () => {
    const groups = [
      { key: 'b', label: 'b', hint: { label: true as const } },
      { key: 'a', label: 'a', hint: { label: true as const } },
    ];

    sortChartGroups(groups, 'auto');
    expect(groups.map((group) => group.key)).toEqual(['b', 'a']);
  });

  it.each(CHART_X_SORTS.map((sort) => [sort]))('normalizes each label once per %s sort, not once per comparison', (sort) => {
    // Exact-text groups over thousands of distinct values: a label sort compares O(n log n) pairs.
    const groups = Array.from({ length: 1000 }, (_, index) => ({
      key: `t:${index}`,
      label: `Étiquette ${(index * 7919) % 1000}`,
      hint: { label: true as const },
      value: (index * 31) % 97,
    }));

    normalizeMock.mockClear();
    const sorted = sortChartGroups(groups, sort, ['t:5', 't:3']);

    expect(sorted).toHaveLength(groups.length);
    expect(normalizeMock).toHaveBeenCalledTimes(groups.length);
    if (sort === 'label_asc') {
      expect(sorted.map((group) => group.label)).toEqual([...groups.map((group) => group.label)].sort(compareChartLabels));
    }
  });
});

describe('compareChartLabels (dashboard-parity/group-keys.json#labelCompare)', () => {
  it.each(fixture.labelCompare)('%p vs %p', (a, b, sign) => {
    expect(Math.sign(compareChartLabels(a, b))).toBe(sign);
  });
});
