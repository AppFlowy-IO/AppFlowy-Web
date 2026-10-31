import { ChartType } from '../../chart-enums';
import { AggregatedChartGroup, ChartPresentConfig, presentChartGroups } from '../present';

const GROUPS: AggregatedChartGroup[] = [
  { key: 'o-done', label: 'Done', hint: { rank: 2 }, value: 8, rowIds: ['c'] },
  { key: '__empty__', label: 'No Status', hint: { label: true }, value: 1, rowIds: ['d'] },
  { key: 'o-todo', label: 'Todo', hint: { rank: 0 }, value: 5, rowIds: ['b'] },
  { key: 'o-doing', label: 'Doing', hint: { rank: 1 }, value: 3, rowIds: ['a'] },
];

const CONFIG: ChartPresentConfig = {
  showEmptyValues: true,
  cumulative: false,
  xSort: 'auto',
  xManualOrder: [],
  hiddenGroups: [],
  aggregation: 1,
};

function present(config: Partial<ChartPresentConfig>, chartType = ChartType.Bar, groups = GROUPS) {
  return presentChartGroups(groups, { ...CONFIG, ...config }, chartType);
}

describe('presentChartGroups', () => {
  it('sorts in option order with the empty group last and keys every item', () => {
    const { visible } = present({});

    expect(visible.map((item) => [item.key, item.value])).toEqual([
      ['o-todo', 5],
      ['o-doing', 3],
      ['o-done', 8],
      ['__empty__', 1],
    ]);
    expect(visible.at(-1)?.isEmptyCategory).toBe(true);
  });

  it('drops the empty group when Show empty values is off', () => {
    expect(present({ showEmptyValues: false }).visible.map((item) => item.key)).toEqual(['o-todo', 'o-doing', 'o-done']);
  });

  it('leaves hidden groups out of the drawn items and the cumulative sum, but lists them in order', () => {
    const { visible, all } = present({ hiddenGroups: ['o-doing', 'stale-key'], cumulative: true });

    expect(visible.map((item) => [item.key, item.value])).toEqual([
      ['o-todo', 5],
      ['o-done', 13],
      ['__empty__', 1],
    ]);
    expect(all.map((group) => [group.key, group.hidden, group.count])).toEqual([
      ['o-todo', false, 1],
      ['o-doing', true, 1],
      ['o-done', false, 1],
      ['__empty__', false, 1],
    ]);
  });

  it('ignores a stored cumulative where it does not apply (donut, average)', () => {
    expect(present({ cumulative: true }, ChartType.Donut).visible.map((item) => item.value)).toEqual([5, 3, 8, 1]);
    expect(present({ cumulative: true, aggregation: 2 }).visible.map((item) => item.value)).toEqual([5, 3, 8, 1]);
  });

  it('sorts by value and draws a group without a value as 0', () => {
    const groups: AggregatedChartGroup[] = [...GROUPS.slice(0, 3), { ...GROUPS[3], value: null }];
    const { visible } = present({ xSort: 'value_desc' }, ChartType.Bar, groups);

    expect(visible.map((item) => [item.key, item.value])).toEqual([
      ['o-done', 8],
      ['o-todo', 5],
      ['o-doing', 0],
      ['__empty__', 1],
    ]);
  });

  it('puts the manual order first', () => {
    expect(present({ xSort: 'manual', xManualOrder: ['o-done', 'o-todo'] }).visible.map((item) => item.key)).toEqual([
      'o-done',
      'o-todo',
      'o-doing',
      '__empty__',
    ]);
  });
});
