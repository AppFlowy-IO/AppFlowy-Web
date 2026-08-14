import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRowMap } from '@/application/database-yjs/context';
import { ensureCommentsMap, getCommentsMap, getRowComments } from '@/application/database-yjs/row_comment';
import { RowComment } from '@/application/row-comment.type';
import { YjsEditorKey } from '@/application/types';

interface CommentsState {
  comments: RowComment[];
  loading: boolean;
}

/**
 * Observe a row's comment count without materializing the comments map.
 *
 * List and other summary surfaces must remain read-only when they render. The
 * full comments hook intentionally creates the map because its consumers are
 * comment editors; a count-only surface should only observe data that already
 * exists.
 */
export function useRowCommentCount(rowId: string) {
  const [commentCount, setCommentCount] = useState(0);
  const rowMap = useRowMap();

  useEffect(() => {
    const rowDoc = rowMap?.[rowId];

    if (!rowDoc || !rowDoc.share.has(YjsEditorKey.data_section)) {
      setCommentCount(0);
      return;
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    let commentsMap = getCommentsMap(rowDoc);

    const updateCount = () => {
      const nextCount = commentsMap?.size ?? 0;

      setCommentCount((currentCount) => (currentCount === nextCount ? currentCount : nextCount));
    };

    const syncCommentsMap = () => {
      const nextCommentsMap = getCommentsMap(rowDoc);

      if (nextCommentsMap !== commentsMap) {
        commentsMap?.unobserveDeep(updateCount);
        commentsMap = nextCommentsMap;
        commentsMap?.observeDeep(updateCount);
      }

      updateCount();
    };

    rowSharedRoot.observe(syncCommentsMap);
    commentsMap?.observeDeep(updateCount);
    updateCount();

    return () => {
      rowSharedRoot.unobserve(syncCommentsMap);
      commentsMap?.unobserveDeep(updateCount);
    };
  }, [rowId, rowMap]);

  return commentCount;
}

export function useRowComments(rowId: string) {
  const [state, setState] = useState<CommentsState>({ comments: [], loading: true });
  const rowMap = useRowMap();
  // Ref to allow external refresh without recreating the observer callback
  const rowMapRef = useRef(rowMap);

  rowMapRef.current = rowMap;

  const refresh = useCallback(() => {
    const rowDoc = rowMapRef.current?.[rowId];

    if (!rowDoc || !rowDoc.share.has(YjsEditorKey.data_section)) {
      setState({ comments: [], loading: false });
      return;
    }

    setState({ comments: getRowComments(rowDoc), loading: false });
  }, [rowId]);

  useEffect(() => {
    if (!rowMap) return;

    const rowDoc = rowMap[rowId];

    if (!rowDoc || !rowDoc.share.has(YjsEditorKey.data_section)) {
      setState({ comments: [], loading: false });
      return;
    }

    const commentsMap = ensureCommentsMap(rowDoc);

    // Stable callback — created once per effect run, properly cleaned up
    const onUpdate = () => {
      setState({ comments: getRowComments(rowDoc), loading: false });
    };

    commentsMap.observeDeep(onUpdate);
    onUpdate();

    return () => {
      commentsMap.unobserveDeep(onUpdate);
    };
  }, [rowId, rowMap]);

  const { sortedComments, parentMap } = useMemo(() => {
    const parents = state.comments.filter((c) => !c.parentCommentId).sort((a, b) => a.createdAt - b.createdAt);

    const childrenMap = new Map<string, RowComment[]>();

    for (const c of state.comments) {
      if (c.parentCommentId) {
        const list = childrenMap.get(c.parentCommentId) || [];

        list.push(c);
        childrenMap.set(c.parentCommentId, list);
      }
    }

    for (const [key, children] of childrenMap) {
      childrenMap.set(
        key,
        children.sort((a, b) => a.createdAt - b.createdAt)
      );
    }

    const result: RowComment[] = [];
    const pMap = new Map<string, RowComment>();

    for (const parent of parents) {
      pMap.set(parent.id, parent);
      result.push(parent);
      const children = childrenMap.get(parent.id) || [];

      result.push(...children);
    }

    return { sortedComments: result, parentMap: pMap };
  }, [state.comments]);

  const openComments = useMemo(
    () =>
      sortedComments.filter((c) => {
        if (c.parentCommentId) {
          const parent = parentMap.get(c.parentCommentId);

          return parent ? !parent.isResolved : false;
        }

        return !c.isResolved;
      }),
    [sortedComments, parentMap]
  );

  const resolvedComments = useMemo(
    () =>
      sortedComments.filter((c) => {
        if (c.parentCommentId) {
          const parent = parentMap.get(c.parentCommentId);

          return parent ? parent.isResolved : false;
        }

        return c.isResolved;
      }),
    [sortedComments, parentMap]
  );

  return {
    comments: sortedComments,
    openComments,
    resolvedComments,
    loading: state.loading,
    commentCount: state.comments.length,
    refresh,
  };
}
