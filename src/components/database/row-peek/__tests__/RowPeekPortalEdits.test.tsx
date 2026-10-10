import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import { RowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';

const mockUpdateCell = jest.fn();

mockResizeObserver();

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: () => ({ workspaceId: 'workspace', databasePageId: 'database', activeViewId: 'view' }),
  useDatabaseContext: () => ({}),
  useDatabaseView: () => undefined,
  useDatabase: () => undefined,
  useDatabaseViewLayout: () => 0,
  useReadOnly: () => false,
  useFieldSelector: () => ({ field: undefined, clock: 0 }),
  getTypeOptions: () => ({}),
  getFieldDateTimeFormats: () => ({ dateFormat: 0, timeFormat: 1 }),
  useDateTimeCellString: () => '10/10/2026 10:00',
  FieldType: { DateTime: 2 },
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: () => jest.fn(),
  useTrashAwareDeleteRowsDispatch: () => jest.fn(),
  useUpdateCellDispatch: () => mockUpdateCell,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/time', () => ({
  ...jest.requireActual('@/utils/time'),
  getDateFormat: () => 'MM/DD/YYYY',
  getTimeFormat: () => 'HH:mm',
}));
jest.mock('@/components/database/row-peek/side-peek-width', () => ({
  loadSidePeekWidth: async () => undefined,
  saveSidePeekWidth: async () => undefined,
}));
jest.mock('@/components/database/row-peek/RowPeekRowNavigation', () => ({ RowPeekRowNavigation: () => null }));
jest.mock('@/components/database/row-peek/RowPeekDocumentActions', () => ({
  RowPeekDocumentActions: ({ children }: { children?: import('react').ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/database/components/cell/date/DateTimeFormatMenu', () => () => null);
jest.mock('@/components/ui/calendar', () => ({ Calendar: () => null }));
jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: function RowEditor() {
    const Cell = jest.requireActual('@/components/database/components/cell/date/DateTimeCell').DateTimeCell;
    const [editing, setEditing] = useState(true);

    return (
      <Cell
        editing={editing}
        setEditing={setEditing}
        rowId='first'
        fieldId='date'
        cell={{
          data: String(new Date(2026, 9, 10, 10, 0).getTime() / 1000),
          includeTime: true,
        }}
      />
    );
  },
}));

function Fixture() {
  const [open, setOpen] = useState(true);

  return (
    <RowPeekLayout leftOffset={240}>
      <input aria-label='Unrelated page input' />
      {open && <DatabaseRowModal open rowId='first' onOpenChange={setOpen} />}
    </RowPeekLayout>
  );
}

async function editTime(value: string) {
  const input = await screen.findByTestId('datetime-time-input');

  expect(input.closest('[data-testid="row-detail"]')).toBeNull();
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
  mockUpdateCell.mockReset().mockResolvedValue('written');
});

it('flushes a portaled time draft and waits for its cell write before closing the row', async () => {
  let finish!: (status: string) => void;

  mockUpdateCell.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<Fixture />);
  await editTime('18:45');
  fireEvent.click(screen.getByTestId('row-detail-close'));
  await waitFor(() => expect(mockUpdateCell).toHaveBeenCalledTimes(1));
  expect(mockUpdateCell).toHaveBeenCalledWith(String(new Date(2026, 9, 10, 18, 45).getTime() / 1000), {
    includeTime: true,
    isRange: false,
    endTimestamp: undefined,
  });
  expect(screen.getByTestId('row-detail')).toBeTruthy();
  await act(async () => {
    finish('written');
  });
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it('retains the row after a refused date write and permits a corrected retry', async () => {
  mockUpdateCell.mockResolvedValueOnce(undefined);
  render(<Fixture />);
  await editTime('18:45');
  fireEvent.click(screen.getByTestId('row-detail-close'));
  await waitFor(() => expect(mockUpdateCell).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('row-detail')).toBeTruthy();
  await editTime('19:20');
  fireEvent.click(screen.getByTestId('row-detail-close'));
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
  expect(mockUpdateCell).toHaveBeenCalledTimes(2);
});

it('flushes time before Escape dismisses the picker and retains its pending write until row close', async () => {
  let finish!: (status: string) => void;

  mockUpdateCell.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<Fixture />);
  await editTime('18:45');
  fireEvent.keyDown(screen.getByTestId('datetime-time-input'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('datetime-time-input')).toBeNull());
  expect(mockUpdateCell).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId('row-detail-close'));
  await act(async () => undefined);
  expect(screen.getByTestId('row-detail')).toBeTruthy();
  await act(async () => {
    finish('written');
  });
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it('does not blur an unrelated page input when closing the row', async () => {
  render(<Fixture />);
  await screen.findByTestId('datetime-time-input');
  const outside = screen.getByRole('textbox', { name: 'Unrelated page input' });
  const blur = jest.fn();

  outside.addEventListener('blur', blur);
  act(() => outside.focus());
  fireEvent.click(screen.getByTestId('row-detail-close'));
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
  expect(blur).not.toHaveBeenCalled();
  expect(mockUpdateCell).not.toHaveBeenCalled();
});
