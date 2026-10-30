import { act, render, waitFor } from '@testing-library/react';
import { startTransition, Suspense, useState } from 'react';
import { Editor, Transforms } from 'slate';

import { insertBlock, withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import type { YjsEditor } from '@/application/slate-yjs/plugins/withYjs';
import type { YDoc } from '@/application/types';
import CollaborativeEditor from '@/components/editor/CollaborativeEditor';
import { EditorContextProvider } from '@/components/editor/EditorContext';

jest.mock('@/components/editor/Editable', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/editor/plugins', () => ({
  withPlugins: (editor: YjsEditor) => editor,
}));

jest.mock('@/components/editor/plugins/withCopy', () => ({
  clipboardFormatKey: 'application/x-appflowy',
}));

jest.mock('@/components/editor/components/find-replace/FindReplaceContext', () => ({
  FindReplaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentEditorBridgeOptional: () => undefined,
}));

jest.mock('@/components/inline-comment/editor/useInlineCommentEditorRegistration', () => ({
  useInlineCommentEditorRegistration: () => undefined,
}));

describe('CollaborativeEditor permission transitions', () => {
  it('keeps one editor and makes its imperative guards writable when permission resolves', async () => {
    const doc = withTestingYDoc('view-id') as YDoc;
    const connectedEditors: YjsEditor[] = [];
    const onEditorConnected = (editor: YjsEditor) => connectedEditors.push(editor);
    const renderEditor = (readOnly: boolean) => (
      <EditorContextProvider readOnly={readOnly} viewId={'view-id'} workspaceId={'workspace-id'}>
        <CollaborativeEditor doc={doc} onEditorConnected={onEditorConnected} />
      </EditorContextProvider>
    );
    const { rerender } = render(renderEditor(true));

    await waitFor(() => expect(connectedEditors).toHaveLength(1));
    const editor = connectedEditors[0];

    expect(editor.readOnly).toBe(true);
    expect(YHistoryEditor.isYHistoryEditor(editor)).toBe(true);

    rerender(renderEditor(false));

    await waitFor(() => expect(editor.readOnly).toBe(false));
    expect(connectedEditors).toEqual([editor]);
  });

  it('uses the latest selection callback without replacing the connected editor', async () => {
    const doc = withTestingYDoc('view-id') as YDoc;

    insertBlock({
      doc,
      blockObject: {
        id: 'paragraph',
        ty: 'paragraph',
        relation_id: 'paragraph-children',
        text_id: 'paragraph-text',
        data: '{}',
      },
    }).applyDelta([{ insert: 'Selection target' }]);
    const connectedEditors: YjsEditor[] = [];
    const connected = (editor: YjsEditor) => connectedEditors.push(editor);
    const initialSelection = jest.fn();
    const refreshedSelection = jest.fn();
    const renderEditor = (onSelectionChange: (editor: YjsEditor) => void) => (
      <EditorContextProvider readOnly={false} viewId={'view-id'} workspaceId={'workspace-id'}>
        <CollaborativeEditor doc={doc} onEditorConnected={connected} onSelectionChange={onSelectionChange} />
      </EditorContextProvider>
    );
    const { rerender, unmount } = render(renderEditor(initialSelection));

    await waitFor(() => expect(connectedEditors).toHaveLength(1));
    const editor = connectedEditors[0];

    await waitFor(() => expect(editor.children.length).toBeGreaterThan(0));
    rerender(renderEditor(refreshedSelection));
    initialSelection.mockClear();
    refreshedSelection.mockClear();
    await act(async () => {
      Transforms.select(editor, Editor.start(editor, []));
    });
    await waitFor(() => expect(refreshedSelection).toHaveBeenCalledWith(editor));
    expect(initialSelection).not.toHaveBeenCalled();
    expect(connectedEditors).toEqual([editor]);
    expect(YHistoryEditor.isYHistoryEditor(editor)).toBe(true);
    unmount();
    doc.destroy();
  });

  it('keeps the committed selection callback when a concurrent render suspends', async () => {
    const doc = withTestingYDoc('view-id') as YDoc;

    insertBlock({
      doc,
      blockObject: {
        id: 'paragraph',
        ty: 'paragraph',
        relation_id: 'paragraph-children',
        text_id: 'paragraph-text',
        data: '{}',
      },
    }).applyDelta([{ insert: 'Selection target' }]);
    const connectedEditors: YjsEditor[] = [];
    const connected = (editor: YjsEditor) => connectedEditors.push(editor);
    const committedSelection = jest.fn();
    const pendingSelection = jest.fn();
    const suspended = jest.fn();
    const pending = new Promise<never>(() => undefined);
    let beginPendingRender: () => void;
    const SuspendAfterEditor = () => {
      suspended();
      throw pending;
    };

    const Fixture = () => {
      const [loading, setLoading] = useState(false);

      beginPendingRender = () => startTransition(() => setLoading(true));
      return (
        <Suspense fallback={null}>
          <EditorContextProvider readOnly={false} viewId={'view-id'} workspaceId={'workspace-id'}>
            <CollaborativeEditor
              doc={doc}
              onEditorConnected={connected}
              onSelectionChange={loading ? pendingSelection : committedSelection}
            />
            {loading && <SuspendAfterEditor />}
          </EditorContextProvider>
        </Suspense>
      );
    };

    const { unmount } = render(<Fixture />);

    await waitFor(() => expect(connectedEditors).toHaveLength(1));
    const editor = connectedEditors[0];

    await act(async () => beginPendingRender());
    expect(suspended).toHaveBeenCalled();
    committedSelection.mockClear();
    pendingSelection.mockClear();
    await act(async () => Transforms.select(editor, Editor.start(editor, [])));
    await waitFor(() => expect(committedSelection).toHaveBeenCalledWith(editor));
    expect(pendingSelection).not.toHaveBeenCalled();
    expect(connectedEditors).toEqual([editor]);
    unmount();
    doc.destroy();
  });
});
