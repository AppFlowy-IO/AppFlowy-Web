import fixture from '@/application/database-yjs/__fixtures__/dashboard-parity/drill-queries.json';
import { CHART_ALL_SERIES_KEY, EMPTY_CATEGORY_KEY } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import {
  buildDrillCategory,
  canonicalDecimal,
  drillChipText,
  drillColumns,
  drillFiltersForGroupKey,
  DrillGroupField,
  mergeFiltersForSave,
  numberChartDrillTarget,
  SavedFilterNode,
  toDrillTarget,
  toSavedFilterNodes,
} from '@/application/database-yjs/drill-query';

const DATE_CONDITIONS: Record<string, DateGroupCondition> = {
  Relative: DateGroupCondition.Relative,
  Day: DateGroupCondition.Day,
  Week: DateGroupCondition.Week,
  Month: DateGroupCondition.Month,
  Year: DateGroupCondition.Year,
};

/** `now_local` read as local wall-clock time. */
function parseLocal(text: string): Date {
  const [date, time = '00:00:00'] = text.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes, seconds] = time.split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/** A local calendar date's midnight in seconds, in this machine's time zone. */
function localMidnight(date: string): number {
  const [year, month, day] = date.split('-').map(Number);

  return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}

interface FixtureField {
  id: string;
  type: number;
  date_condition?: string;
  number_bucket_size?: number;
}

interface FixtureFilter {
  field_id: string;
  ty: number;
  condition: number;
  content?: string;
  date?: string;
}

function toGroupField(field: FixtureField): DrillGroupField {
  return {
    id: field.id,
    name: field.id,
    type: field.type as FieldType,
    dateCondition: field.date_condition === undefined ? undefined : DATE_CONDITIONS[field.date_condition],
    numberBucketSize: field.number_bucket_size,
  };
}

const NOW = parseLocal(fixture.now_local);
const LABELS = { empty: 'Empty', selectedRows: (count: number) => `Selected rows (${count})` };

describe('drill-queries.json cases (WP13 §3.2)', () => {
  it('has the required coverage', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    const field = testCase.field as FixtureField | null;
    const expected = testCase.expect as { kind: string; filters?: FixtureFilter[] };
    const result = buildDrillCategory({
      target: {
        xKey: testCase.key,
        xLabel: 'label',
        xIsEmpty: testCase.key === EMPTY_CATEGORY_KEY,
        rowIds: ['r1', 'r2'],
      },
      xField: field ? toGroupField(field) : null,
      now: NOW,
      labels: LABELS,
    });

    expect(result.category.kind).toBe(expected.kind);
    if (expected.kind === 'rows') {
      expect(result.rowAllowList).toEqual(['r1', 'r2']);
      expect(result.nodes).toEqual([]);
      return;
    }

    expect(result.rowAllowList).toBeNull();
    if (expected.kind === 'none') {
      expect(result.nodes).toEqual([]);
      expect(result.chips).toEqual([]);
      return;
    }

    const part = drillFiltersForGroupKey(toGroupField(field as FixtureField), testCase.key, NOW, 'x');

    expect(part.kind).toBe('filters');
    expect(result.nodes).toEqual(part.kind === 'filters' ? part.nodes : []);
    expect(
      result.nodes.map((node) => {
        const filter: FixtureFilter = { field_id: node.field_id, ty: node.ty, condition: node.condition };

        return { ...filter, content: node.content };
      })
    ).toEqual(
      (expected.filters ?? []).map((filter) => ({
        field_id: filter.field_id,
        ty: filter.ty,
        condition: filter.condition,
        content: filter.date === undefined ? filter.content : JSON.stringify({ timestamp: localMidnight(filter.date) }),
      }))
    );
    result.nodes.forEach((node, index) => {
      expect(node.id).toBe(`drill:x:${index}`);
      expect(node.filter_type).toBe(2);
    });
  });

  it('prefixes the sub-group ids', () => {
    const part = drillFiltersForGroupKey({ id: 'f', name: 'F', type: FieldType.SingleSelect }, 'o1', NOW, 'sub');

    expect(part).toEqual({
      kind: 'filters',
      nodes: [
        { id: 'drill:sub:0', filter_type: 2, field_id: 'f', ty: FieldType.SingleSelect, condition: 0, content: 'o1' },
      ],
    });
  });
});

