import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { BoardProvider, useBoardActions, useBoardSelection } from '@/components/database/board/BoardProvider';
import ColumnHeader from '@/components/database/components/board/column/ColumnHeaderPrimitive';

jest.mock('@/application/database-yjs', () => ({
  useReadOnly: () => false,
  useGroupsSelector: () => ['group'],
  useBoardLayoutSettings: () => ({ fieldId: 'status' }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: jest.fn(),
  useMoveCardDispatch: () => jest.fn(),
}));
jest.mock('@/components/database/components/board/column/useRenderColumn', () => ({
  useRenderColumn: () => ({ header: 'Column', renameEnabled: false, deleteEnabled: false, hideEnabled: false }),
}));
jest.mock('@/components/database/components/board/column/ColumnMenu', () => ({ ColumnMenu: () => null }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/errors', () => ({ getErrorMessage: () => 'Localized refusal' }));
jest.mock('@/utils/log', () => ({ Log: { error: jest.fn() } }));

const create = jest.fn();
const dispatch = useNewRowDispatch as jest.Mock;

function Harness() {
  const actions = useBoardActions();
  const selection = useBoardSelection();

  return (
    <>
      <ColumnHeader
        id='todo'
        groupId='group'
        fieldId='status'
        rowCount={0}
        getCards={() => []}
        addCardBefore={(id) => {
          void actions.createCard(id);
        }}
      />
      <ColumnHeader
        id='todo'
        groupId='group'
        fieldId='status'
        rowCount={0}
        getCards={() => []}
        addCardBefore={(id) => {
          void actions.createCard(id);
        }}
      />
      <button
        onClick={() => {
          void actions.createCard('todo', 'todo/previous');
        }}
      >
        keyboard create
      </button>
      <button onClick={() => actions.setSelectedCardIds(['todo/previous'])}>select existing</button>
      <output data-testid='selection'>{JSON.stringify(selection)}</output>
    </>
  );
}

function state() {
  return JSON.parse(screen.getByTestId('selection').textContent!);
}

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  dispatch.mockReturnValue(create);
});

test('header and sticky header share pending progress and suppress another creation gesture', async () => {
  const request = deferred();

  create.mockReturnValue(request.promise);
  render(
    <BoardProvider>
      <Harness />
    </BoardProvider>
  );
  const buttons = screen.getAllByTestId('board-add-card');

  fireEvent.click(buttons[0]);
  expect(buttons.every((button) => button.disabled && button.getAttribute('aria-busy') === 'true')).toBe(true);
  expect(buttons.every((button) => button.querySelector('.animate-spin'))).toBe(true);
  fireEvent.click(buttons[1]);
  fireEvent.click(screen.getByText('keyboard create'));
  expect(create).toHaveBeenCalledTimes(1);
  expect(state().editingCardId).toBeNull();
  await act(async () => request.resolve('created'));
  expect(state().editingCardId).toBe('todo/created');
  expect(state().pendingColumnId).toBeNull();
  expect(buttons.every((button) => !button.disabled)).toBe(true);
});

test('keyboard refusal preserves the selection, reports one localized error and enables retry', async () => {
  const request = deferred();

  create.mockReturnValue(request.promise);
  render(
    <BoardProvider>
      <Harness />
    </BoardProvider>
  );
  fireEvent.click(screen.getByText('select existing'));
  fireEvent.click(screen.getByText('keyboard create'));
  fireEvent.click(screen.getByText('keyboard create'));
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({ cellsData: { status: 'todo' }, beforeRowId: 'previous' });
  await act(async () => request.reject(new Error('offline')));
  expect(toast.error).toHaveBeenCalledWith('Localized refusal');
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(state()).toMatchObject({ selectedCardIds: ['todo/previous'], editingCardId: null, pendingColumnId: null });
  create.mockResolvedValue('retried');
  await act(async () => {
    fireEvent.click(screen.getByText('keyboard create'));
  });
  expect(state().editingCardId).toBe('todo/retried');
});

test('late creation rejection after unmount does not show an unrelated toast', async () => {
  const request = deferred();

  create.mockReturnValue(request.promise);
  const view = render(
    <BoardProvider>
      <Harness />
    </BoardProvider>
  );

  fireEvent.click(screen.getByText('keyboard create'));
  view.unmount();
  await act(async () => request.reject(new Error('late network refusal')));
  expect(toast.error).not.toHaveBeenCalled();
});
