import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';

import { useRowMap } from '@/application/database-yjs/context';
import {
  getRowMetaMap,
  readRowReactions,
  ROW_REACTIONS_META_KEY,
  RowReactions,
  toggleRowReaction,
} from '@/application/database-yjs/row_reaction';
import { UserUid } from '@/application/user-uid';
import { YjsEditorKey } from '@/application/types';

const EMPTY_REACTIONS: RowReactions = {};

function areReactionsEqual(left: RowReactions, right: RowReactions): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((emoji) => {
    const leftUsers = left[emoji];
    const rightUsers = right[emoji];

    return (
      rightUsers !== undefined &&
      leftUsers.length === rightUsers.length &&
      leftUsers.every((uid, index) => uid === rightUsers[index])
    );
  });
}

/**
 * Observe a row's reactions without materializing anything on the row doc.
 * Summary surfaces (feed cards) must stay read-only when they render.
 */
export function useRowReactions(rowId: string): RowReactions {
  const rowDoc = useRowMap()?.[rowId];
  const [reactions, setReactions] = useState<RowReactions>(EMPTY_REACTIONS);

  useEffect(() => {
    if (!rowDoc) {
      setReactions(EMPTY_REACTIONS);
      return;
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    let metaMap: Y.Map<unknown> | undefined = getRowMetaMap(rowDoc);

    const update = () => {
      const next = readRowReactions(rowDoc);

      setReactions((current) => (areReactionsEqual(current, next) ? current : next));
    };

    const onMetaChange = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has(ROW_REACTIONS_META_KEY)) update();
    };

    const syncMetaMap = () => {
      const nextMetaMap = getRowMetaMap(rowDoc);

      if (nextMetaMap !== metaMap) {
        metaMap?.unobserve(onMetaChange);
        metaMap = nextMetaMap;
        metaMap?.observe(onMetaChange);
      }

      update();
    };

    rowSharedRoot.observe(syncMetaMap);
    metaMap?.observe(onMetaChange);
    update();

    return () => {
      rowSharedRoot.unobserve(syncMetaMap);
      metaMap?.unobserve(onMetaChange);
    };
  }, [rowDoc]);

  return reactions;
}

export function useToggleRowReactionDispatch(rowId: string) {
  const rowDoc = useRowMap()?.[rowId];

  return useCallback(
    (emoji: string, uid: UserUid) => {
      if (!rowDoc) return;

      toggleRowReaction(rowDoc, emoji, uid);
    },
    [rowDoc]
  );
}
