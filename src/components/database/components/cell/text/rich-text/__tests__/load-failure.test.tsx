import { act, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from 'react-error-boundary';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { TextCell } from '@/components/database/components/cell/text/TextCell';

import RichTextCellContent from '../RichTextCellContent';

const mockUpdateCell = jest.fn();
const mockLoad = jest.fn();
let mockOffline = true;

function mockField() {
  const field = new Y.Doc().getMap('field') as YDatabaseField;

  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.name, 'Notes');
  return field;
}

jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: () => mockUpdateCell }));
jest.mock('@/application/database-yjs/selector', () => ({ useFieldSelector: () => ({ field: mockField() }) }));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => ({}) }));
// Modules whose load fails while "offline", as a chunk request does.
jest.mock('../RichTextCellEditor', () => {
  mockLoad('editor');
  if (mockOffline) throw new Error('Failed to fetch dynamically imported module');
  return { __esModule: true, default: () => <div data-testid='rich-text-cell-editor' /> };
});
jest.mock('../RichTextCellDocument', () => {
  mockLoad('document');
  if (mockOffline) throw new Error('Failed to fetch dynamically imported module');
  return { __esModule: true, default: () => <div data-testid='rich-text-cell-document' /> };
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('rich text code that cannot be loaded', () => {
  let viewError: jest.Mock;

  beforeEach(() => {
    mockUpdateCell.mockReset();
    viewError = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Renders inside the error boundary a database view has around its content. */
  function renderInView(children: JSX.Element) {
    return render(
      <ErrorBoundary fallback={<div>view failed</div>} onError={viewError}>
        {children}
      </ErrorBoundary>
    );
  }

  it('leaves a Text cell editable as plain text, and its view standing', async () => {
    const setEditing = jest.fn();
    const cell = { fieldType: FieldType.RichText, data: 'Hello', createdAt: 0, lastModified: 0 };

    renderInView(<TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={cell} editing setEditing={setEditing} />);
    await settle();

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');

    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('Hello');
    expect(screen.queryByTestId('rich-text-cell-editor')).toBeNull();
    expect(viewError).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: 'Hello there' } });
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13, which: 13 });
    expect(mockUpdateCell).toHaveBeenCalledWith('Hello there');
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  it('keeps editing as plain text for the rest of the page, as the browser keeps the failed load', async () => {
    const loads = mockLoad.mock.calls.filter(([name]) => name === 'editor').length;

    // Back online: a page that failed to load a module only gets it by reloading.
    mockOffline = false;
    renderInView(<TextCell rowId='row-2' fieldId='field-1' wrap={false} editing />);
    await settle();

    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
    expect(mockLoad.mock.calls.filter(([name]) => name === 'editor')).toHaveLength(loads);
    expect(viewError).not.toHaveBeenCalled();
    mockOffline = true;
  });

  it("shows a cell's mentions and equations as its plain text", async () => {
    renderInView(
      <RichTextCellContent
        rowId='row-1'
        delta={[{ insert: 'Area ' }, { insert: '$', attributes: { formula: 'a^2' } }]}
        text='Area a^2'
      />
    );
    await settle();

    expect(screen.getByTestId('rich-text-cell-content').textContent).toBe('Area a^2');
    expect(screen.queryByTestId('rich-text-cell-document')).toBeNull();
    expect(mockLoad).toHaveBeenCalledWith('document');
    expect(viewError).not.toHaveBeenCalled();
  });
});