describe('drill chips', () => {
  it.each(fixture.chips.map((chip) => [chip.expect, chip] as const))('%s', (_text, chip) => {
    if ('selected_rows' in chip) {
      expect(LABELS.selectedRows(chip.selected_rows as number)).toBe(chip.expect);
      const result = buildDrillCategory({
        target: {
          xKey: 'r1',
          xLabel: 'Row',
          xIsEmpty: false,
          rowIds: Array.from({ length: chip.selected_rows as number }, (_, index) => `r${index}`),
        },
        xField: { id: 'rel', name: 'Related', type: FieldType.Relation },
        now: NOW,
        labels: LABELS,
      });

      expect(result.chips).toEqual([{ kind: 'rows', text: chip.expect }]);
      return;
    }

    expect(drillChipText(chip.field_name as string, chip.label as string, chip.is_empty as boolean, 'Empty')).toBe(
      chip.expect
    );
  });

  it('builds the category and sub-group pills of a stacked segment', () => {
    const result = buildDrillCategory({
      target: {
        xKey: 'o_new',
        xLabel: 'New',
        xIsEmpty: false,
        subGroupKey: 'o_blocker',
        subGroupLabel: 'Blocker',
        subGroupIsEmpty: false,
        rowIds: ['r1'],
      },
      xField: { id: 'status', name: 'Status', type: FieldType.SingleSelect },
      subGroupField: { id: 'severity', name: 'Severity', type: FieldType.SingleSelect },
      now: NOW,
      labels: LABELS,
    });

    expect(result.chips).toEqual([
      { kind: 'category', text: 'Status: New', fieldId: 'status' },
      { kind: 'subgroup', text: 'Severity: Blocker', fieldId: 'severity' },
    ]);
    expect(result.nodes.map((node) => [node.id, node.field_id, node.content])).toEqual([
      ['drill:x:0', 'status', 'o_new'],
      ['drill:sub:0', 'severity', 'o_blocker'],
    ]);
    expect(result.rowAllowList).toBeNull();
  });

  it('falls back to the clicked rows as a whole when the sub-group cannot be expressed', () => {
    const result = buildDrillCategory({
      target: {
        xKey: 'o_new',
        xLabel: 'New',
        xIsEmpty: false,
        subGroupKey: 'row_9',
        subGroupLabel: 'Epic',
        rowIds: ['r1', 'r2'],
      },
      xField: { id: 'status', name: 'Status', type: FieldType.SingleSelect },
      subGroupField: { id: 'epic', name: 'Epic', type: FieldType.Relation },
      now: NOW,
      labels: LABELS,
    });

    expect(result.chips).toEqual([{ kind: 'rows', text: 'Selected rows (2)' }]);
    expect(result.nodes).toEqual([]);
    expect(result.rowAllowList).toEqual(['r1', 'r2']);
    expect(result.category.kind).toBe('rows');
  });

  it('falls back when the segment has a sub-group but the chart has no Group by field', () => {
    const result = buildDrillCategory({
      target: { xKey: 'o_new', xLabel: 'New', xIsEmpty: false, subGroupKey: 'o_b', rowIds: ['r1'] },
      xField: { id: 'status', name: 'Status', type: FieldType.SingleSelect },
      subGroupField: null,
      now: NOW,
      labels: LABELS,
    });

    expect(result.category.kind).toBe('rows');
  });

  it('labels the empty category "Empty"', () => {
    const result = buildDrillCategory({
      target: { xKey: EMPTY_CATEGORY_KEY, xLabel: 'No Status', xIsEmpty: true, rowIds: [] },
      xField: { id: 'status', name: 'Status', type: FieldType.SingleSelect },
      now: NOW,
      labels: LABELS,
    });

    expect(result.chips).toEqual([{ kind: 'category', text: 'Status: Empty', fieldId: 'status' }]);
  });
});

describe('canonicalDecimal', () => {
  it.each(fixture.canonical_decimal.map(([input, expected]) => [input, expected] as const))(
    '%p -> %p',
    (input, expected) => {
      expect(canonicalDecimal(input as number)).toBe(expected);
    }
  );
});

describe('mergeFiltersForSave (save_merge)', () => {
  const stripIds = (nodes: unknown): unknown =>
    Array.isArray(nodes)
      ? nodes.map(stripIds)
      : nodes && typeof nodes === 'object'
      ? Object.fromEntries(
          Object.entries(nodes as Record<string, unknown>)
            .filter(([key]) => key !== 'id')
            .map(([key, value]) => [key, stripIds(value)])
        )
      : nodes;

  it.each(fixture.save_merge.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    const merged = mergeFiltersForSave(
      testCase.view as SavedFilterNode[],
      testCase.extras as SavedFilterNode[],
      () => 'new-root'
    );

    expect(stripIds(merged)).toEqual(stripIds(testCase.expect));
  });

  it('keeps the ids of the view and the extras, and gives a new root a fresh id', () => {
    const orCase = fixture.save_merge.find((testCase) => testCase.name.startsWith('an Or root'));
    const merged = mergeFiltersForSave(
      orCase?.view as SavedFilterNode[],
      orCase?.extras as SavedFilterNode[],
      () => 'n1'
    );

    expect(merged[0].id).toBe('n1');
    expect((merged[0].children as SavedFilterNode[]).map((node) => node.id)).toEqual(['g1', 'x1']);
    const andCase = fixture.save_merge.find((testCase) => testCase.name.startsWith('an And root'));
    const kept = mergeFiltersForSave(andCase?.view as SavedFilterNode[], andCase?.extras as SavedFilterNode[]);

    expect(kept[0].id).toBe('g1');
  });
});

