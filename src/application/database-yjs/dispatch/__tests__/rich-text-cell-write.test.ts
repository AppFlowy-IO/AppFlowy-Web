import { FieldType } from '@/application/database-yjs/database.type';
import { writeCellToRow } from '@/application/database-yjs/dispatch/cell';
import { readRichTextFromCell, serializeRichTextCellValue } from '@/application/database-yjs/fields/text/rich-text';
import { YDatabaseCell, YDatabaseCells, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { createRowDoc } from '../../__tests__/test-helpers';

const FIELD = 'text-field';
const ROW = 'row-1';
const bold = [{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }];

function setup(data?: string) {
  const rowDoc = createRowDoc(ROW, 'db', data === undefined ? {} : { [FIELD]: { fieldType: FieldType.RichText, data } });
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
  const cells = row.get(YjsDatabaseKey.cells) as YDatabaseCells;

  return { rowDoc, row, cells };
}

function write(
  target: { rowDoc: YDoc; row: YDatabaseRow; cells: YDatabaseCells },
  data: string,
  richText?: string,
  fieldType = FieldType.RichText
) {
  writeCellToRow({
    ...target,
    fieldId: FIELD,
    fieldType,
    rowId: ROW,
    data,
    historyOptions: richText === undefined ? undefined : { richText },
  });
}

function cell(target: { cells: YDatabaseCells }) {
  return target.cells.get(FIELD) as YDatabaseCell;
}

describe('writeCellToRow rich text', () => {
  it('writes plain text and formatting together, for a new and an existing cell', () => {
    const fresh = setup();

    write(fresh, 'Hello world', serializeRichTextCellValue('Hello world', bold));
    expect(cell(fresh).get(YjsDatabaseKey.data)).toBe('Hello world');
    expect(readRichTextFromCell(cell(fresh))).toEqual(bold);

    const existing = setup('Old');

    write(existing, 'Hello world', serializeRichTextCellValue('Hello world', bold));
    expect(readRichTextFromCell(cell(existing))).toEqual(bold);
  });

  it('drops the formatting when plain text replaces the text', () => {
    const target = setup('Hello world');

    write(target, 'Hello world', serializeRichTextCellValue('Hello world', bold));
    write(target, 'Something else');
    expect(cell(target).get(YjsDatabaseKey.data)).toBe('Something else');
    expect(cell(target).has(YjsDatabaseKey.rich_text)).toBe(false);
  });

  it('keeps the formatting when a plain write leaves the text unchanged', () => {
    const target = setup('Hello world');

    write(target, 'Hello world', serializeRichTextCellValue('Hello world', bold));
    // e.g. pressing Enter in the calendar event title without editing it
    write(target, 'Hello world');
    expect(readRichTextFromCell(cell(target))).toEqual(bold);
  });

  it('clears the formatting when the editor saves the same text unformatted', () => {
    const target = setup('Hello world');

    write(target, 'Hello world', serializeRichTextCellValue('Hello world', bold));
    write(target, 'Hello world', '');
    expect(cell(target).has(YjsDatabaseKey.rich_text)).toBe(false);
  });

  it('never stores formatting on a non-Text field', () => {
    const target = setup();

    write(target, 'https://appflowy.io', serializeRichTextCellValue('https://appflowy.io', bold), FieldType.URL);
    expect(cell(target).get(YjsDatabaseKey.data)).toBe('https://appflowy.io');
    expect(cell(target).has(YjsDatabaseKey.rich_text)).toBe(false);
  });
});
