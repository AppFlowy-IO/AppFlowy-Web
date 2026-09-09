import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { useRowComments } from '@/application/database-yjs/comment_selector';
import { useRowMap } from '@/application/database-yjs/context';
import { addComment, getCommentsMap, updateCommentContent } from '@/application/database-yjs/row_comment';
import { YDoc, YjsEditorKey } from '@/application/types';

jest.mock('@/application/database-yjs/context', () => ({ useRowMap: jest.fn() }));

describe('row comment observation', () => {
  it('never writes while rendering and observes comments that arrive after an empty row hydrates', () => {
    const rowDoc = new Y.Doc() as YDoc;
    const before = Y.encodeStateAsUpdate(rowDoc);

    (useRowMap as jest.Mock).mockReturnValue({ row: rowDoc });
    const { result } = renderHook(() => useRowComments('row'));

    expect(getCommentsMap(rowDoc)).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.comments).toEqual([]);
    expect(Y.encodeStateAsUpdate(rowDoc)).toEqual(before);
    const remote = new Y.Doc() as YDoc;
    const commentId = addComment(remote, 'Remote comment', 'other');

    act(() => Y.applyUpdate(rowDoc, Y.encodeStateAsUpdate(remote)));
    expect(result.current.comments[0].content).toBe('Remote comment');
    act(() => updateCommentContent(rowDoc, commentId, 'Edited remotely'));
    expect(result.current.comments[0].content).toBe('Edited remotely');
  });

  it('rebinds when either the row document or its comments map is replaced', () => {
    const oldDoc = new Y.Doc() as YDoc;

    addComment(oldDoc, 'Old comment', 'other');
    (useRowMap as jest.Mock).mockReturnValue({ row: oldDoc });
    const { result, rerender } = renderHook(() => useRowComments('row'));
    const replacement = new Y.Doc() as YDoc;

    addComment(replacement, 'Replacement comment', 'other');
    (useRowMap as jest.Mock).mockReturnValue({ row: replacement });
    rerender();
    act(() => { addComment(oldDoc, 'Stale source', 'other'); });
    expect(result.current.comments.map((comment) => comment.content)).toEqual(['Replacement comment']);
    const resetDoc = new Y.Doc() as YDoc;
    const resetId = addComment(resetDoc, 'Reset comment', 'other');

    act(() => {
      replacement.getMap(YjsEditorKey.data_section).set(YjsEditorKey.comment, getCommentsMap(resetDoc)!.clone());
    });
    expect(result.current.comments.map((comment) => comment.content)).toEqual(['Reset comment']);
    act(() => updateCommentContent(replacement, resetId, 'Edited after reset'));
    expect(result.current.comments[0].content).toBe('Edited after reset');
  });
});
