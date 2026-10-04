import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';
import { MentionType, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { RichTextCellEditor } from '../load';
import { slateValueToRichText } from '../rich-text-slate';

const mockUpdateCell = jest.fn();
const mockEditors: ReactEditor[] = [];
let mockContext: Record<string, unknown>;
let mockResolveUI!: (module: unknown) => void;
const mockUIPromise = Object.assign(
  new Promise((resolve) => {
    mockResolveUI = resolve;
  }),
  { __esModule: true }
);

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: () => mockUpdateCell }));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => mockContext }));
jest.mock('@/components/editor/components/panels/mention-panel/useNotifyPersonMention', () => ({
  useNotifyPersonMention: () => jest.fn(async () => true),
}));
jest.mock('../RichTextCellEditorUI', () => mockUIPromise);
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

const richText: RichTextDelta = [
  { insert: 'Hello ', attributes: { bold: true } },
  { insert: '@', attributes: { mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } } },
  { insert: ' done', attributes: { italic: true } },
];

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function typeAtEnd(editor: ReactEditor, text: string) {
  await act(async () => {
    Transforms.select(editor, Editor.end(editor, []));
    editor.insertText(text);
  });
}

function mountCell(rowId: string) {
  const onExit = jest.fn();
  const view = render(
    <RichTextCellEditor rowId={rowId} fieldId='field' value='Hello @Ada done' richText={richText} onExit={onExit} />
  );
  const editable = view.getByRole('textbox');

  Object.defineProperty(editable, 'isContentEditable', { value: true });
  return { ...view, editable, onExit, editor: mockEditors[mockEditors.length - 1] };
}

function expectRichSave(index: number, suffix: string) {
  const [text, , options] = mockUpdateCell.mock.calls[index];

  expect(text).toBe(`Hello @Ada done${suffix}`);
  expect(JSON.parse(options.richText).delta).toEqual([
    richText[0],
    { insert: '@', attributes: { mention: { ...richText[1].attributes?.mention, label: '@Ada' } } },
    { insert: ` done${suffix}`, attributes: { italic: true } },
  ]);
}

describe('editing while optional rich UI is delayed', () => {
  beforeEach(() => {
    mockUpdateCell.mockReset().mockResolvedValue('written');
    const databaseDoc = new Y.Doc();
    const database = new Y.Map();
    const fields = new Y.Map();
    const field = new Y.Map();

    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.fields, fields);
    fields.set('field', field);
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    mockContext = { workspaceId: 'workspace', databaseDoc };
  });
  afterEach(() => {
    cleanup();
    document.getSelection()?.removeAllRanges();
  });

  // One deferred module is shared by every controls instance, just as a
  // browser shares the chunk request. Resolve it only after both exit paths.
  it('accepts immediate typing, saves on exit/unmount, and keeps its editor when UI arrives', async () => {
    const entered = mountCell('entered');

    expect(entered.editable.tagName).toBe('DIV');
    expect(entered.editable.querySelector('strong')?.textContent).toBe('Hello ');
    expect(entered.editable.textContent).toContain('@Ada');
    await typeAtEnd(entered.editor, '!');
    expect(entered.queryByTestId('loaded-rich-controls')).toBeNull();
    await act(async () => fireEvent.keyDown(entered.editable, { key: 'Enter', keyCode: 13, which: 13 }));
    expectRichSave(0, '!');
    expect(entered.onExit).toHaveBeenCalledTimes(1);
    entered.unmount();

    const leaving = mountCell('leaving');

    await typeAtEnd(leaving.editor, '?');
    leaving.unmount();
    await settle();
    expectRichSave(1, '?');

    const continuing = mountCell('continuing');

    await typeAtEnd(continuing.editor, ' now');
    const draft = slateValueToRichText(continuing.editor.children);
    const undos = continuing.editor.history.undos;

    // Keep a native caret inside the already-rendered italic leaf. Menus
    // loading must not replace that DOM text node and dislodge the caret.
    await act(async () => {
      Transforms.select(continuing.editor, { path: [0, 2], offset: 3 });
    });
    const selection = continuing.editor.selection!;
    const nativeSelection = document.getSelection()!;

    nativeSelection.removeAllRanges();
    nativeSelection.addRange(ReactEditor.toDOMRange(continuing.editor, selection));
    const anchorNode = nativeSelection.anchorNode;
    const anchorOffset = nativeSelection.anchorOffset;

    expect(anchorNode?.nodeType).toBe(Node.TEXT_NODE);
    await act(async () => {
      mockResolveUI({
        __esModule: true,
        RichTextCellEditorControls: () => <span data-testid='loaded-rich-controls' />,
      });
    });
    await settle();
    expect(continuing.getByTestId('loaded-rich-controls')).toBeTruthy();
    expect(continuing.getByRole('textbox')).toBe(continuing.editable);
    expect(mockEditors).toHaveLength(3);
    expect(slateValueToRichText(continuing.editor.children)).toEqual(draft);
    expect(continuing.editor.selection).toEqual(selection);
    expect(continuing.editor.history.undos).toBe(undos);
    expect(anchorNode?.isConnected).toBe(true);
    expect(nativeSelection.anchorNode).toBe(anchorNode);
    expect(nativeSelection.anchorOffset).toBe(anchorOffset);
    expect(nativeSelection.focusNode).toBe(anchorNode);
    expect(nativeSelection.focusOffset).toBe(anchorOffset);
    await typeAtEnd(continuing.editor, '!');
    await act(async () => fireEvent.keyDown(continuing.editable, { key: 'Enter', keyCode: 13, which: 13 }));
    expectRichSave(2, ' now!');
    expect(mockUpdateCell).toHaveBeenCalledTimes(3);
  });
});
