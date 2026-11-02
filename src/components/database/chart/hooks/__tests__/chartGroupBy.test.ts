import { ChartType } from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';

import {
  effectiveGroupStyle,
  groupByCandidates,
  isGroupByVisible,
  isGroupStyleVisible,
  resolveGroupByFieldId,
} from '../chartGroupBy';

const FIELDS = [
  { id: 'name', type: FieldType.RichText },
  { id: 'channel', type: FieldType.SingleSelect },
  { id: 'audience', type: FieldType.SingleSelect },
  { id: 'formula', type: FieldType.Formula },
  { id: 'due', type: FieldType.DateTime },
];

describe('resolveGroupByFieldId', () => {
  it('reads a stored property a chart can group by, other than X, on a bar or line chart', () => {
    expect(resolveGroupByFieldId('audience', FIELDS, 'channel', ChartType.Bar)).toBe('audience');
    expect(resolveGroupByFieldId('due', FIELDS, 'channel', ChartType.Line)).toBe('due');
    expect(resolveGroupByFieldId('audience', FIELDS, 'channel', ChartType.HorizontalBar)).toBe('audience');
  });

  it('reads none for an empty, deleted, ungroupable or X property, and for a donut or Number chart', () => {
    expect(resolveGroupByFieldId('', FIELDS, 'channel', ChartType.Bar)).toBeNull();
    expect(resolveGroupByFieldId(undefined, FIELDS, 'channel', ChartType.Bar)).toBeNull();
    expect(resolveGroupByFieldId('gone', FIELDS, 'channel', ChartType.Bar)).toBeNull();
    expect(resolveGroupByFieldId('formula', FIELDS, 'channel', ChartType.Bar)).toBeNull();
    expect(resolveGroupByFieldId('channel', FIELDS, 'channel', ChartType.Bar)).toBeNull();
    expect(resolveGroupByFieldId('audience', FIELDS, 'channel', ChartType.Donut)).toBeNull();
    expect(resolveGroupByFieldId('audience', FIELDS, 'channel', ChartType.Number)).toBeNull();
  });
});

describe('groupByCandidates', () => {
  it('lists the X-axis types in view order without the X property', () => {
    expect(groupByCandidates(FIELDS, 'channel').map((field) => field.id)).toEqual(['name', 'audience', 'due']);
    expect(groupByCandidates(FIELDS, null).map((field) => field.id)).toEqual(['name', 'channel', 'audience', 'due']);
  });
});

describe('Group by visibility and style', () => {
  it('shows Group by for bars and lines, Group style only for bars with a Group by', () => {
    expect(
      [ChartType.Bar, ChartType.Line, ChartType.HorizontalBar, ChartType.Donut, ChartType.Number].map(isGroupByVisible)
    ).toEqual([true, true, true, false, false]);
    expect(isGroupStyleVisible(ChartType.Bar, true)).toBe(true);
    expect(isGroupStyleVisible(ChartType.HorizontalBar, true)).toBe(true);
    expect(isGroupStyleVisible(ChartType.Bar, false)).toBe(false);
    expect(isGroupStyleVisible(ChartType.Line, true)).toBe(false);
    expect(isGroupStyleVisible(ChartType.Donut, true)).toBe(false);
  });

  it('draws the stored style only where it applies', () => {
    expect(effectiveGroupStyle(ChartType.Bar, true, 'percent')).toBe('percent');
    expect(effectiveGroupStyle(ChartType.Bar, false, 'percent')).toBe('none');
    expect(effectiveGroupStyle(ChartType.Line, true, 'grouped')).toBe('none');
  });
});
