import { render, waitFor } from '@testing-library/react';

import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
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
});
