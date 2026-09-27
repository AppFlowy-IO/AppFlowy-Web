import { TIMELINE_MIN_PRIMARY_COLUMN_WIDTH, TIMELINE_TABLE_COLUMN_WIDTH } from '../constants';
import {
  TIMELINE_DEFAULT_PRIMARY_COLUMN_WIDTH,
  timelineColumnWidthStyle,
  timelineColumnWidthVars,
  timelineTableColumnWidths,
} from '../table-layout';

test('columns without a stored width use the timeline defaults', () => {
  const widths = timelineTableColumnWidths(new Map(), 'title', ['owner'], null);

  expect(widths.get('title')).toBe(TIMELINE_DEFAULT_PRIMARY_COLUMN_WIDTH);
  expect(widths.get('owner')).toBe(TIMELINE_TABLE_COLUMN_WIDTH);
});

test('stored widths are clamped and a live resize wins over them', () => {
  const saved = new Map([
    ['title', 20],
    ['owner', 180],
  ]);

  expect(timelineTableColumnWidths(saved, 'title', ['owner'], null).get('title')).toBe(
    TIMELINE_MIN_PRIMARY_COLUMN_WIDTH
  );
  expect(timelineTableColumnWidths(saved, 'title', ['owner'], { fieldId: 'owner', width: 240 }).get('owner')).toBe(240);
});

test('row cells read the published width variable, falling back to the default', () => {
  const vars = timelineColumnWidthVars(new Map([['a.b c', 210]])) as Record<string, string>;
  const [name] = Object.keys(vars);

  expect(name).toMatch(/^--timeline-column-[\w-]+$/);
  expect(vars[name]).toBe('210px');
  expect(timelineColumnWidthStyle('a.b c').width).toBe(`var(${name}, ${TIMELINE_TABLE_COLUMN_WIDTH}px)`);
});
