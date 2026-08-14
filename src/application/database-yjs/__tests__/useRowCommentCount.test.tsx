import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { useRowMap } from '@/application/database-yjs/context';
import { useRowCommentCount } from '@/application/database-yjs/comment_selector';
import { YjsEditorKey } from '@/application/types';

jest.mock('@/application/database-yjs/context', () => ({
  useRowMap: jest.fn(),
}));

const mockUseRowMap = useRowMap as jest.MockedFunction<typeof useRowMap>;

describe('useRowCommentCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not create a comments map while observing an empty row', () => {
    const rowDoc = new Y.Doc();
    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });

    const { result } = renderHook(() => useRowCommentCount('row-1'));

    expect(result.current).toBe(0);
    expect(rowSharedRoot.has(YjsEditorKey.comment)).toBe(false);
  });

  it('reacts when a comments map is added and subsequently updated', () => {
    const rowDoc = new Y.Doc();
    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const comments = new Y.Map<Y.Map<unknown>>();

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });

    const { result } = renderHook(() => useRowCommentCount('row-1'));

    act(() => {
      rowSharedRoot.set(YjsEditorKey.comment, comments);
      comments.set('comment-1', new Y.Map());
    });
    expect(result.current).toBe(1);

    act(() => {
      comments.set('comment-2', new Y.Map());
    });
    expect(result.current).toBe(2);

    act(() => comments.delete('comment-1'));
    expect(result.current).toBe(1);
  });

  it('keeps the row observer when unrelated row-map entries change', () => {
    const rowDoc = new Y.Doc();
    const otherRowDoc = new Y.Doc();
    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const observe = jest.spyOn(rowSharedRoot, 'observe');
    const unobserve = jest.spyOn(rowSharedRoot, 'unobserve');

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    const { rerender, unmount } = renderHook(() => useRowCommentCount('row-1'));

    expect(observe).toHaveBeenCalledTimes(1);
    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc, 'row-2': otherRowDoc });
    rerender();

    expect(observe).toHaveBeenCalledTimes(1);
    expect(unobserve).not.toHaveBeenCalled();

    unmount();
    expect(unobserve).toHaveBeenCalledTimes(1);
  });
});
