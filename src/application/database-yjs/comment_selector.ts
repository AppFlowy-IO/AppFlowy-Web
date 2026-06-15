import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRowMap } from '@/application/database-yjs/context';
import { ensureCommentsMap, getRowComments } from '@/application/database-yjs/row_comment';
import { RowComment } from '@/application/row-comment.type';
import { YjsEditorKey } from '@/application/types';

interface CommentsState {
  comments: RowComment[];
  loading: boolean;
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
    const parents = state.comments
      .filter((c) => !c.parentCommentId)
      .sort((a, b) => a.createdAt - b.createdAt);

    const childrenMap = new Map<string, RowComment[]>();

    for (const c of state.comments) {
      if (c.parentCommentId) {
        const list = childrenMap.get(c.parentCommentId) || [];

        list.push(c);
        childrenMap.set(c.parentCommentId, list);
      }
    }

    for (const [key, children] of childrenMap) {
      childrenMap.set(key, children.sort((a, b) => a.createdAt - b.createdAt));
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
