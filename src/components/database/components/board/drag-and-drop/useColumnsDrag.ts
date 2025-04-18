import { GroupColumn, Row } from '@/application/database-yjs';
import {
  useMoveCardDispatch,
  useReorderRowDispatch,
  useReorderGroupColumnDispatch,
} from '@/application/database-yjs/dispatch';
import { BoardContextValue } from '@/components/database/components/board/drag-and-drop/board-context';
import { createRegistry } from '@/components/database/components/board/drag-and-drop/registry';
import {
  autoScrollForElements,
} from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types';
import {
  getReorderDestinationIndex,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

export function useColumnsDrag (groupId: string, columns: GroupColumn[], getCards: (columnId: string) => Row[] | undefined, fieldId: string | null) {
  const [instanceId] = useState(() => Symbol(`board-dnd-group-${groupId}`));
  const [registry] = useState(createRegistry);
  const stableData = useRef<GroupColumn[]>(columns);
  const reorderGroupColumn = useReorderGroupColumnDispatch(groupId);
  const reorderColumnCard = useReorderRowDispatch();
  const moveColumnCard = useMoveCardDispatch();
  const scrollableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    stableData.current = columns;
  }, [columns]);

  const getColumns = useCallback(() => {
    return stableData.current;
  }, []);

  const reorderColumn = useCallback(
    ({
      startIndex,
      finishIndex,
    }: {
      startIndex: number;
      finishIndex: number;
    }) => {
      const columnIds = stableData.current.map(item => item.id);
      const columnId = columnIds[startIndex];

      columnIds.splice(startIndex, 1);
      columnIds.splice(finishIndex, 0, columnId);
      const newIndex = columnIds.findIndex(id => id === columnId);
      const beforeColumnId = columnIds[newIndex - 1];

      reorderGroupColumn(columnId, beforeColumnId);
    }, [reorderGroupColumn]);

  const reorderCard = useCallback(
    ({
      columnId,
      startIndex,
      finishIndex,
    }: {
      columnId: string;
      startIndex: number;
      finishIndex: number;
    }) => {
      const cards = getCards(columnId);

      if (!cards) {
        throw new Error('No card found for column ' + columnId);
      }

      const ids = cards.map(item => item.id);
      const cardId = ids[startIndex];

      ids.splice(startIndex, 1);
      ids.splice(finishIndex, 0, cardId);

      const newIndex = ids.findIndex(id => id === cardId);
      const beforeId = ids[newIndex - 1];

      reorderColumnCard(cardId, beforeId);
    }, [getCards, reorderColumnCard]);

  const moveCard = useCallback(({
    startColumnId,
    finishColumnId,
    itemIndexInStartColumn,
    itemIndexInFinishColumn,
  }: {
    startColumnId: string;
    finishColumnId: string;
    itemIndexInStartColumn: number;
    itemIndexInFinishColumn?: number;
  }) => {
    if (!fieldId) return;
    if (startColumnId === finishColumnId) {
      return;
    }

    const startColumn = stableData.current.find((column) => column.id === startColumnId);
    const finishColumn = stableData.current.find((column) => column.id === finishColumnId);

    if (!startColumn || !finishColumn) {
      return;
    }

    const startColumnCards = getCards(startColumnId);
    const finishColumnCards = getCards(finishColumnId);

    if (!startColumnCards || !finishColumnCards || itemIndexInFinishColumn === undefined) {
      throw new Error('No card found for column ' + startColumnId);
    }

    const rowId = startColumnCards[itemIndexInStartColumn].id;

    const beforeId = itemIndexInFinishColumn > 0 ? finishColumnCards[itemIndexInFinishColumn - 1]?.id : undefined;

    moveColumnCard({
      rowId,
      beforeRowId: beforeId,
      fieldId,
      startColumnId,
      finishColumnId,
    });
  }, [fieldId, getCards, moveColumnCard]);

  const contextValue: BoardContextValue = useMemo(() => {
    return {
      getColumns,
      reorderColumn,
      reorderCard,
      moveCard,
      registerCard: registry.registerCard,
      registerColumn: registry.registerColumn,
      instanceId,
    };
  }, [getColumns, reorderColumn, reorderCard, registry, moveCard, instanceId]);

  useEffect(() => {
    if (!scrollableRef.current) {
      return;
    }

    // eslint-disable-next-line
    function canRespond ({ source }: Record<string, any>) {
      return source.data && source.data.instanceId === instanceId;
    }

    return combine(
      monitorForElements({
        canMonitor: canRespond,
        onDrop (args) {
          const { location, source } = args;

          // didn't drop on anything
          if (!location.current.dropTargets.length) {
            return;
          }
          // need to handle drop

          // 1. remove element from original position
          // 2. move to new position

          if (source.data.type === 'column') {
            const startIndex: number = columns.findIndex(
              (column) => column.id === source.data.columnId,
            );

            const target = location.current.dropTargets[0];
            const indexOfTarget: number = columns.findIndex(
              (column) => column.id === target.data.columnId,
            );
            const closestEdgeOfTarget: Edge | null = extractClosestEdge(target.data);

            const finishIndex = getReorderDestinationIndex({
              startIndex,
              indexOfTarget,
              closestEdgeOfTarget,
              axis: 'horizontal',
            });

            reorderColumn({ startIndex, finishIndex });
          }

          // Dragging a card
          if (source.data.type === 'card') {
            const itemId = source.data.itemId;

            const [, startColumnRecord] = location.initial.dropTargets;
            const sourceId = startColumnRecord.data.columnId;

            const sourceColumn = columns.find((column) => column.id === sourceId);

            if (!sourceColumn) {
              throw new Error(`Column with id ${sourceId} not found`);
            }

            const sourceColumnsCards = getCards(sourceColumn.id);

            if (!sourceColumnsCards) {
              throw new Error(`Cards not found for column ${sourceColumn.id}`);
            }

            const itemIndex = sourceColumnsCards.findIndex((item) => item.id === itemId);

            if (itemIndex === undefined || itemIndex === -1) {
              throw new Error(`Item with id ${itemId} not found in column ${sourceColumn.id}`);
            }

            if (location.current.dropTargets.length === 1) {
              const [destinationColumnRecord] = location.current.dropTargets;
              const destinationId = destinationColumnRecord.data.columnId;

              const destinationColumn = columns.find((column) => column.id === destinationId);

              if (!destinationColumn) {
                throw new Error(`Column with id ${destinationId} not found`);
              }

              // reordering in same column
              if (sourceColumn.id === destinationColumn.id) {
                const destinationIndex = getReorderDestinationIndex({
                  startIndex: itemIndex,
                  indexOfTarget: sourceColumnsCards.length - 1,
                  closestEdgeOfTarget: null,
                  axis: 'vertical',
                });

                reorderCard({
                  columnId: sourceColumn.id,
                  startIndex: itemIndex,
                  finishIndex: destinationIndex,
                });
                return;
              }

              // moving to a new column
              moveCard({
                itemIndexInStartColumn: itemIndex,
                startColumnId: sourceColumn.id,
                finishColumnId: destinationColumn.id,
              });
              return;
            }

            // dropping in a column (relative to a card)
            if (location.current.dropTargets.length === 2) {
              const [destinationCardRecord, destinationColumnRecord] = location.current.dropTargets;
              const destinationColumnId = destinationColumnRecord.data.columnId;

              const destinationColumn = columns.find((column) => column.id === destinationColumnId);

              if (!destinationColumn) {
                throw new Error(`Column with id ${destinationColumnId} not found`);
              }

              const destinationCards = getCards(destinationColumn.id);

              if (!destinationCards) {
                throw new Error(`Cards not found for column ${destinationColumnId}`);
              }

              const indexOfTarget = destinationCards.findIndex(
                (item) => item.id === destinationCardRecord.data.itemId,
              );
              const closestEdgeOfTarget: Edge | null = extractClosestEdge(
                destinationCardRecord.data,
              );

              // case 1: ordering in the same column
              if (sourceColumn === destinationColumn) {
                const destinationIndex = getReorderDestinationIndex({
                  startIndex: itemIndex,
                  indexOfTarget,
                  closestEdgeOfTarget,
                  axis: 'vertical',
                });

                reorderCard({
                  columnId: sourceColumn.id,
                  startIndex: itemIndex,
                  finishIndex: destinationIndex,
                });
                return;
              }

              // case 2: moving into a new column relative to a card

              const destinationIndex =
                closestEdgeOfTarget === 'bottom' ? indexOfTarget + 1 : indexOfTarget;

              moveCard({
                itemIndexInStartColumn: itemIndex,
                startColumnId: sourceColumn.id,
                finishColumnId: destinationColumn.id,
                itemIndexInFinishColumn: destinationIndex,
              });
            }
          }
        },
      }),
      autoScrollForElements({
        element: scrollableRef.current,
        canScroll: canRespond,
      }),
    );
  }, [columns, getCards, instanceId, moveCard, reorderCard, reorderColumn]);

  return {
    scrollableRef,
    contextValue,
  };
}