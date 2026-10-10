import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { DatabaseViewLayout, YDatabase, YDatabaseRowOrders, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import { RowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';
import { useRowPeekNavigationGuard } from '@/components/database/row-peek/RowPeekNavigation';

let mockReadOnly = false;
let mockRows = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
const mockNavigate = jest.fn();
const mockCommit = jest.fn<Promise<boolean>, []>();
let mockView: YDatabaseView;
let mockDatabase: YDatabase;
let mockViewDoc: Y.Doc;
const mockDeleteRows = jest.fn<Promise<void>, [string[]]>();
const mockDuplicateRow = jest.fn<Promise<void>, [string]>();
const mockMount = jest.fn();
const mockUnmount = jest.fn();
const mockLoadWidth = jest.fn<Promise<number | undefined>, []>();
const mockSaveWidth = jest.fn<Promise<void>, [number]>();

mockResizeObserver();

jest.mock('@/components/database/row-peek/side-peek-width', () => ({
  loadSidePeekWidth: () => mockLoadWidth(),
  saveSidePeekWidth: (width: number) => mockSaveWidth(width),
}));

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: () => ({ workspaceId: 'workspace', databasePageId: 'database', activeViewId: 'view' }),
  useReadOnly: () => mockReadOnly,
  useDatabaseView: () => mockView,
  useDatabase: () => mockDatabase,
  useRowOrdersSelector: () => mockRows,
  useNavigateToRow: () => mockNavigate,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: () => mockDuplicateRow,
  useTrashAwareDeleteRowsDispatch: () => mockDeleteRows,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/database/row-peek/RowPeekDocumentActions', () => ({
  RowPeekDocumentActions: ({ children }: { children?: import('react').ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: function RowEditor({ rowId }: { rowId: string }) {
    const [draft, setDraft] = useState(rowId);

    useRowPeekNavigationGuard(() => mockCommit());
    useEffect(() => {
      mockMount();
      return () => {
        mockUnmount();
      };
    }, []);
    return <input aria-label={`Draft ${rowId}`} value={draft} onChange={(event) => setDraft(event.target.value)} />;
  },
}));

function Fixture({
  leftOffset = 240,
  rightOffset = 0,
  rowId = 'first',
  openPage,
}: {
  leftOffset?: number;
  rightOffset?: number;
  rowId?: string;
  openPage?: (rowId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [second, setSecond] = useState(false);
  const [clicks, setClicks] = useState(0);

  return (
    <RowPeekLayout leftOffset={leftOffset} rightOffset={rightOffset}>
      <button onClick={() => setClicks((n) => n + 1)}>Background {clicks}</button>
      <button onClick={() => setSecond(true)}>Another database</button>
      {open ? <DatabaseRowModal open rowId={rowId} openPage={openPage} onOpenChange={setOpen} /> : null}
      {second ? <DatabaseRowModal open rowId='second' onOpenChange={setSecond} /> : null}
    </RowPeekLayout>
  );
}

async function chooseMode(mode: 'side' | 'center') {
  fireEvent.keyDown(screen.getByTestId('row-peek-mode-menu'), { key: 'Enter' });
  fireEvent.click(await screen.findByTestId(`row-peek-mode-${mode}`));
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
  mockReadOnly = false;
  mockRows = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
  jest.clearAllMocks();
  mockViewDoc = new Y.Doc();
  mockDatabase = mockViewDoc.getMap('database') as YDatabase;
  mockView = new Y.Map() as YDatabaseView;
  mockDatabase.set(YjsDatabaseKey.views, new Y.Map([['view', mockView]]));
  mockView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  mockView.set(YjsDatabaseKey.row_orders, new Y.Array() as YDatabaseRowOrders);
  mockView.get(YjsDatabaseKey.row_orders).push(mockRows.map((row) => ({ ...row, height: 36 })));
  mockDeleteRows.mockReset().mockResolvedValue(undefined);
  mockCommit.mockResolvedValue(true);
  mockDuplicateRow.mockReset().mockResolvedValue(undefined);
  mockLoadWidth.mockReset().mockResolvedValue(undefined);
  mockSaveWidth.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  mockViewDoc.destroy();
  jest.restoreAllMocks();
});

it('opens beside an interactive page by default and closes with Escape', async () => {
  render(<Fixture />);
  const editor = await screen.findByRole('textbox', { name: 'Draft first' });

  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side');
  expect(screen.queryByRole('dialog', { name: 'grid.rowPage.centerPeek' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Background 0' }));
  expect(screen.getByRole('button', { name: 'Background 1' })).toBeTruthy();
  expect(document.body.style.overflow).not.toBe('hidden');
  expect(editor.closest('[data-testid="database-side-peek"]')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
  expect(mockCommit).toHaveBeenCalledTimes(1);
});

it.each(['side', 'center'] as const)(
  'closes %s peek with Escape when a closed MUI popover is still mounted',
  async (mode) => {
    const { unmount } = render(
      <>
        <div className='MuiModal-root' aria-hidden='true' />
        <Fixture />
      </>
    );

    await screen.findByRole('textbox', { name: 'Draft first' });
    if (mode === 'center') await chooseMode('center');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Draft first' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
    unmount();
  }
);

it.each(['side', 'center'] as const)('lets an open menu handle Escape without closing the %s peek', async (mode) => {
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  if (mode === 'center') await chooseMode('center');
  fireEvent.keyDown(screen.getByTestId('row-peek-mode-menu'), { key: 'Enter' });
  await screen.findByRole('menu');
  // The center shell is a MUI dialog: its own Escape handling must stay off.
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe(mode);
  expect(mockCommit).not.toHaveBeenCalled();
});

it('closes immediately after returning to side peek while the center shell exits', async () => {
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  await chooseMode('center');
  await chooseMode('side');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it('keeps the same editor and draft across center/side transitions and viewport fallback', async () => {
  const { rerender } = render(<Fixture />);
  const editor = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Draft first' });

  fireEvent.change(editor, { target: { value: 'Uncommitted draft' } });
  await chooseMode('center');
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center'));
  expect(screen.getByTestId('database-side-peek').hidden).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);
  expect(editor.value).toBe('Uncommitted draft');
  await chooseMode('side');
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side'));
  rerender(<Fixture leftOffset={800} />);
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center'));
  expect(screen.getByTestId('database-side-peek').hidden).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);
  expect(editor.value).toBe('Uncommitted draft');
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockUnmount).not.toHaveBeenCalled();
});

it('resizes with the keyboard within the space remaining beside other panels', async () => {
  render(<Fixture rightOffset={100} />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  const resizer = screen.getByRole('separator');

  expect(resizer.getAttribute('aria-valuenow')).toBe('560');
  fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
  expect(resizer.getAttribute('aria-valuenow')).toBe('592');
  fireEvent.keyDown(resizer, { key: 'End' });
  expect(Number(resizer.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(734);
  fireEvent.keyDown(resizer, { key: 'Home' });
  expect(resizer.getAttribute('aria-valuenow')).toBe('560');
  expect(screen.getByTestId('database-side-peek').style.right).toBe('100px');
  expect(mockSaveWidth.mock.calls.map(([width]) => width)).toEqual([592, (1100 * 2) / 3, 560]);
});

it('restores the preferred width and preserves it while neighboring panels constrain the available space', async () => {
  mockLoadWidth.mockResolvedValue(720);
  const { rerender } = render(<Fixture />);

  await waitFor(() => expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('720'));
  rerender(<Fixture rightOffset={250} />);
  expect(Number(screen.getByRole('separator').getAttribute('aria-valuenow'))).toBeLessThan(720);
  rerender(<Fixture leftOffset={800} />);
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center'));
  rerender(<Fixture />);
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center');
  await chooseMode('side');
  await waitFor(() => expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('720'));
  expect(mockLoadWidth).toHaveBeenCalledTimes(1);
  expect(mockSaveWidth).not.toHaveBeenCalled();
});

it('does not let a delayed stored width overwrite a new user resize', async () => {
  let finishLoad!: (width: number) => void;

  mockLoadWidth.mockReturnValue(
    new Promise((resolve) => {
      finishLoad = resolve;
    })
  );
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  const resizer = screen.getByRole('separator');

  fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
  await act(async () => finishLoad(720));
  expect(resizer.getAttribute('aria-valuenow')).toBe('592');
  expect(mockSaveWidth).toHaveBeenLastCalledWith(592);
});

it('writes the final drag width once on release, without writing each pointer move', async () => {
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  const resizer = screen.getByRole('separator');

  resizer.setPointerCapture = jest.fn();
  resizer.hasPointerCapture = jest.fn(() => true);
  resizer.releasePointerCapture = jest.fn();
  // jsdom lacks PointerEvent; browser coverage exercises native pointer capture.
  const pointer = (type: string, clientX: number) =>
    fireEvent(resizer, new MouseEvent(type, { bubbles: true, button: 0, clientX }));

  pointer('pointerdown', 800);
  pointer('pointermove', 740);
  pointer('pointermove', 680);
  expect(resizer.getAttribute('aria-valuenow')).toBe('680');
  expect(mockSaveWidth).not.toHaveBeenCalled();
  pointer('pointerup', 680);
  fireEvent.lostPointerCapture(resizer);
  expect(mockSaveWidth).toHaveBeenCalledTimes(1);
  expect(mockSaveWidth).toHaveBeenCalledWith(680);
  pointer('pointerdown', 680);
  pointer('pointerup', 680);
  expect(mockSaveWidth).toHaveBeenCalledTimes(1);
});

it('retains an invalid draft on close and refuses another database until saved', async () => {
  mockCommit.mockResolvedValue(false);
  render(<Fixture />);
  const editor = await screen.findByRole('textbox', { name: 'Draft first' });

  fireEvent.change(editor, { target: { value: 'Rejected draft' } });
  fireEvent.click(screen.getByTestId('row-detail-close'));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);
  fireEvent.click(screen.getByRole('button', { name: 'Another database' }));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('textbox', { name: 'Draft second' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);

  mockCommit.mockResolvedValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Another database' }));
  await screen.findByRole('textbox', { name: 'Draft second' });
  expect(screen.queryByRole('textbox', { name: 'Draft first' })).toBeNull();
  expect(screen.getAllByTestId('row-detail')).toHaveLength(1);
});

it.each([false, true])('keeps replacement authorization through viewport fallback (saved=%s)', async (saved) => {
  let finish!: (saved: boolean) => void;

  mockCommit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { rerender } = render(<Fixture />);
  const editor = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Draft first' });

  fireEvent.change(editor, { target: { value: 'Pending draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Another database' }));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  rerender(<Fixture leftOffset={800} />);
  expect(screen.queryByRole('textbox', { name: 'Draft second' })).toBeNull();
  expect(screen.getAllByTestId('row-detail')).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);
  expect(editor.value).toBe('Pending draft');
  rerender(<Fixture />);
  expect(screen.queryByRole('textbox', { name: 'Draft second' })).toBeNull();
  rerender(<Fixture leftOffset={800} />);

  await act(async () => finish(saved));
  expect(screen.getAllByTestId('row-detail')).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: saved ? 'Draft second' : 'Draft first' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: saved ? 'Draft first' : 'Draft second' })).toBeNull();
  rerender(<Fixture />);
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center'));
  expect(screen.getAllByTestId('row-detail')).toHaveLength(1);
  expect(screen.getByTestId('database-side-peek').hidden).toBe(true);
  expect(mockCommit).toHaveBeenCalledTimes(1);
});

it('waits for the accepted save before closing', async () => {
  let finish!: (saved: boolean) => void;

  mockCommit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  fireEvent.click(screen.getByTestId('row-detail-close'));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('row-detail')).toBeTruthy();
  await act(async () => {
    finish(true);
  });
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it('blocks repeated duplication while saving the draft and creating the copy', async () => {
  let finishSave!: (saved: boolean) => void;
  let finishDuplicate!: () => void;

  mockCommit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  mockDuplicateRow.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishDuplicate = resolve;
      })
  );
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  fireEvent.keyDown(screen.getByTestId('row-detail-more-actions'), { key: 'Enter' });
  fireEvent.click(await screen.findByTestId('row-detail-duplicate'));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));

  fireEvent.keyDown(screen.getByTestId('row-detail-more-actions'), { key: 'Enter' });
  const duplicate = await screen.findByTestId('row-detail-duplicate');

  expect(duplicate.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(duplicate);
  expect(mockDuplicateRow).not.toHaveBeenCalled();
  await act(async () => {
    finishSave(true);
  });
  expect(mockDuplicateRow).toHaveBeenCalledTimes(1);
  expect(mockDuplicateRow).toHaveBeenCalledWith('first');
  expect(duplicate.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(duplicate);
  expect(mockDuplicateRow).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishDuplicate();
  });
  expect(screen.queryByTestId('row-detail')).toBeNull();
});

