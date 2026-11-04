import { render, screen } from '@testing-library/react';
import { Context, useEffect } from 'react';

import { RowSubDocument } from '../RowSubDocument';

const mounts: string[] = [];

// `useReadOnly` reads the database context in the app; a context here keeps the
// memoized wrapper re-rendering on access changes exactly as it does there.
jest.mock('@/application/database-yjs', () => {
  const { createContext, useContext } = jest.requireActual<typeof import('react')>('react');
  const ReadOnlyContext = createContext(true);

  return { ReadOnlyContext, useReadOnly: () => useContext(ReadOnlyContext) };
});
jest.mock('@/components/publish/PublishRowSubDocument', () => ({
  PublishRowSubDocument: ({ rowId }: { rowId: string }) => <div data-testid='publish-row-document'>{rowId}</div>,
}));
jest.mock('../DatabaseRowSubDocument', () => ({
  DatabaseRowSubDocument: ({ rowId }: { rowId: string }) => {
    useEffect(() => {
      mounts.push(rowId);
    }, [rowId]);

    return <div data-testid='editable-row-document'>{rowId}</div>;
  },
}));

const { ReadOnlyContext } = jest.requireMock<{ ReadOnlyContext: Context<boolean> }>('@/application/database-yjs');

function rowDocument(rowId: string, readOnly: boolean) {
  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <RowSubDocument rowId={rowId} />
    </ReadOnlyContext.Provider>
  );
}

function shownRenderer() {
  const editable = screen.queryByTestId('editable-row-document');
  const publish = screen.queryByTestId('publish-row-document');

  if (editable && !publish) return `editable:${editable.textContent}`;
  if (publish && !editable) return `publish:${publish.textContent}`;
  return 'none';
}

beforeEach(() => {
  mounts.length = 0;
});

it('keeps the editable row document mounted while access drops to read-only and returns', () => {
  const { rerender } = render(rowDocument('row-a', false));

  // A permission notification clears capabilities until the re-probe answers.
  rerender(rowDocument('row-a', true));
  expect(shownRenderer()).toBe('editable:row-a');

  rerender(rowDocument('row-a', false));
  expect(shownRenderer()).toBe('editable:row-a');
  expect(mounts).toEqual(['row-a']);
});

it('uses the publish renderer for a row first shown read-only', () => {
  render(rowDocument('row-a', true));

  expect(shownRenderer()).toBe('publish:row-a');
});

it('switches to the editable renderer when a read-only row gains write access', () => {
  const { rerender } = render(rowDocument('row-a', true));

  rerender(rowDocument('row-a', false));

  expect(shownRenderer()).toBe('editable:row-a');
});

it('does not carry the editable renderer over to another row opened read-only', () => {
  const { rerender } = render(rowDocument('row-a', false));

  rerender(rowDocument('row-b', true));

  expect(shownRenderer()).toBe('publish:row-b');
});
