import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import * as Y from 'yjs';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { YDoc, YjsEditorKey } from '@/application/types';
import OpenAction from '@/components/database/components/database-row/OpenAction';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import { RowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';

mockResizeObserver();

jest.mock('@/application/database-yjs', () => jest.requireActual('@/application/database-yjs/context'));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: () => jest.fn(),
  useTrashAwareDeleteRowsDispatch: () => jest.fn(),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/database/row-peek/RowPeekRowNavigation', () => ({ RowPeekRowNavigation: () => null }));
jest.mock('@/components/database/row-peek/RowPeekDocumentActions', () => ({
  RowPeekDocumentActions: ({ children }: { children?: import('react').ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: () => <input aria-label='Row draft' defaultValue='Unsaved draft' />,
}));

let doc: YDoc;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
  doc = new Y.Doc() as YDoc;
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, new Y.Map());
});

afterEach(() => doc.destroy());

function Fixture({ readOnly = false, leftOffset = 240 }) {
  const [open, setOpen] = useState(true);
  const context = { databaseDoc: doc, readOnly } as DatabaseContextState;

  return (
    <DatabaseContext.Provider value={context}>
      <RowPeekLayout leftOffset={leftOffset}>
        <OpenAction rowId='first' />
        <button onClick={() => setOpen(true)}>Reopen row</button>
        {open ? <DatabaseRowModal rowId='first' open onOpenChange={setOpen} /> : null}
      </RowPeekLayout>
    </DatabaseContext.Provider>
  );
}

async function chooseMode(mode: 'side' | 'center') {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('row-peek-mode-menu'), { key: 'Enter' });
  });
  expect(screen.queryByTestId('row-default-peek-mode-menu')).toBeNull();
  await act(async () => fireEvent.click(screen.getByTestId(`row-peek-mode-${mode}`)));
}

it.each([false, true])('keeps mode choices temporary and reopens in side peek (readOnly=%s)', async (readOnly) => {
  const updates = jest.fn();

  doc.on('update', updates);
  render(<Fixture readOnly={readOnly} />);
  const editor = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Row draft' });

  fireEvent.change(editor, { target: { value: 'Keep my draft' } });
  await chooseMode('center');
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center');
  expect(screen.getByRole('textbox', { name: 'Row draft' })).toBe(editor);
  expect(editor.value).toBe('Keep my draft');
  await chooseMode('side');
  await chooseMode('center');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('row-detail')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Reopen row' }));
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side'));
  expect(updates).not.toHaveBeenCalled();
});

it.each(['CenterPeek', 'FullPage', 'NewTab'])('ignores legacy %s without rewriting it', async (legacyMode) => {
  const metas = new Y.Map([['row_default_peek_mode:first', legacyMode]]);

  doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)?.set('metas', metas);
  const updates = jest.fn();

  doc.on('update', updates);
  render(<Fixture />);
  await screen.findByRole('textbox', { name: 'Row draft' });
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side');
  await chooseMode('center');
  await chooseMode('side');
  expect(metas.get('row_default_peek_mode:first')).toBe(legacyMode);
  expect(updates).not.toHaveBeenCalled();
});

it('keeps the narrow-window fallback centered until the user switches or reopens', async () => {
  const updates = jest.fn();

  doc.on('update', updates);
  const { rerender } = render(<Fixture leftOffset={800} />);

  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center'));
  rerender(<Fixture leftOffset={240} />);
  await waitFor(() => expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('center'));
  await chooseMode('side');
  expect(screen.getByTestId('row-detail').getAttribute('data-peek-mode')).toBe('side');
  expect(updates).not.toHaveBeenCalled();
});
