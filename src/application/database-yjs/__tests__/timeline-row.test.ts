import { describe, expect, it } from '@jest/globals';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseRowHistoryController } from '@/application/database-yjs/history';
import { commitTimelineRange, readTimelineRange } from '@/application/database-yjs/timeline-row';
import { YDatabaseField, YDatabaseFields, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

import { createRowDoc } from './test-helpers';

function fixture() {
  const fieldDoc = new Y.Doc();
  const fields = fieldDoc.getMap('fields') as YDatabaseFields;

  ['date', 'end'].forEach((id) => {
    const field = new Y.Map() as YDatabaseField;
    fields.set(id, field);
    field.set(YjsDatabaseKey.type, FieldType.DateTime);
  });
  const doc = createRowDoc('row', 'database', {
    date: { fieldType: FieldType.DateTime, data: '1000', includeTime: true },
    end: { fieldType: FieldType.DateTime, data: '2000', includeTime: true },
  });
  const row = (doc.getMap(YjsEditorKey.data_section) as YSharedRoot).get(YjsEditorKey.database_row);

  return { doc, row, fields };
}

describe('timeline row edits', () => {
  it('writes two date properties atomically and undoes both in one action', () => {
    const { doc, row, fields } = fixture();
    const before = readTimelineRange(row, fields, 'date', 'end').range!;
    const controller = getOrCreateDatabaseRowHistoryController(doc, 'row')!;
    let changes = 0;

    row.observeDeep(() => changes++);
    commitTimelineRange(doc, fields, 'date', 'end', before, {
      ...before,
      start: before.start + 1000,
      end: before.end! + 1000,
    });
    expect(changes).toBe(1);
    expect(readTimelineRange(row, fields, 'date', 'end').range?.start).toBe(1_001_000);
    controller.undo();
    expect(readTimelineRange(row, fields, 'date', 'end').range).toEqual(before);
    expect(controller.canUndo()).toBe(false);
    controller.redo();
    expect(readTimelineRange(row, fields, 'date', 'end').range?.end).toBe(2_001_000);
  });

  it('rejects a stale drag after a remote date edit without overwriting it', () => {
    const { doc, row, fields } = fixture();
    const before = readTimelineRange(row, fields, 'date', '').range!;

    doc.transact(() => row.get(YjsDatabaseKey.cells).get('date').set(YjsDatabaseKey.data, '1500'), 'remote');
    expect(() => commitTimelineRange(doc, fields, 'date', '', before, { ...before, start: 1_200_000 })).toThrow(
      'changed while'
    );
    expect(row.get(YjsDatabaseKey.cells).get('date').get(YjsDatabaseKey.data)).toBe('1500');
  });

  it("preserves a separate end property's time precision and reminder", () => {
    const { doc, row, fields } = fixture();
    const cells = row.get(YjsDatabaseKey.cells);

    cells.get('date').set(YjsDatabaseKey.include_time, false);
    cells.get('end').set(YjsDatabaseKey.reminder_id, 'keep-reminder');
    const before = readTimelineRange(row, fields, 'date', 'end').range!;

    commitTimelineRange(doc, fields, 'date', 'end', before, {
      ...before,
      start: before.start + 86_400_000,
      end: before.end! + 86_400_000,
    });
    expect(cells.get('date').get(YjsDatabaseKey.include_time)).toBe(false);
    expect(cells.get('end').get(YjsDatabaseKey.include_time)).toBe(true);
    expect(cells.get('end').get(YjsDatabaseKey.reminder_id)).toBe('keep-reminder');
  });

  it('rejects generated dates and invalid ranges', () => {
    const { doc, row, fields } = fixture();
    const before = readTimelineRange(row, fields, 'date', 'end').range!;

    expect(() => commitTimelineRange(doc, fields, 'date', 'end', before, { ...before, end: before.start - 1 })).toThrow(
      'end date'
    );
    fields.get('date').set(YjsDatabaseKey.type, FieldType.CreatedTime);
    expect(() => commitTimelineRange(doc, fields, 'date', 'end', before, before)).toThrow('cannot be edited');
  });

  it('surfaces an inverted range without treating it as an editable unscheduled row', () => {
    const { row, fields } = fixture();

    row.get(YjsDatabaseKey.cells).get('end').set(YjsDatabaseKey.data, '500');
    expect(readTimelineRange(row, fields, 'date', 'end')).toEqual({ invalid: true });
  });
});