it('allows duplication to retry after a rejected save or failed copy', async () => {
  mockCommit.mockResolvedValueOnce(false);
  mockDuplicateRow.mockRejectedValueOnce(new Error('Copy failed'));
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });

  for (let attempt = 0; attempt < 3; attempt++) {
    fireEvent.keyDown(screen.getByTestId('row-detail-more-actions'), { key: 'Enter' });
    const duplicate = await screen.findByTestId('row-detail-duplicate');

    expect(duplicate.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => {
      fireEvent.click(duplicate);
    });
    expect(mockCommit).toHaveBeenCalledTimes(attempt + 1);
    expect(mockDuplicateRow).toHaveBeenCalledTimes(attempt);
  }

  expect(screen.queryByTestId('row-detail')).toBeNull();
});

it.each(['side', 'center'] as const)(
  'keeps %s navigation visible and uses the current filtered row order',
  async (mode) => {
    const { rerender } = render(<Fixture />);

    await screen.findByRole('textbox', { name: 'Draft first' });
    if (mode === 'center') await chooseMode('center');
    expect(screen.getByRole('button', { name: 'grid.rowPage.previousRow' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'grid.rowPage.nextRow' })).toBeTruthy();
    if (mode === 'center') expect(screen.queryByTestId('row-detail-close')).toBeNull();
    expect(screen.getByTestId('row-peek-previous').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('row-peek-next'));
    expect(mockNavigate).toHaveBeenLastCalledWith('second');
    mockReadOnly = true;
    mockRows = [{ id: 'third' }, { id: 'first' }];
    rerender(<Fixture />);
    expect(screen.queryByTestId('row-detail-more-actions')).toBeNull();
    expect(screen.getByTestId('row-peek-next').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('row-peek-previous'));
    expect(mockNavigate).toHaveBeenLastCalledWith('third');
    mockReadOnly = false;
    rerender(<Fixture />);
    expect(within(screen.getByTestId('row-detail')).getByTestId('row-detail-more-actions')).toBeTruthy();
  }
);

