import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { cloneDatabaseCell } from '@/application/database-yjs/cell.clone';
import { isTextWrittenCell, normalizeLegacyCellFieldType } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { useClearCellsWithFieldDispatch, useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import {
  useUpdateCellDispatch,
  useUpdateStartEndTimeCells,
  writeCellToRow,
} from '@/application/database-yjs/dispatch/cell';
import { setRelationCellRowIds } from '@/application/database-yjs/dispatch/relation';
import { useMoveCardDispatch } from '@/application/database-yjs/dispatch/row';
import {
  encodeRichTextCellValue,
  packRichTextDelta,
  readRichTextFromCell,
  RichTextDelta,
  serializeRichTextCellValue,
  withMentionLabels,
} from '@/application/database-yjs/fields/text/rich-text';
import { CellWriteStatus } from '@/application/database-yjs/fields/text/rich-text-guard';
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import conformance from '../../fields/text/__tests__/rich-text-conformance.json';
import { createRowDoc } from '../../__tests__/test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
jest.mock('@/application/database-yjs/fields/text/rich-text-notice', () => ({ notifyRichTextNewer: jest.fn() }));

const FIELD = 'text-field';
const ROW = 'row-1';
const DATABASE = 'db';
const VIEW = 'view-1';
const bold = [{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }];
const notified = notifyRichTextNewer as jest.Mock;

function setup(data?: string) {
  const rowDoc = createRowDoc(ROW, DATABASE, data === undefined ? {} : { [FIELD]: { fieldType: FieldType.RichText, data } });
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
  return writeCellToRow({
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

beforeEach(() => {
  notified.mockReset();
});

describe('writeCellToRow rich text', () => {
  it('rechecks a deferred save before changing the cell or its attribution', () => {
    const target = setup('Original');
    const expected = cell(target).get(YjsDatabaseKey.data);

    cell(target).set(YjsDatabaseKey.data, 'Changed remotely');
    const before = target.row.toJSON();
    const status = writeCellToRow({
      ...target, fieldId: FIELD, fieldType: FieldType.RichText, rowId: ROW,
      data: 'Old draft', actorUid: '5',
      historyOptions: { shouldWrite: (current) => current?.get(YjsDatabaseKey.data) === expected },
    });

    expect(status).toBe('cancelled');
    expect(target.row.toJSON()).toEqual(before);
  });

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

  it('stores a version 1 envelope', () => {
    const target = setup('Old');

    write(target, 'Hello world', encodeRichTextCellValue('Hello world', bold));
    expect(JSON.parse(cell(target).get(YjsDatabaseKey.rich_text) as string)).toEqual({
      v: 1,
      text: 'Hello world',
      delta: bold,
    });
  });

  it('still writes same-text changes of other cells, such as date options and type normalization', () => {
    const target = setup('Hello world');

    cell(target).set(YjsDatabaseKey.field_type, '0');
    expect(write(target, 'Hello world')).toBe('written');
    expect(cell(target).get(YjsDatabaseKey.field_type)).toBe(FieldType.RichText);
  });
});

// ---- the shared editability cases (rich text spec section 13.3)

type Json = unknown;
type Write = {
  kind: string;
  data?: Json;
  delta?: RichTextDelta;
  end_timestamp?: string;
  from?: FieldType;
  to?: FieldType;
};
type EditabilityCase = {
  id: string;
  description: string;
  fieldType: FieldType;
  cell: Record<string, Json> | null;
  write: Write;
  expected: { result: string; formatting: string };
};

const cases = (conformance.sections.editability.cases as unknown as EditabilityCase[]).map(
  (testCase) => [testCase.id, testCase] as const
);

/** Kinds run through a dispatch hook, which reports refusals to the user itself. */
const HOOK_DRIVEN = new Set(['clearCell', 'moveCard', 'setDateRange', 'switchFieldType']);

const SELECT_OPTIONS = { disable_color: false, options: [{ id: 'opt-done', name: 'Done', color: 'Purple' }] };

/** A database with one field of `fieldType` and one row whose cell holds `stored` exactly as given. */
function databaseFixture(fieldType: FieldType, stored: Record<string, Json> | null) {
  const databaseDoc = new Y.Doc({ guid: DATABASE }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const typeOptions = new Y.Map();
  const selectOption = new Y.Map();

  field.set(YjsDatabaseKey.id, FIELD);
  field.set(YjsDatabaseKey.name, 'Notes');
  field.set(YjsDatabaseKey.type, fieldType);
  field.set(YjsDatabaseKey.created_at, '1');
  field.set(YjsDatabaseKey.last_modified, '2');
  selectOption.set(YjsDatabaseKey.content, JSON.stringify(SELECT_OPTIONS));
  typeOptions.set(String(FieldType.SingleSelect), selectOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  fields.set(FIELD, field);
  view.set(YjsDatabaseKey.row_orders, Y.Array.from([{ id: ROW, height: 36 }]));
  views.set(VIEW, view);
  database.set(YjsDatabaseKey.id, DATABASE);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const target = setup();

  if (stored) {
    const storedCell = new Y.Map() as YDatabaseCell;

    target.cells.set(FIELD, storedCell);
    Object.entries(stored).forEach(([key, value]) => storedCell.set(key, value));
  }

  const contextValue = {
    readOnly: false,
    databaseDoc,
    databasePageId: VIEW,
    activeViewId: VIEW,
    rowMap: { [ROW]: target.rowDoc },
    workspaceId: 'workspace-id',
  } as unknown as DatabaseContextState;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(DatabaseContext.Provider, { value: contextValue }, children);

  return { ...target, databaseDoc, view, wrapper };
}

type Fixture = ReturnType<typeof databaseFixture>;

function resultOf(status: CellWriteStatus | undefined) {
  if (status === 'noop') return 'noop';
  if (status === 'refused-rich-text-newer') return 'refused';
  return 'allowed';
}

/** What happened to the formatting, from the cell before and after. */
function formattingOf(before: Record<string, Json> | null, after: YDatabaseCell | undefined) {
  const hadRichText = typeof before?.rich_text === 'string' && before.rich_text !== '';
  const richText = after?.get(YjsDatabaseKey.rich_text);

  if (after && richText === before?.rich_text) return 'kept';
  if (typeof richText === 'string' && richText !== '') return 'written';
  return hadRichText ? 'cleared' : 'kept';
}

/** Runs a case's write through the helper the web uses for it; returns the result it reports. */
async function runWrite(fixture: Fixture, testCase: EditabilityCase): Promise<string> {
  const { write: request, fieldType } = testCase;
  const target = { rowDoc: fixture.rowDoc, row: fixture.row, cells: fixture.cells };

  switch (request.kind) {
    case 'setText':
      return resultOf(write(target, request.data as string, undefined, fieldType));
    case 'setRichText': {
      const delta = withMentionLabels(packRichTextDelta(request.delta ?? []));

      return resultOf(write(target, request.data as string, encodeRichTextCellValue(request.data as string, delta), fieldType));
    }

    case 'clearFormatting':
      return resultOf(write(target, (request.data as string) ?? '', '', fieldType));
    case 'setRelation':
      return resultOf(setRelationCellRowIds(fixture.rowDoc, FIELD, request.data as string[]));
    case 'clearCell': {
      const { result } = renderHook(() => useClearCellsWithFieldDispatch(), { wrapper: fixture.wrapper });

      act(() => result.current(FIELD));
      return notified.mock.calls.length > 0 ? 'refused' : 'allowed';
    }

    case 'moveCard': {
      const { result } = renderHook(() => useMoveCardDispatch(), { wrapper: fixture.wrapper });

      act(() =>
        result.current({ rowId: ROW, fieldId: FIELD, startColumnId: FIELD, finishColumnId: request.data as string })
      );
      return notified.mock.calls.length > 0 ? 'refused' : 'allowed';
    }

    case 'setDateRange': {
      const { result } = renderHook(() => useUpdateStartEndTimeCells(), { wrapper: fixture.wrapper });

      await act(async () => {
        await result.current([
          { rowId: ROW, fieldId: FIELD, startTimestamp: request.data as string, endTimestamp: request.end_timestamp },
        ]);
      });
      return notified.mock.calls.length > 0 ? 'refused' : 'allowed';
    }

    case 'switchFieldType': {
      fixture.databaseDoc
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database)
        .get(YjsDatabaseKey.fields)
        .get(FIELD)
        .set(YjsDatabaseKey.type, request.from as FieldType);
      const before = JSON.stringify(cell(fixture)?.toJSON());
      const { result } = renderHook(() => useSwitchPropertyType(), { wrapper: fixture.wrapper });

      await act(async () => {
        await result.current(FIELD, request.to as FieldType);
      });
      return JSON.stringify(cell(fixture)?.toJSON()) === before ? 'skipped' : 'allowed';
    }

    case 'normalizeLegacyFieldType': {
      const storedCell = cell(fixture);
      const hasSource = storedCell.get(YjsDatabaseKey.source_field_type) !== undefined;

      if (normalizeLegacyCellFieldType(storedCell)) return 'allowed';
      return hasSource ? 'skipped' : 'noop';
    }

    default:
      throw new Error(`no web helper for ${request.kind}`);
  }
}

describe('editability conformance', () => {
  it.each(cases.filter(([, testCase]) => !['duplicateRow', 'undoOwnEdit'].includes(testCase.write.kind)))(
    '%s',
    async (_id, testCase) => {
      const fixture = databaseFixture(testCase.fieldType, testCase.cell);
      const rowBefore = fixture.row.toJSON();
      const result = await runWrite(fixture, testCase);

      expect({ result, formatting: formattingOf(testCase.cell, cell(fixture)) }).toEqual(testCase.expected);

      // Nothing at all is written for a cell that is left alone: not
      // last_modified, field_type or the row's attribution (R49).
      if (result !== 'allowed') expect(fixture.row.toJSON()).toEqual(rowBefore);
      // Helpers report a refusal; the dispatch hooks tell the user, once.
      if (HOOK_DRIVEN.has(testCase.write.kind)) expect(notified).toHaveBeenCalledTimes(result === 'refused' ? 1 : 0);
    }
  );

  it.each(cases.filter(([, testCase]) => testCase.write.kind === 'duplicateRow'))('%s', (_id, testCase) => {
    const fixture = databaseFixture(testCase.fieldType, testCase.cell);
    const original = cell(fixture);
    const copy = cloneDatabaseCell(testCase.fieldType, original);
    const other = setup();

    // The copy goes into another row, as a row duplicate does.
    other.cells.set(FIELD, copy);
    expect(copy.get(YjsDatabaseKey.rich_text)).toBe(original.get(YjsDatabaseKey.rich_text));
    expect(isTextWrittenCell(copy)).toBe(isTextWrittenCell(original));
    expect(copy.get(YjsDatabaseKey.field_type)).toBe(original.get(YjsDatabaseKey.field_type));
    expect(testCase.expected).toEqual({ result: 'allowed', formatting: 'copied' });
  });

  it.each(cases.filter(([, testCase]) => testCase.write.kind === 'undoOwnEdit'))('%s', (_id, testCase) => {
    const stored = testCase.cell as Record<string, Json>;
    const fixture = databaseFixture(testCase.fieldType, null);
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    history.registerRowDoc(ROW, fixture.rowDoc);
    // An older own edit of another cell, then this client's text edit...
    writeCellToRow({ ...fixture, fieldId: 'other', fieldType: FieldType.RichText, rowId: ROW, data: 'earlier' });
    write(fixture, testCase.write.data as string);
    write(fixture, stored.data as string);

    // ...then a newer client saves formatting only, as Desktop does (it
    // writes only the keys that changed).
    const remote = new Y.Doc();

    Y.applyUpdate(remote, Y.encodeStateAsUpdate(fixture.rowDoc));
    const remoteCells = (remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow).get(
      YjsDatabaseKey.cells
    );

    remote.transact(() => remoteCells.get(FIELD).set(YjsDatabaseKey.rich_text, stored.rich_text as string));
    Y.applyUpdate(fixture.rowDoc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(fixture.rowDoc)));

    const before = cell(fixture).toJSON();

    // Undo would restore the old data under the newer formatting: refused,
    // and that step is dropped.
    act(() => {
      history.undo();
    });
    expect(cell(fixture).toJSON()).toEqual(before);
    expect(notified).toHaveBeenCalledTimes(1);
    expect({ result: 'refused', formatting: 'kept' }).toEqual(testCase.expected);

    // The next undo continues with older history.
    act(() => {
      history.undo();
    });
    expect(cell(fixture).toJSON()).toEqual(before);
    act(() => {
      history.undo();
    });
    expect(fixture.cells.get('other')).toBeUndefined();
  });
});

describe('switching field types around a cell that needs a newer client', () => {
  it('still materializes the other cells', async () => {
    const fixture = databaseFixture(FieldType.CreatedTime, { field_type: 0, data: 'plain' });
    const { result } = renderHook(() => useSwitchPropertyType(), { wrapper: fixture.wrapper });

    await act(async () => {
      await result.current(FIELD, FieldType.RichText);
    });
    expect(cell(fixture).get(YjsDatabaseKey.field_type)).toBe(FieldType.CreatedTime);
  });
});

describe('saving a cell that needs a newer client', () => {
  const newer = conformance.sections.editability.cases.find((testCase) => testCase.id === 'ed-004-newer-set-text')!
    .cell as Record<string, Json>;

  it('tells the user once and reports the refusal to the editor', async () => {
    const fixture = databaseFixture(FieldType.RichText, newer);
    const { result } = renderHook(() => useUpdateCellDispatch(ROW, FIELD), { wrapper: fixture.wrapper });
    let status: CellWriteStatus | undefined;

    await act(async () => {
      status = await result.current('Hello world!');
    });
    expect(status).toBe('refused-rich-text-newer');
    expect(notified).toHaveBeenCalledTimes(1);
    expect(cell(fixture).toJSON()).toEqual(newer);
  });

  it('writes nothing, silently, for a save of the same text', async () => {
    const fixture = databaseFixture(FieldType.URL, newer);
    const { result } = renderHook(() => useUpdateCellDispatch(ROW, FIELD), { wrapper: fixture.wrapper });
    let status: CellWriteStatus | undefined;

    await act(async () => {
      status = await result.current('Hello world');
    });
    expect(status).toBe('noop');
    expect(notified).not.toHaveBeenCalled();
    // field_type stays 0: the cell is still Text-written.
    expect(cell(fixture).toJSON()).toEqual(newer);
  });
});
