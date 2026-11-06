import { act, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { metaIdFromRowId } from '@/application/database-yjs/const';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { YjsEditorKey } from '@/application/types';
import type { LoadRowDocument } from '@/application/types';

import { PublishRowSubDocument } from '../PublishRowSubDocument';

const rowA = '11111111-1111-4111-8111-111111111111';
const rowB = '22222222-2222-4222-8222-222222222222';
const documentA = metaIdFromRowId(rowA)(RowMetaKey.DocumentId);
const documentB = metaIdFromRowId(rowB)(RowMetaKey.DocumentId);
const mockLoad = jest.fn();
let mockLoader: LoadRowDocument | undefined;

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: () => ({ loadRowDocument: mockLoader }),
}));
jest.mock('@/components/_shared/skeleton/EditorSkeleton', () => ({
  EditorSkeleton: () => <div data-testid='loading' />,
}));
jest.mock('@/components/editor', () => ({
  Editor: ({ viewId, doc }: { viewId: string; doc: Y.Doc }) => (
    <div data-testid='editor' data-view-id={viewId}>
      {doc.guid}
    </div>
  ),
}));

function document(id: string) {
  const doc = new Y.Doc({ guid: id });

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
  return doc;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

beforeEach(() => {
  mockLoad.mockReset();
  mockLoader = mockLoad;
});

it.each(['empty', 'failed'] as const)(
  'does not retain the previous row when the next document is %s',
  async (outcome) => {
    const doc = document(documentA);

    mockLoad.mockResolvedValueOnce(doc);
    if (outcome === 'empty') mockLoad.mockResolvedValueOnce(null);
    else mockLoad.mockRejectedValueOnce(new Error('unavailable'));
    const view = render(<PublishRowSubDocument rowId={rowA} />);

    expect((await screen.findByTestId('editor')).textContent).toBe(documentA);
    view.rerender(<PublishRowSubDocument rowId={rowB} />);
    await waitFor(() => expect(mockLoad).toHaveBeenCalledWith(documentB));
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
    expect(screen.queryByTestId('editor')).toBeNull();
    doc.destroy();
  }
);

it('hides the previous row immediately and ignores its late document response', async () => {
  const first = deferred<Y.Doc | null>();
  const second = deferred<Y.Doc | null>();
  const docA = document(documentA);
  const docB = document(documentB);

  mockLoad.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<PublishRowSubDocument rowId={rowA} />);

  view.rerender(<PublishRowSubDocument rowId={rowB} />);
  await act(async () => {
    second.resolve(docB);
  });
  expect((await screen.findByTestId('editor')).getAttribute('data-view-id')).toBe(documentB);
  await act(async () => {
    first.resolve(docA);
  });
  expect(screen.getByTestId('editor').textContent).toBe(documentB);
  view.unmount();
  docA.destroy();
  docB.destroy();
});

it('does not reuse a document when its published snapshot loader changes', async () => {
  const doc = document(documentA);
  const next = deferred<Y.Doc | null>();

  mockLoad.mockResolvedValueOnce(doc);
  const view = render(<PublishRowSubDocument rowId={rowA} />);

  await screen.findByTestId('editor');
  mockLoader = jest.fn(() => next.promise);
  // The mock context is not a real provider; a changed prop models its consumer update.
  view.rerender(<PublishRowSubDocument rowId={rowA} contentPadding='template' />);
  expect(screen.queryByTestId('editor')).toBeNull();
  await act(async () => {
    next.resolve(null);
  });
  expect(screen.queryByTestId('editor')).toBeNull();
  doc.destroy();
});

it('clears the document if its loader is no longer available', async () => {
  const doc = document(documentA);

  mockLoad.mockResolvedValueOnce(doc);
  const view = render(<PublishRowSubDocument rowId={rowA} />);

  await screen.findByTestId('editor');
  mockLoader = undefined;
  view.rerender(<PublishRowSubDocument rowId={rowB} />);
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(screen.queryByTestId('loading')).toBeNull();
  doc.destroy();
});