it('disables both directions when the current row leaves the visible results', async () => {
  const { rerender } = render(<Fixture />);

  await screen.findByRole('textbox', { name: 'Draft first' });
  mockRows = [{ id: 'second' }, { id: 'third' }];
  rerender(<Fixture />);
  expect(screen.getByTestId<HTMLButtonElement>('row-peek-previous').disabled).toBe(true);
  expect(screen.getByTestId<HTMLButtonElement>('row-peek-next').disabled).toBe(true);
  for (const key of ['n', 'p']) fireEvent.keyDown(document, { key, ctrlKey: true, shiftKey: true });
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['ctrlKey', 'metaKey'])(
  'handles %s row shortcuts once and ignores them during composition or an open menu',
  async (modifier) => {
    const { unmount } = render(<Fixture rowId='second' />);
    const editor = await screen.findByRole('textbox', { name: 'Draft second' });
    const shortcut = { key: 'N', [modifier]: true, shiftKey: true };

    fireEvent.keyDown(editor, { ...shortcut, isComposing: true });
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('row-peek-mode-menu'), { key: 'Enter' });
    const menu = await screen.findByRole('menu');

    fireEvent.keyDown(menu, shortcut);
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.keyDown(editor, shortcut);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenLastCalledWith('third');
    fireEvent.keyDown(editor, { ...shortcut, key: 'P' });
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenLastCalledWith('first');

    unmount();
    fireEvent.keyDown(document, shortcut);
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  }
);

