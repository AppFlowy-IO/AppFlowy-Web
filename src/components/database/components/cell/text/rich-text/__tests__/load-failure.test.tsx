import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from 'react-error-boundary';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';
import { MentionType, YDatabaseField, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { TextCell } from '@/components/database/components/cell/text/TextCell';

import RichTextCellContent from '../RichTextCellContent';

const mockUpdateCell = jest.fn();
const mockLoad = jest.fn();
const mockEditors: ReactEditor[] = [];
let mockContext: Record<string, unknown>;
let mockRichTextField: YDatabaseField;
let mockOffline = true;
let mockDocumentCrashes = false;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: () => mockUpdateCell }));
jest.mock('@/application/database-yjs/selector', () => ({
  useFieldSelector: () => ({ field: mockRichTextField }),
}));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => mockContext }));
jest.mock('@/components/editor/components/panels/mention-panel/useNotifyPersonMention', () => ({
  useNotifyPersonMention: () => jest.fn(async () => true),
}));
jest.mock('../rich-text-slate', () => {
  const actual = jest.requireActual('../rich-text-slate');

  return {
    ...actual,
    withRichTextCell: (...args: Parameters<typeof actual.withRichTextCell>) => {
      const editor = actual.withRichTextCell(...args);

      mockEditors.push(editor);
      return editor;
    },
  };
});
// Only optional menus are asynchronous; editable leaves and read-only chips
// ship with the cell.
jest.mock('../RichTextCellEditorUI', () => {
  mockLoad('ui');
  if (mockOffline) throw new Error('Failed to fetch dynamically imported module');
  return { RichTextCellEditorControls: () => null };
});
jest.mock('../RichTextCellDocument', () => ({
  __esModule: true,
  default: () => {
    if (mockDocumentCrashes) throw new Error('cannot render');
    return <div data-testid='rich-text-cell-document' />;
  },
}));

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const richText: RichTextDelta = [
  { insert: 'Hello ', attributes: { bold: true } },
  { insert: '@', attributes: { mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } } },
];

describe('optional rich text code that cannot be loaded', () => {
  let viewError: jest.Mock;

  beforeEach(() => {
    mockUpdateCell.mockReset().mockResolvedValue('written');
    mockEditors.length = 0;
    const databaseDoc = new Y.Doc();
    const database = new Y.Map();
    const fields = new Y.Map();

    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.fields, fields);
    mockRichTextField = new Y.Map() as YDatabaseField;
    fields.set('field-1', mockRichTextField);
    mockRichTextField.set(YjsDatabaseKey.type, FieldType.RichText);
    mockRichTextField.set(YjsDatabaseKey.name, 'Notes');
    mockContext = { workspaceId: 'workspace', databaseDoc };
    viewError = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  function renderInView(children: JSX.Element) {
    return render(
      <ErrorBoundary fallback={<div>view failed</div>} onError={viewError}>
        {children}
      </ErrorBoundary>
    );
  }

  it('keeps the eager input and its rich draft after optional UI fails', async () => {
    const setEditing = jest.fn();
    const cell = { fieldType: FieldType.RichText, data: 'Hello @Ada', richText, createdAt: 0, lastModified: 0 };

    renderInView(<TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={cell} editing setEditing={setEditing} />);
    const editable = screen.getByRole('textbox');
    const editor = mockEditors[0];

    expect(editable.tagName).toBe('DIV');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    // Type before the optional import rejects, so recovery must retain a
    // dirty draft as well as the original rich content.
    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
      editor.insertText('!');
    });
    await settle();
    expect(screen.getByRole('textbox')).toBe(editable);
    expect(editable.querySelector('strong')?.textContent).toBe('Hello ');
    expect(editable.textContent).toContain('@Ada');
    expect(Editor.string(editor, [])).toBe('Hello @!');
    expect(mockUpdateCell).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(editable, { key: 'Enter', keyCode: 13, which: 13 }));
    expect(mockUpdateCell).toHaveBeenCalledTimes(1);
    const [text, , options] = mockUpdateCell.mock.calls[0];

    expect(text).toBe('Hello @Ada!');
    expect(JSON.parse(options.richText).delta).toEqual([
      richText[0],
      { insert: '@', attributes: { mention: { ...richText[1].attributes?.mention, label: '@Ada' } } },
      { insert: '!' },
    ]);
    expect(setEditing).toHaveBeenCalledWith(false);
    expect(viewError).not.toHaveBeenCalled();
    expect(mockLoad).toHaveBeenCalledWith('ui');
  });

  it('keeps later editing sessions usable after the optional chunk failed', async () => {
    mockOffline = false;
    renderInView(<TextCell rowId='row-2' fieldId='field-1' wrap={false} editing />);
    await settle();

    expect(screen.getByRole('textbox').tagName).toBe('DIV');
    expect(screen.getByTestId('rich-text-cell-editor')).toBeTruthy();
    expect(viewError).not.toHaveBeenCalled();
    mockOffline = true;
  });

  it("shows a cell's mentions and equations at once, whatever happened to the optional chunk", () => {
    renderInView(
      <RichTextCellContent
        rowId='row-1'
        delta={[{ insert: 'Area ' }, { insert: '$', attributes: { formula: 'a^2' } }]}
        text='Area a^2'
      />
    );

    // No loading frame: the chip renderer is not a chunk of its own.
    expect(screen.getByTestId('rich-text-cell-document')).toBeTruthy();
    expect(viewError).not.toHaveBeenCalled();
  });

  it("shows a cell's mentions and equations as plain text if they cannot be rendered", () => {
    mockDocumentCrashes = true;
    renderInView(
      <RichTextCellContent
        rowId='row-1'
        delta={[{ insert: 'Area ' }, { insert: '$', attributes: { formula: 'a^2' } }]}
        text='Area a^2'
      />
    );
    mockDocumentCrashes = false;

    expect(screen.getByTestId('rich-text-cell-content').textContent).toBe('Area a^2');
    expect(screen.queryByTestId('rich-text-cell-document')).toBeNull();
    expect(viewError).not.toHaveBeenCalled();
  });
});
