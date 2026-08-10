import { act, render, waitFor } from '@testing-library/react';
import { createEditor, Operation, Transforms } from 'slate';
import { ReactEditor, withReact } from 'slate-react';

import { InlineComment } from '@/application/inline-comment';
import { YjsEditor } from '@/application/slate-yjs';
import { insertBlock, withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { BlockType, CollabOrigin } from '@/application/types';

import { InlineCommentProvider, operationsCanAffectAnchors, useInlineCommentContext } from '../InlineCommentContext';
import { collectInlineCommentAnchors } from '../editor/anchors';

const createComment = jest.fn();
const applyAnchorUpdate = jest.fn().mockResolvedValue(undefined);
const listComments = jest.fn();
const listReactions = jest.fn().mockResolvedValue([]);
const removeComment = jest.fn().mockResolvedValue(undefined);

jest.mock('@/application/services/domains', () => ({
  InlineCommentService: {
    applyAnchorUpdate: (...args: unknown[]) => applyAnchorUpdate(...args),
    create: (...args: unknown[]) => createComment(...args),
    list: (...args: unknown[]) => listComments(...args),
    listReactions: (...args: unknown[]) => listReactions(...args),
    remove: (...args: unknown[]) => removeComment(...args),
  },
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uuid: 'user-1' }),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}));

describe('inline comment anchor operation detection', () => {
  it('recognizes partial remote formats represented only by split/merge operations', () => {
    expect(
      operationsCanAffectAnchors(
        [
          {
            type: 'split_node',
            path: [0, 0],
            position: 2,
            properties: { 'comment-ids': ['comment-1'] },
          } as Operation,
        ],
        false
      )
    ).toBe(true);

    expect(
      operationsCanAffectAnchors([{ type: 'merge_node', path: [0, 1], position: 2, properties: {} } as Operation], false)
    ).toBe(true);
  });
});