describe('toSavedFilterNodes', () => {
  it('gives fresh unique ids and keeps the type, condition and content', () => {
    let next = 0;
    const nodes = toSavedFilterNodes(
      [
        {
          id: 'gf1',
          filter_type: 2,
          field_id: 'component',
          ty: FieldType.SingleSelect,
          condition: 0,
          content: 'o_mobile',
        },
        {
          id: 'drill:x:0',
          filter_type: 2,
          field_id: 'severity',
          ty: FieldType.SingleSelect,
          condition: 0,
          content: 'o_b',
        },
      ],
      () => `id${(next += 1)}`
    );

    expect(nodes).toEqual([
      {
        id: 'id1',
        filter_type: 2,
        field_id: 'component',
        ty: FieldType.SingleSelect,
        condition: 0,
        content: 'o_mobile',
      },
      { id: 'id2', filter_type: 2, field_id: 'severity', ty: FieldType.SingleSelect, condition: 0, content: 'o_b' },
    ]);
  });

  it('defaults to random ids that never repeat the source ids', () => {
    const nodes = toSavedFilterNodes([
      { id: 'drill:x:0', filter_type: 2, field_id: 'a', ty: FieldType.RichText, condition: 0, content: 'x' },
      { id: 'drill:x:1', filter_type: 2, field_id: 'b', ty: FieldType.RichText, condition: 0, content: 'y' },
    ]);

    expect(new Set(nodes.map((node) => node.id)).size).toBe(2);
    nodes.forEach((node) => expect(String(node.id)).not.toMatch(/^drill:/));
  });
});

describe('drillColumns', () => {
  it('puts the primary field first, keeps the view order and drops only AlwaysHidden', () => {
    const columns = [
      { fieldId: 'status', isPrimary: false, visibility: FieldVisibility.AlwaysShown },
      { fieldId: 'secret', isPrimary: false, visibility: FieldVisibility.AlwaysHidden },
      { fieldId: 'name', isPrimary: true, visibility: FieldVisibility.AlwaysHidden },
      { fieldId: 'due', isPrimary: false, visibility: FieldVisibility.HideWhenEmpty },
      { fieldId: 'created', isPrimary: false, visibility: FieldVisibility.AlwaysShown },
    ];

    expect(drillColumns(columns).map((column) => column.fieldId)).toEqual(['name', 'status', 'due', 'created']);
  });
});

describe('toDrillTarget', () => {
  it('maps a category click', () => {
    expect(toDrillTarget({ label: 'Blocker', value: 2, rowIds: ['a', 'b'], key: 'o_blocker' })).toEqual({
      xKey: 'o_blocker',
      xLabel: 'Blocker',
      xIsEmpty: false,
      subGroupKey: undefined,
      subGroupLabel: undefined,
      subGroupIsEmpty: undefined,
      rowIds: ['a', 'b'],
    });
  });

  it('prefers the category key and maps the series of a segment', () => {
    expect(
      toDrillTarget({
        label: 'New',
        value: 1,
        rowIds: ['a'],
        key: 'ignored',
        categoryKey: 'o_new',
        seriesKey: EMPTY_CATEGORY_KEY,
        seriesLabel: 'No Severity',
      })
    ).toMatchObject({
      xKey: 'o_new',
      subGroupKey: EMPTY_CATEGORY_KEY,
      subGroupLabel: 'No Severity',
      subGroupIsEmpty: true,
    });
  });

  it('drops the all-series key and falls back to the empty key', () => {
    expect(
      toDrillTarget({ label: 'No Status', value: 3, rowIds: [], isEmptyCategory: true, seriesKey: CHART_ALL_SERIES_KEY })
    ).toMatchObject({ xKey: EMPTY_CATEGORY_KEY, xIsEmpty: true, subGroupKey: undefined });
  });

  it('builds the Number chart target', () => {
    expect(numberChartDrillTarget('Overdue', ['a'])).toEqual({
      xKey: '',
      xLabel: 'Overdue',
      xIsEmpty: false,
      rowIds: ['a'],
    });
  });
});
