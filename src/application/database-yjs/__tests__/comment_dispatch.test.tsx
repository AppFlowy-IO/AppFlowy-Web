import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { useAddCommentDispatch, useUpdateCommentDispatch } from '@/application/database-yjs/comment_dispatch';
import { useDatabaseContext, useRowMap } from '@/application/database-yjs/context';
import { addComment, getRowComments } from '@/application/database-yjs/row_comment';
import { RowService } from '@/application/services/domains';
import { YDoc } from '@/application/types';

jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContext: jest.fn(), useRowMap: jest.fn() }));
jest.mock('@/application/services/domains', () => ({ RowService: { notifyComment: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn() } }));

const author = 'a318b9a0-6e2a-4c85-9638-16fd152af6e1';
const other = '080728ed-21f2-457d-9d83-519066814c82';

describe('row comment notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useDatabaseContext as jest.Mock).mockReturnValue({
      workspaceId: 'workspace',
      activeViewId: 'feed-view',
      databasePageId: 'database-page',
    });
    (RowService.notifyComment as jest.Mock).mockResolvedValue(undefined);
  });

  it('notifies mentioned users and thread participants using the database view authorization context', () => {
    const rowDoc = new Y.Doc() as YDoc;
    const parent = addComment(rowDoc, 'Parent', other);

    (useRowMap as jest.Mock).mockReturnValue({ row: rowDoc });
    const { result } = renderHook(() => useAddCommentDispatch('row'));
    let id: string | undefined;

    act(() => {
      id = result.current(`Hello @[Person](${other}) @[Person](${other})`, author, parent);
    });
    expect(RowService.notifyComment).toHaveBeenCalledWith(
      'workspace',
      'feed-view',
      'row',
      expect.objectContaining({
        comment_id: id,
        parent_comment_id: parent,
        mentioned_user_uuids: [other],
        reply_participant_uuids: [other],
      })
    );
    expect(getRowComments(rowDoc)).toHaveLength(2);
  });

  it('keeps a saved comment when notification delivery fails and never notifies for an unhydrated row', async () => {
    const rowDoc = new Y.Doc() as YDoc;

    (useRowMap as jest.Mock).mockReturnValue(null);
    const { result, rerender } = renderHook(() => useAddCommentDispatch('row'));

    expect(result.current(`@[Person](${other})`, author)).toBeUndefined();
    expect(RowService.notifyComment).not.toHaveBeenCalled();
    (useRowMap as jest.Mock).mockReturnValue({ row: rowDoc });
    (RowService.notifyComment as jest.Mock).mockRejectedValue(new Error('offline'));
    rerender();
    await act(async () => {
      expect(result.current(`@[Person](${other})`, author)).toBeTruthy();
    });
    expect(getRowComments(rowDoc)).toHaveLength(1);
  });

  it('only notifies newly mentioned people when editing, matching desktop', () => {
    const rowDoc = new Y.Doc() as YDoc;
    const id = addComment(rowDoc, `Hello @[Person](${other})`, author);

    (useRowMap as jest.Mock).mockReturnValue({ row: rowDoc });
    const { result } = renderHook(() => useUpdateCommentDispatch('row'));

    act(() => result.current(id, `Edited @[Person](${other})`));
    expect(RowService.notifyComment).not.toHaveBeenCalled();
    act(() => result.current(id, `Edited @[Person](${other}) and @[Author](${author})`));
    expect(RowService.notifyComment).toHaveBeenCalledWith(
      'workspace',
      'feed-view',
      'row',
      expect.objectContaining({ mentioned_user_uuids: [author] })
    );
  });
});