describe('InlineCommentProvider selection lifetime', () => {
  let context: ReturnType<typeof useInlineCommentContext>;
  let dialogElement: HTMLElement;

  function Probe() {
    context = useInlineCommentContext();
    return null;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    applyAnchorUpdate.mockResolvedValue(undefined);
    createComment.mockResolvedValue('comment-1');
    listComments.mockResolvedValue([]);
    dialogElement = document.createElement('div');
    const editorElement = document.createElement('div');

    dialogElement.setAttribute('role', 'dialog');
    dialogElement.append(editorElement);
    document.body.append(dialogElement);
    jest.spyOn(ReactEditor, 'toDOMRange').mockReturnValue({
      getBoundingClientRect: () => ({ bottom: 40, height: 20, left: 20, right: 100, top: 20, width: 80 }),
    } as DOMRange);
    jest.spyOn(ReactEditor, 'toDOMNode').mockImplementation(() => editorElement);
  });

  afterEach(() => {
    dialogElement.remove();
    jest.restoreAllMocks();
  });

  it('tracks edits that arrive while comment creation and reload are pending', async () => {
    const editor = withReact(createEditor()) as YjsEditor;

    editor.children = [
      {
        type: BlockType.Paragraph,
        blockId: 'block-1',
        children: [{ text: 'abcdefghij' }],
      },
    ];

    let resolveCreate: (() => void) | undefined;
    let created = false;
    const createdComment: InlineComment = {
      user: { uuid: 'user-1', name: 'Ada', avatarUrl: null },
      commentId: 'comment-1',
      viewId: 'view-1',
      blockId: 'block-1',
      content: 'Review this',
      replyCommentId: null,
      isResolved: false,
      isDeleted: false,
      canBeDeleted: true,
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-10T00:00:00Z',
    };

    createComment.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = () => {
            created = true;
            resolve();
          };
        })
    );
    listComments.mockImplementation(async () => (created ? [createdComment] : []));

    render(
      <InlineCommentProvider workspaceId={'workspace-1'} viewId={'view-1'}>
        <Probe />
      </InlineCommentProvider>
    );

    await act(async () => {
      context.registerEditor(editor, { canComment: true, canWrite: true, readOnly: false, viewId: 'view-1' });
    });

    let started = false;

    act(() => {
      started = context.startComment(editor, {
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 5 },
      });
    });

    expect(started).toBe(true);
    expect(context.pendingComment?.rect).toEqual({ bottom: 40, left: 20, right: 100, top: 20 });

    let submit: Promise<void>;

    await act(async () => {
      submit = context.submitPendingComment('Review this');
      await Promise.resolve();
    });

    act(() => {
      Transforms.insertText(editor, 'X', { at: { path: [0, 0], offset: 0 } });
    });

    await act(async () => {
      resolveCreate?.();
      await submit!;
    });

    expect(context.anchors.get('comment-1')?.quotedText).toBe('cde');
    expect(context.anchors.get('comment-1')?.range).toEqual({
      anchor: { path: [0, 1], offset: 0 },
      focus: { path: [0, 1], offset: 3 },
    });
  });

  it('persists a read-and-comment anchor through the authorized lane', async () => {
    const doc = withTestingYDoc('view-1');
    const { applyDelta } = insertBlock({
      doc,
      blockObject: {
        id: 'block-1',
        ty: BlockType.Paragraph,
        relation_id: 'block-1',
        text_id: 'text-1',
        data: '{}',
      },
    });

    applyDelta([{ insert: 'abcdefghij' }]);

    const editor = withYjs(withReact(createEditor()), doc, {
      localOrigin: CollabOrigin.Local,
      readOnly: true,
    });
    const createdComment: InlineComment = {
      user: { uuid: 'user-1', name: 'Ada', avatarUrl: null },
      commentId: 'comment-1',
      viewId: 'view-1',
      blockId: 'block-1',
      content: 'Review this',
      replyCommentId: null,
      isResolved: false,
      isDeleted: false,
      canBeDeleted: true,
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-10T00:00:00Z',
    };
    let created = false;

    createComment.mockImplementation(async () => {
      created = true;
    });
    listComments.mockImplementation(async () => (created ? [createdComment] : []));
    editor.connect();

    render(
      <InlineCommentProvider workspaceId={'workspace-1'} viewId={'view-1'}>
        <Probe />
      </InlineCommentProvider>
    );

    await act(async () => {
      context.registerEditor(editor, { canComment: true, canWrite: false, readOnly: true, viewId: 'view-1' });
    });

    act(() => {
      expect(
        context.startComment(editor, {
          anchor: { path: [0, 0, 0], offset: 2 },
          focus: { path: [0, 0, 0], offset: 5 },
        })
      ).toBe(true);
    });

    await act(async () => {
      await context.submitPendingComment('Review this');
    });

    expect(applyAnchorUpdate).toHaveBeenCalledWith(
      'workspace-1',
      'view-1',
      expect.objectContaining({ commentId: 'comment-1', update: expect.any(Uint8Array) })
    );
    expect(context.anchors.get('comment-1')?.quotedText).toBe('cde');

    listComments.mockResolvedValue([{ ...createdComment, isDeleted: true }]);
    await act(async () => {
      await context.deleteComment('comment-1');
    });

    expect(applyAnchorUpdate).toHaveBeenCalledTimes(2);
    expect(context.anchors.has('comment-1')).toBe(false);

    editor.disconnect();
  });

  it('reconciles a committed comment when the create response is lost', async () => {
    const editor = withReact(createEditor()) as YjsEditor;

    editor.children = [
      {
        type: BlockType.Paragraph,
        blockId: 'block-1',
        children: [{ text: 'abcdefghij' }],
      },
    ];

    const createdComment: InlineComment = {
      user: { uuid: 'user-1', name: 'Ada', avatarUrl: null },
      commentId: 'comment-after-ambiguous-create',
      viewId: 'view-1',
      blockId: 'block-1',
      content: 'Review this',
      replyCommentId: null,
      isResolved: false,
      isDeleted: false,
      canBeDeleted: true,
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-10T00:00:00Z',
    };

    listComments.mockResolvedValueOnce([]).mockResolvedValue([createdComment]);

    render(
      <InlineCommentProvider workspaceId={'workspace-1'} viewId={'view-1'}>
        <Probe />
      </InlineCommentProvider>
    );

    await act(async () => {
      context.registerEditor(editor, { canComment: true, canWrite: true, readOnly: false, viewId: 'view-1' });
    });
    await waitFor(() => expect(listComments).toHaveBeenCalledTimes(1));

    createComment.mockRejectedValueOnce(new Error('response lost after commit'));

    act(() => {
      context.startComment(editor, {
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 5 },
      });
    });
    await act(async () => {
      await context.submitPendingComment('Review this');
    });

    expect(context.anchors.get(createdComment.commentId)?.quotedText).toBe('cde');
    expect(removeComment).not.toHaveBeenCalled();
  });

  it('uses the returned comment id when the follow-up list request fails', async () => {
    const editor = withReact(createEditor()) as YjsEditor;

    editor.children = [
      {
        type: BlockType.Paragraph,
        blockId: 'block-1',
        children: [{ text: 'abcdefghij' }],
      },
    ];
    listComments.mockResolvedValueOnce([]);

    render(
      <InlineCommentProvider workspaceId={'workspace-1'} viewId={'view-1'}>
        <Probe />
      </InlineCommentProvider>
    );

    await act(async () => {
      context.registerEditor(editor, { canComment: true, canWrite: true, readOnly: false, viewId: 'view-1' });
    });
    await waitFor(() => expect(listComments).toHaveBeenCalledTimes(1));

    createComment.mockResolvedValueOnce('comment-from-response');
    listComments.mockRejectedValue(new Error('comment list temporarily unavailable'));

    act(() => {
      context.startComment(editor, {
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 5 },
      });
    });
    await act(async () => {
      await context.submitPendingComment('Review this');
    });

    expect(context.anchors.get('comment-from-response')?.quotedText).toBe('cde');
    expect(removeComment).not.toHaveBeenCalled();
  });

  it('does not irreversibly delete a cloud thread when text deletion is undone', async () => {
    const doc = withTestingYDoc('view-1');
    const { applyDelta } = insertBlock({
      doc,
      blockObject: {
        id: 'block-1',
        ty: BlockType.Paragraph,
        relation_id: 'block-1',
        text_id: 'text-1',
        data: '{}',
      },
    });

    applyDelta([{ insert: 'abcdefghij' }]);

    const editor = withYHistory(
      withYjs(withReact(createEditor()), doc, {
        localOrigin: CollabOrigin.Local,
        readOnly: false,
      })
    );
    const createdComment: InlineComment = {
      user: { uuid: 'user-1', name: 'Ada', avatarUrl: null },
      commentId: 'comment-1',
      viewId: 'view-1',
      blockId: 'block-1',
      content: 'Review this',
      replyCommentId: null,
      isResolved: false,
      isDeleted: false,
      canBeDeleted: true,
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-10T00:00:00Z',
    };
    let created = false;

    createComment.mockImplementation(async () => {
      created = true;
    });
    listComments.mockImplementation(async () => (created ? [createdComment] : []));
    editor.connect();

    render(
      <InlineCommentProvider workspaceId={'workspace-1'} viewId={'view-1'}>
        <Probe />
      </InlineCommentProvider>
    );

    await act(async () => {
      context.registerEditor(editor, { canComment: true, canWrite: true, readOnly: false, viewId: 'view-1' });
    });
    act(() => {
      context.startComment(editor, {
        anchor: { path: [0, 0, 0], offset: 2 },
        focus: { path: [0, 0, 0], offset: 5 },
      });
    });
    await act(async () => {
      await context.submitPendingComment('Review this');
    });

    const anchoredRange = context.anchors.get('comment-1')?.range;

    expect(anchoredRange).toBeDefined();
    act(() => {
      Transforms.delete(editor, { at: anchoredRange! });
      editor.flushLocalChanges();
      context.handleEditorChange(editor);
    });

    expect(context.anchors.has('comment-1')).toBe(false);
    expect(removeComment).not.toHaveBeenCalled();

    act(() => {
      // Keep this provider-free while the UndoManager mutates Y.Text. Reconnect
      // rebuilds Slate from the resulting Yjs state, just as a remounted editor
      // would after an undo-driven document update.
      editor.disconnect();
      editor.undoManager.undo();
      editor.connect();
    });

    expect(collectInlineCommentAnchors(editor).get('comment-1')?.quotedText).toBe('cde');
    expect(removeComment).not.toHaveBeenCalled();

    editor.disconnect();
  });
});
