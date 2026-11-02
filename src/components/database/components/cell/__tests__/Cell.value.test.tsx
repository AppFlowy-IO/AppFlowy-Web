import { act, render, renderHook, screen } from '@testing-library/react';
import { type ReactNode, useLayoutEffect } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import type { TextCell } from '@/application/database-yjs/cell.type';
import { serializeRichTextCellValue } from '@/application/database-yjs/fields/text/rich-text';
import { useCellSelector } from '@/application/database-yjs/selector';
import {
  MentionType,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { CellValue, useStoredCellValue } from '@/components/database/components/cell/Cell';
import CardField from '@/components/database/components/field/CardField';
import { GridRowCell } from '@/components/database/components/grid/grid-cell/GridRowCell';
import { GridRowProvider } from '@/components/database/components/grid/grid-row/GridRowContext';
import { createGridInteractionStore, GridInteractionContext } from '@/components/database/grid/useGridContext';

/** Renders of the cell component, with the value it received. */
const mockCellRenders: (string | undefined)[] = [];

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

// The shared lodash mock always reports equality, hiding missed cell updates.
jest.mock('lodash-es', () => jest.requireActual('lodash'));

// `useCellSelector` is the only caller of the rollup and formula hooks: spying on it spies on them.
jest.mock('@/application/database-yjs/selector', () => {
  const actual = jest.requireActual('@/application/database-yjs/selector');

  return { ...actual, useCellSelector: jest.fn(actual.useCellSelector) };
});

jest.mock('@/components/database/components/cell/Cell', () => {
  const actual = jest.requireActual('@/components/database/components/cell/Cell');

  return {
    ...actual,
    Cell: ({ cell }: { cell?: { data?: unknown } }) => {
      mockCellRenders.push(cell?.data === undefined ? undefined : String(cell.data));
      return <span data-testid='cell-text'>{String(cell?.data ?? '')}</span>;
    },
  };
});

const mockUseCellSelector = useCellSelector as jest.MockedFunction<typeof useCellSelector>;

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const FIELDS = {
  text: { id: 'text-field', type: FieldType.RichText, data: 'Engineering' },
  number: { id: 'number-field', type: FieldType.Number, data: '42' },
  checkbox: { id: 'checkbox-field', type: FieldType.Checkbox, data: 'Yes' },
  url: { id: 'url-field', type: FieldType.URL, data: 'https://appflowy.io' },
  formula: { id: 'formula-field', type: FieldType.Formula, data: undefined },
  rollup: { id: 'rollup-field', type: FieldType.Rollup, data: undefined },
} as const;

function createFixture({ seedOnly = false, history = false } = {}) {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  Object.values(FIELDS).forEach(({ id, type }) => {
    const field = new Y.Map() as YDatabaseField;

    field.set(YjsDatabaseKey.id, id);
    field.set(YjsDatabaseKey.name, id);
    field.set(YjsDatabaseKey.type, type);
    fields.set(id, field);
  });
  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowDoc = createRowDoc(
    rowId,
    databaseId,
    Object.fromEntries(
      Object.values(FIELDS)
        .filter(({ data }) => data !== undefined)
        .map(({ id, type, data }) => [id, { fieldType: type, data }])
    )
  );
  const contextValue = {
    readOnly: true,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: seedOnly ? {} : { [rowId]: rowDoc },
    peekRowDocFromSeed: () => rowDoc,
    seedsReady: true,
    dataSource: history ? { type: 'history', id: 'historical-version' } : undefined,
    workspaceId: 'workspace-id',
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
  const cells = (rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown>).get(
    YjsDatabaseKey.cells
  ) as Y.Map<YDatabaseCell>;

  return { wrapper, cells, fields };
}

describe('Cell values are read with the hooks their field type needs (W17)', () => {
  beforeEach(() => {
    mockCellRenders.length = 0;
    mockUseCellSelector.mockClear();
  });

  it('renders a text cell of a grid row without the rollup and formula hooks, and only once on mount', () => {
    const { wrapper: Wrapper } = createFixture();
    const store = createGridInteractionStore();

    render(
      <Wrapper>
        <GridInteractionContext.Provider
          value={{
            historyScopeId: 'grid',
            restoreHistoryFocus: () => undefined,
            setActiveCell: store.setActiveCell,
            setHoverRowKey: store.setHoverRowKey,
            store,
          }}
        >
          <GridRowProvider value={{ isSticky: false, resizeRow: () => undefined }}>
            <GridRowCell rowId={rowId} rowKey={rowId} fieldId={FIELDS.text.id} columnIndex={1} rowIndex={1} />
          </GridRowProvider>
        </GridInteractionContext.Provider>
      </Wrapper>
    );

    expect(screen.getByTestId('cell-text').textContent).toBe('Engineering');
    expect(mockUseCellSelector).not.toHaveBeenCalled();
    // The rollup hook reset its state on mount and rendered every cell a second time.
    expect(mockCellRenders).toEqual(['Engineering']);
  });

  it.each([
    ['Rich text', FIELDS.text],
    ['Number', FIELDS.number],
    ['Checkbox', FIELDS.checkbox],
    ['URL', FIELDS.url],
  ])('reads a %s cell from the row without useCellSelector', (_name, field) => {
    const { wrapper } = createFixture();

    render(
      <CellValue rowId={rowId} fieldId={field.id} fieldType={field.type}>
        {(cell) => <span data-testid='value'>{String(cell?.data)}</span>}
      </CellValue>,
      { wrapper }
    );

    expect(screen.getByTestId('value').textContent).toBe(String(field.data));
    expect(mockUseCellSelector).not.toHaveBeenCalled();
  });

  it('reads a card field without computed hooks and updates when its stored value changes', () => {
    const { wrapper, cells } = createFixture();

    render(<CardField rowId={rowId} fieldId={FIELDS.text.id} />, { wrapper });

    expect(screen.getByTestId('cell-text').textContent).toBe('Engineering');
    expect(mockUseCellSelector).not.toHaveBeenCalled();
    act(() => { cells.get(FIELDS.text.id)?.set(YjsDatabaseKey.data, 'Design'); });
    expect(screen.getByTestId('cell-text').textContent).toBe('Design');
    expect(mockUseCellSelector).not.toHaveBeenCalled();
  });

  it('renders seeded card fields at their final size before a live row binds', () => {
    const { wrapper } = createFixture({ seedOnly: true });

    render(<CardField rowId={rowId} fieldId={FIELDS.text.id} />, { wrapper });
    expect(mockCellRenders[0]).toBe('Engineering');
    expect(screen.getByTestId('cell-text').textContent).toBe('Engineering');
    expect(mockUseCellSelector).not.toHaveBeenCalled();
  });

  it('updates a card checkbox label when an empty field is renamed', () => {
    const { wrapper, cells, fields } = createFixture();

    cells.delete(FIELDS.checkbox.id);
    render(<CardField rowId={rowId} fieldId={FIELDS.checkbox.id} />, { wrapper });
    expect(screen.getByText(FIELDS.checkbox.id)).toBeTruthy();
    act(() => { fields.get(FIELDS.checkbox.id)?.set(YjsDatabaseKey.name, 'Verified'); });
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.queryByText(FIELDS.checkbox.id)).toBeNull();
  });

  it('never substitutes live seed values for a missing historical cell', () => {
    const { wrapper } = createFixture({ seedOnly: true, history: true });
    const { result } = renderHook(() => useStoredCellValue({ rowId, fieldId: FIELDS.text.id }), { wrapper });

    expect(result.current).toBeUndefined();
  });

  it.each([false, true])('preserves formatting and mentions in stored text (seed only: %s)', (seedOnly) => {
    const { wrapper, cells } = createFixture({ seedOnly });
    const delta = [
      { insert: 'See ', attributes: { bold: true } },
      { insert: '$', attributes: { mention: { type: MentionType.PageRef, page_id: 'p1', data: { title: 'Engineering' } } } },
    ];
    const cell = cells.get(FIELDS.text.id)!;

    cell.set(YjsDatabaseKey.data, 'See Engineering');
    cell.set(YjsDatabaseKey.rich_text, serializeRichTextCellValue('See Engineering', delta));
    const { result } = renderHook(() => useStoredCellValue({ rowId, fieldId: FIELDS.text.id }) as TextCell, { wrapper });

    expect(result.current.data).toBe('See Engineering');
    expect(result.current.richText).toEqual(delta);

    const edited = [{ insert: 'See Engineering', attributes: { italic: true } }];

    act(() => { cell.set(YjsDatabaseKey.rich_text, serializeRichTextCellValue('See Engineering', edited)); });
    expect(result.current.richText).toEqual(edited);
  });

  it('catches a formatting-only change between render and subscription', () => {
    const { wrapper, cells } = createFixture();
    const delta = [{ insert: 'Engineering', attributes: { bold: true } }];
    const { result } = renderHook(() => {
      const cell = useStoredCellValue({ rowId, fieldId: FIELDS.text.id }) as TextCell;

      useLayoutEffect(() => {
        cells.get(FIELDS.text.id)!.set(YjsDatabaseKey.rich_text, serializeRichTextCellValue('Engineering', delta));
      }, []);
      return cell;
    }, { wrapper });

    expect(result.current.richText).toEqual(delta);
  });

  it('protects stored text that requires a newer rich-text reader', () => {
    const { wrapper, cells } = createFixture();

    cells.get(FIELDS.text.id)!.set(YjsDatabaseKey.rich_text, JSON.stringify({
      v: 99, min_v: 99, text: 'Engineering', delta: [{ insert: 'Engineering', attributes: { bold: true } }],
    }));
    const { result } = renderHook(() => useStoredCellValue({ rowId, fieldId: FIELDS.text.id }) as TextCell, { wrapper });

    expect(result.current.richTextReadOnly).toBe(true);
  });

  it('accepts native integer cell values during its mount consistency check', () => {
    const { wrapper, cells } = createFixture();

    const cell = cells.get(FIELDS.number.id)! as Y.Map<unknown>;
    const getValue = cell.get.bind(cell);

    // Native i64 values arrive through decoding (Y.Map.set itself only accepts
    // JS numbers). Keep a real observed cell while modelling its decoded value.
    jest.spyOn(cell, 'get').mockImplementation((key) => key === YjsDatabaseKey.data
      ? BigInt(Number(getValue(key))) : getValue(key));
    const { result } = renderHook(() => useStoredCellValue({ rowId, fieldId: FIELDS.number.id }), { wrapper });

    expect(result.current?.data).toBe(BigInt(42));
    act(() => { cell.set(YjsDatabaseKey.data, '43'); });
    expect(result.current?.data).toBe(BigInt(43));
  });

  it.each([
    ['Formula', FIELDS.formula],
    ['Rollup', FIELDS.rollup],
  ])('reads a %s cell with useCellSelector', (_name, field) => {
    const { wrapper } = createFixture();

    render(
      <CellValue rowId={rowId} fieldId={field.id} fieldType={field.type}>
        {() => <span data-testid='value' />}
      </CellValue>,
      { wrapper }
    );

    expect(mockUseCellSelector).toHaveBeenCalledWith({ rowId, fieldId: field.id });
  });

  it('gives the value useCellSelector gives, also after the cell changes', () => {
    const { wrapper, cells } = createFixture();

    [FIELDS.text, FIELDS.number, FIELDS.checkbox, FIELDS.url].forEach((field) => {
      const { result } = renderHook(
        () => ({
          stored: useStoredCellValue({ rowId, fieldId: field.id }),
          selected: useCellSelector({ rowId, fieldId: field.id }),
        }),
        { wrapper }
      );

      expect(result.current.stored).toEqual(result.current.selected);
    });

    const { result } = renderHook(() => useStoredCellValue({ rowId, fieldId: FIELDS.text.id }), { wrapper });

    act(() => {
      cells.get(FIELDS.text.id)?.set(YjsDatabaseKey.data, 'Design');
    });
    expect(result.current?.data).toBe('Design');
  });
});
