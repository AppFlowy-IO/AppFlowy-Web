import { act, fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseHistoryManager } from '@/application/database-yjs';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';
import { DatabaseRow } from '@/components/database/DatabaseRow';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ readOnly: false }),
  useReadOnly: () => false,
  useDatabaseHistoryManager: jest.fn(),
}));
jest.mock('@/components/database/components/cell/text/rich-text/load', () => ({
  usePreloadRichTextCellEditor: jest.fn(),
}));
jest.mock('@/components/database/components/header/DatabaseRowHeader', () => () => (
  <button>Related row title</button>
));
jest.mock('@/components/database/components/database-row', () => {
  const { createPortal } = jest.requireActual<typeof import('react-dom')>('react-dom');

  return {
    DatabaseRowProperties: () =>
      createPortal(<input aria-label='Related property' data-database-history-hotkeys='true' />, document.body),
    RowSubDocument: () => <div contentEditable data-testid='row-document' />,
  };
});
jest.mock('@/components/database/components/database-row/comment', () => ({ RowCommentList: () => null }));
jest.mock('@/components/database/feed/FeedMembersContext', () => ({
  FeedMembersProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/database/feed/FeedRowReactions', () => ({ FeedRowReactions: () => null }));
jest.mock('@/components/database/row-peek/RowPeekNavigation', () => ({ useRowPeekNavigationGuard: jest.fn() }));

function historyManager() {
  return {
    canRedo: () => true,
    canUndo: () => true,
    redo: jest.fn(),
    undo: jest.fn(),
  } as unknown as ReturnType<typeof useDatabaseHistoryManager>;
}

function dispatchHistory(target: EventTarget, redo = false) {
  const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'z',
    shiftKey: redo,
    ...modifier,
  });

  Object.defineProperty(event, 'which', { value: 90 });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

it('routes undo and redo between a related row peek and the interactive background grid', () => {
  const gridHistory = historyManager();
  const peekHistory = historyManager();

  jest.mocked(useDatabaseHistoryManager).mockImplementation((rowId) => (rowId === 'related-row' ? peekHistory : gridHistory));
  render(
    <>
      <DatabaseHistoryScope>
        <div data-testid='grid-cell'>Background cell</div>
      </DatabaseHistoryScope>
      <DatabaseRow rowId='related-row' />
    </>
  );
  const title = screen.getByRole('button', { name: 'Related row title' });
  const gridCell = screen.getByTestId('grid-cell');

  fireEvent.pointerDown(title);
  act(() => title.focus());
  expect(dispatchHistory(title).defaultPrevented).toBe(true);
  expect(peekHistory.undo).toHaveBeenCalledTimes(1);

  // A non-editing cell activates the grid after the peek registered its listener.
  fireEvent.pointerDown(gridCell);
  fireEvent.blur(title, { relatedTarget: null });
  expect(dispatchHistory(gridCell).defaultPrevented).toBe(true);
  expect(dispatchHistory(gridCell, true).defaultPrevented).toBe(true);
  expect(gridHistory.undo).toHaveBeenCalledTimes(1);
  expect(gridHistory.redo).toHaveBeenCalledTimes(1);
  expect(peekHistory.undo).toHaveBeenCalledTimes(1);
  expect(peekHistory.redo).not.toHaveBeenCalled();

  // Portaled property editors still belong to the peek's React focus scope.
  const property = screen.getByRole('textbox', { name: 'Related property' });

  fireEvent.pointerDown(property);
  act(() => property.focus());
  expect(dispatchHistory(property, true).defaultPrevented).toBe(true);
  expect(peekHistory.redo).toHaveBeenCalledTimes(1);
  expect(gridHistory.redo).toHaveBeenCalledTimes(1);

  const documentEditor = screen.getByTestId('row-document');

  act(() => documentEditor.focus());
  expect(dispatchHistory(documentEditor).defaultPrevented).toBe(false);
  expect(peekHistory.undo).toHaveBeenCalledTimes(1);
});