it('preserves a rejected save and retries before opening the full page', async () => {
  const openPage = jest.fn();

  mockCommit.mockResolvedValueOnce(false);
  render(<Fixture openPage={openPage} />);
  const editor = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Draft first' });

  fireEvent.change(editor, { target: { value: 'Unsaved document' } });
  fireEvent.click(screen.getByTestId('row-detail-open-full-page'));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  expect(openPage).not.toHaveBeenCalled();
  expect(editor.value).toBe('Unsaved document');
  expect(mockUnmount).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('row-detail-open-full-page'));
  await waitFor(() => expect(openPage).toHaveBeenCalledWith('first'));
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it('keeps the editor mounted until a delayed full-page navigation completes', async () => {
  let finishSave!: (saved: boolean) => void;
  let finishNavigation!: () => void;
  const openPage = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finishNavigation = resolve;
      })
  );

  mockCommit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  render(<Fixture openPage={openPage} />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  fireEvent.click(screen.getByTestId('row-detail-open-full-page'));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  expect(openPage).not.toHaveBeenCalled();
  await act(async () => {
    finishSave(true);
  });
  expect(openPage).toHaveBeenCalledWith('first');
  expect(mockUnmount).not.toHaveBeenCalled();
  await act(async () => {
    finishNavigation();
  });
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it.each(['close', 'full page', 'delete'])('does not let a stale %s save dismiss a replacement row', async (action) => {
  let finish!: (saved: boolean) => void;
  const openPage = jest.fn();

  mockCommit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { rerender } = render(<Fixture openPage={openPage} />);

  await screen.findByRole('textbox', { name: 'Draft first' });
  if (action === 'delete') {
    fireEvent.keyDown(screen.getByTestId('row-detail-more-actions'), { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('row-detail-delete'));
  } else {
    fireEvent.click(screen.getByTestId(action === 'close' ? 'row-detail-close' : 'row-detail-open-full-page'));
  }

  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  rerender(<Fixture rowId='second' openPage={openPage} />);
  await screen.findByRole('textbox', { name: 'Draft second' });
  await act(async () => {
    finish(true);
  });
  expect(screen.getByRole('textbox', { name: 'Draft second' })).toBeTruthy();
  expect(openPage).not.toHaveBeenCalled();
  expect(mockDeleteRows).not.toHaveBeenCalled();
});

it.each([true, false])('reserves a new tab synchronously and waits for save acceptance (%s)', async (saved) => {
  let finish!: (saved: boolean) => void;
  const replace = jest.fn();
  const closeTab = jest.fn();
  const tab = { location: { replace }, close: closeTab, opener: window } as unknown as Window;
  const open = jest.spyOn(window, 'open').mockReturnValue(tab);

  mockCommit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  fireEvent.keyDown(screen.getByTestId('row-peek-mode-menu'), { key: 'Enter' });
  fireEvent.click(await screen.findByTestId('row-peek-new-tab'));
  expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  expect(tab.opener).toBeNull();
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  expect(replace).not.toHaveBeenCalled();
  expect(closeTab).not.toHaveBeenCalled();
  await act(async () => {
    finish(saved);
  });
  if (saved) {
    expect(replace).toHaveBeenCalledWith(`${window.location.origin}/app/workspace/database?v=view&r=first`);
    expect(closeTab).not.toHaveBeenCalled();
  } else {
    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  }

  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBeTruthy();
  expect(mockUnmount).not.toHaveBeenCalled();
});

it.each([DatabaseViewLayout.Calendar, DatabaseViewLayout.Timeline])(
  'opens layout %s centered and still allows an explicit side choice',
  async (layout) => {
    mockView.set(YjsDatabaseKey.layout, layout);
    render(<Fixture />);
    await screen.findByRole('textbox', { name: 'Draft first' });
    expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center');
    await chooseMode('side');
    expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side');
  }
);

it('keeps an automatic center fallback after widening, with the same editor and draft', async () => {
  const { rerender } = render(<Fixture />);
  const editor = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Draft first' });

  fireEvent.change(editor, { target: { value: 'Keep this draft' } });
  rerender(<Fixture leftOffset={800} />);
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center');
  rerender(<Fixture />);
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center');
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);
  expect(editor.value).toBe('Keep this draft');
  await chooseMode('side');
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side');
});

it('does not let a mode tooltip close the row when another popup owns Escape', async () => {
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  act(() => screen.getByTestId('row-peek-mode-menu').focus());
  await screen.findByRole('tooltip');
  const popup = document.createElement('div');

  popup.setAttribute('role', 'menu');
  document.body.append(popup);
  try {
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.getByTestId('row-detail')).toBeTruthy();
    expect(mockCommit).not.toHaveBeenCalled();
  } finally {
    popup.remove();
  }
});

