import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';

import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import { RowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';
import { useRowPeekNavigationGuard } from '@/components/database/row-peek/RowPeekNavigation';

let mockReadOnly = false;
let mockRows = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
const mockNavigate = jest.fn();
const mockCommit = jest.fn<Promise<boolean>, []>();
const mockMount = jest.fn();
const mockUnmount = jest.fn();

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: () => ({ workspaceId: 'workspace', databasePageId: 'database', activeViewId: 'view' }),
  useReadOnly: () => mockReadOnly,
  useRowOrdersSelector: () => mockRows,
  useNavigateToRow: () => mockNavigate,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: () => jest.fn(),
  useTrashAwareDeleteRowsDispatch: () => jest.fn(),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
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
  mockCommit.mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

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

it('lets an open menu handle Escape without closing the peek', async () => {
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Draft first' });
  fireEvent.keyDown(screen.getByTestId('row-peek-mode-menu'), { key: 'Enter' });
  await screen.findByRole('menu');
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(screen.getByTestId('row-detail')).toBeTruthy();
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
  expect(screen.getByRole('textbox', { name: 'Draft first' })).toBe(editor);
  expect(editor.value).toBe('Uncommitted draft');
  await chooseMode('side');
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side'));
  rerender(<Fixture leftOffset={800} />);
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center'));
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

it('reacts to access changes and uses the current filtered row order', async () => {
  const { rerender } = render(<Fixture />);

  await screen.findByRole('textbox', { name: 'Draft first' });
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
});

it('disables both directions when the current row leaves the visible results', async () => {
  const { rerender } = render(<Fixture />);

  await screen.findByRole('textbox', { name: 'Draft first' });
  mockRows = [{ id: 'second' }, { id: 'third' }];
  rerender(<Fixture />);
  expect(screen.getByTestId<HTMLButtonElement>('row-peek-previous').disabled).toBe(true);
  expect(screen.getByTestId<HTMLButtonElement>('row-peek-next').disabled).toBe(true);
  for (const key of ['j', 'k']) fireEvent.keyDown(document, { key, ctrlKey: true, shiftKey: true });
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['ctrlKey', 'metaKey'])(
  'handles %s row shortcuts once and ignores them during composition or an open menu',
  async (modifier) => {
    const { unmount } = render(<Fixture rowId='second' />);
    const editor = await screen.findByRole('textbox', { name: 'Draft second' });
    const shortcut = { key: 'J', [modifier]: true, shiftKey: true };

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
    fireEvent.keyDown(editor, { ...shortcut, key: 'K' });
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

it.each(['close', 'full page'])('does not let a stale %s save dismiss a replacement row', async (action) => {
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
  fireEvent.click(screen.getByTestId(action === 'close' ? 'row-detail-close' : 'row-detail-open-full-page'));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  rerender(<Fixture rowId='second' openPage={openPage} />);
  await screen.findByRole('textbox', { name: 'Draft second' });
  await act(async () => {
    finish(true);
  });
  expect(screen.getByRole('textbox', { name: 'Draft second' })).toBeTruthy();
  expect(openPage).not.toHaveBeenCalled();
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
