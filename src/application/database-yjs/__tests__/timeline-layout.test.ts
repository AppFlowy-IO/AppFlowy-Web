import { expect, it, jest } from '@jest/globals';
import * as Y from 'yjs';

import { readTimelineSettings, updateTimelineSettings } from '@/application/database-yjs/timeline-layout';
import { YDatabaseView, YjsDatabaseKey } from '@/application/types';

it('round-trips settings and merges concurrent changes without replacing another layout', () => {
  const first = new Y.Doc();
  const firstView = first.getMap('view') as YDatabaseView;
  const layouts = new Y.Map();
  const calendar = new Y.Map();

  firstView.set(YjsDatabaseKey.layout_settings, layouts);
  layouts.set('2', calendar);
  calendar.set('field_id', 'calendar-date');
  updateTimelineSettings(firstView, {
    fieldId: 'schedule',
    endFieldId: 'deadline',
    scale: 'quarter',
    tableFieldIds: ['status'],
    barFieldIds: ['owner'],
  });
  const second = new Y.Doc();

  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  const secondView = second.getMap('view') as YDatabaseView;

  updateTimelineSettings(firstView, { scale: 'week' });
  updateTimelineSettings(secondView, { tableWidth: 420, showTable: false });
  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  expect(readTimelineSettings(firstView)).toEqual(readTimelineSettings(secondView));
  expect(readTimelineSettings(secondView)).toMatchObject({
    scale: 'week',
    tableWidth: 420,
    showTable: false,
    fieldId: 'schedule',
    endFieldId: 'deadline',
    tableFieldIds: ['status'],
    barFieldIds: ['owner'],
  });
  expect(firstView.get(YjsDatabaseKey.layout_settings).get('2').get(YjsDatabaseKey.field_id)).toBe('calendar-date');
  const reopened = new Y.Doc();

  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(second));
  expect(readTimelineSettings(reopened.getMap('view') as YDatabaseView)).toEqual(readTimelineSettings(secondView));
});

it('normalizes native integer widths and unknown scale values', () => {
  const doc = new Y.Doc();
  const view = doc.getMap('view') as YDatabaseView;

  updateTimelineSettings(view, { fieldId: 'date' });
  const setting = view.get(YjsDatabaseKey.layout_settings).get('8');

  const get = setting.get.bind(setting);

  // Native Yrs integers can be decoded as BigInt; Yjs itself cannot set one.
  const mock = jest.spyOn(setting, 'get').mockImplementation((key) => (key === 'table_width' ? BigInt(380) : get(key)));
  setting.set('scale', 'future-scale');
  expect(readTimelineSettings(view)).toMatchObject({ tableWidth: 380, scale: 'month' });
  mock.mockRestore();
});