it.each(['side', 'center'] as const)('allows deleting a rejected draft in %s peek', async (mode) => {
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  if (mode === 'center') await chooseMode('center');
  mockCommit.mockResolvedValue(false);
  fireEvent.keyDown(screen.getByTestId('row-detail-more-actions'), { key: 'Enter' });
  fireEvent.click(await screen.findByTestId('row-detail-delete'));
  await waitFor(() => expect(mockDeleteRows).toHaveBeenCalledWith(['first']));
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it.each(['side', 'center'] as const)(
  'closes %s peek when its row is externally deleted despite a rejected draft',
  async (mode) => {
    render(<Fixture />);
    await screen.findByRole('textbox', { name: 'Draft first' });
    if (mode === 'center') await chooseMode('center');
    mockCommit.mockClear().mockResolvedValue(false);
    act(() => mockView.get(YjsDatabaseKey.row_orders).delete(0, 1));
    await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockDeleteRows).not.toHaveBeenCalled();
  }
);

it('closes a peek when its row is tombstoned', async () => {
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  act(() =>
    mockViewDoc.transact(() => {
      const orders = mockView.get(YjsDatabaseKey.row_orders);

      orders.delete(0, 1);
      orders.insert(0, [{ id: 'first', height: 36, is_deleted: true }]);
    })
  );
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
});

it('uses the inline view tombstone when a linked view still contains the row', async () => {
  const canonical = new Y.Map() as YDatabaseView;

  mockDatabase.get(YjsDatabaseKey.views).set('inline', canonical);
  canonical.set(YjsDatabaseKey.is_inline, true);
  canonical.set(YjsDatabaseKey.row_orders, new Y.Array());
  canonical.get(YjsDatabaseKey.row_orders).push([{ id: 'first', height: 36 }]);
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  act(() =>
    mockViewDoc.transact(() => {
      const orders = canonical.get(YjsDatabaseKey.row_orders);

      orders.delete(0, 1);
      orders.insert(0, [{ id: 'first', height: 36, is_deleted: true }]);
    })
  );
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
  expect(mockView.get(YjsDatabaseKey.row_orders).get(0).is_deleted).toBeUndefined();
});

it('keeps a linked-view peek open if its stale tombstone is overridden by the inline view', async () => {
  const canonical = new Y.Map() as YDatabaseView;

  mockDatabase.get(YjsDatabaseKey.views).set('inline', canonical);
  canonical.set(YjsDatabaseKey.is_inline, true);
  canonical.set(YjsDatabaseKey.row_orders, new Y.Array());
  canonical.get(YjsDatabaseKey.row_orders).push([{ id: 'first', height: 36 }]);
  mockView.get(YjsDatabaseKey.row_orders).delete(0, 1);
  mockView.get(YjsDatabaseKey.row_orders).insert(0, [{ id: 'first', height: 36, is_deleted: true }]);
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  expect(screen.getByTestId('row-detail')).toBeTruthy();
});

it('keeps the peek open while filtering or reordering its row and detaches deletion listeners on close', async () => {
  const { rerender, unmount } = render(<Fixture />);
  const editor = await screen.findByRole('textbox', { name: 'Draft first' });

  mockRows = [{ id: 'second' }];
  rerender(<Fixture />);
  act(() =>
    mockViewDoc.transact(() => {
      const orders = mockView.get(YjsDatabaseKey.row_orders);
      const first = orders.get(0);

      orders.delete(0, 1);
      orders.push([first]);
    })
  );
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);
  const stopObserving = jest.spyOn(mockDatabase, 'unobserveDeep');

  unmount();
  expect(stopObserving).toHaveBeenCalled();
});

it('advertises the P/N shortcuts supported by the row navigation buttons', async () => {
  render(<Fixture rowId='second' />);
  await screen.findByRole('textbox', { name: 'Draft second' });
  expect(screen.getByTestId('row-peek-previous').getAttribute('aria-keyshortcuts')).toBe('Control+Shift+P Meta+Shift+P');
  expect(screen.getByTestId('row-peek-next').getAttribute('aria-keyshortcuts')).toBe('Control+Shift+N Meta+Shift+N');
});
