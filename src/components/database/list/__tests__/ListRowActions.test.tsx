import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType, useDatabaseFields } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import type { YDatabaseField, YDatabaseFields } from '@/application/types';

import { getListGroupCellsData, ListRowActions } from '../ListRowActions';
import { ListSortState } from '../ListSortState';

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Number: 1, SingleSelect: 3 },
  useDatabaseFields: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: jest.fn(),
  useNewRowDispatch: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/database/components/database-row/DeleteRowConfirm', () => ({
  __esModule: true,
  default: ({ open, rowIds }: { open: boolean; rowIds: string[] }) =>
    open ? <div data-row-ids={rowIds.join(',')} data-testid='mock-delete-row-confirm' /> : null,
}));

jest.mock('@/components/database/components/sorts/ClearSortingConfirm', () => ({
  __esModule: true,
  default: ({ onClose, onRemoved, open }: { onClose: () => void; onRemoved?: () => void; open: boolean }) =>
    open ? (
      <button
        data-testid='mock-clear-sorts-confirm'
        onClick={() => {
          onRemoved?.();
          onClose();
        }}
        type='button'
      >
        Remove sorting
      </button>
    ) : null,
}));

const mockUseDatabaseFields = useDatabaseFields as jest.MockedFunction<typeof useDatabaseFields>;
const mockUseDuplicateRowDispatch = useDuplicateRowDispatch as jest.MockedFunction<typeof useDuplicateRowDispatch>;
const mockUseNewRowDispatch = useNewRowDispatch as jest.MockedFunction<typeof useNewRowDispatch>;

function createField(fieldId: string, fieldType: FieldType): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, fieldId);
  field.set(YjsDatabaseKey.type, fieldType);
  return field;
}

describe('getListGroupCellsData', () => {
  it('prefills a named group and explicitly clears Desktop default groups', () => {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    fields.set('status', createField('status', FieldType.SingleSelect));

    expect(getListGroupCellsData(fields, 'status', 'todo')).toEqual({ status: 'todo' });
    expect(getListGroupCellsData(fields, 'status', 'status')).toEqual({ status: '' });
  });

  it('uses the lower boundary when creating a row in a number range', () => {
    const fields = new Y.Doc().getMap('fields') as YDatabaseFields;

    fields.set('amount', createField('amount', FieldType.Number));

    expect(getListGroupCellsData(fields, 'amount', 'number_range_200_300')).toEqual({ amount: '200' });
  });
});

describe('ListRowActions', () => {
  const createRow = jest.fn().mockResolvedValue('new-row');
  const duplicateRow = jest.fn().mockResolvedValue('duplicate-row');

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseFields.mockReturnValue(undefined);
    mockUseDuplicateRowDispatch.mockReturnValue(duplicateRow);
    mockUseNewRowDispatch.mockReturnValue(createRow);
  });

  function renderActions(hasSorts = false) {
    return render(
      <ListSortState hasSorts={hasSorts}>
        <ListRowActions
          reorderable
          rowId='row-a'
          rowOrders={[
            { height: 36, id: 'row-a' },
            { height: 36, id: 'row-b' },
          ]}
        />
      </ListSortState>
    );
  }

  async function openMenu() {
    const trigger = screen.getByTestId('row-accessory-button');

    trigger.focus();
    fireEvent.keyDown(trigger, { code: 'Enter', key: 'Enter' });
    await screen.findByTestId('row-menu-insert-above');
  }

  it('inserts above and below using Desktop row-order semantics', async () => {
    renderActions();

    await openMenu();
    fireEvent.click(screen.getByTestId('row-menu-insert-above'));
    await waitFor(() => expect(createRow).toHaveBeenCalledWith({ beforeRowId: undefined, cellsData: undefined }));

    createRow.mockClear();
    await openMenu();
    fireEvent.click(screen.getByTestId('row-menu-insert-below'));
    await waitFor(() => expect(createRow).toHaveBeenCalledWith({ beforeRowId: 'row-a', cellsData: undefined }));
  });

  it('duplicates and opens the trash-aware delete confirmation', async () => {
    renderActions();

    await openMenu();
    fireEvent.click(screen.getByTestId('row-menu-duplicate'));
    await waitFor(() => expect(duplicateRow).toHaveBeenCalledWith('row-a'));

    await openMenu();
    fireEvent.click(screen.getByTestId('row-menu-delete'));
    expect((await screen.findByTestId('mock-delete-row-confirm')).getAttribute('data-row-ids')).toBe('row-a');
  });

  it('requires sorting removal before inserting a row', async () => {
    renderActions(true);

    fireEvent.click(screen.getByTestId('list-row-add-below-row-a'));

    expect(createRow).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('mock-clear-sorts-confirm'));
    await waitFor(() => expect(createRow).toHaveBeenCalledWith({ beforeRowId: 'row-a', cellsData: undefined }));
  });
});
