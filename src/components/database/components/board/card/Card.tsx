import { useReadOnly } from '@/application/database-yjs';
import { CardPrimitive } from '@/components/database/components/board/card/CardPrimitive';
import NewCard from '@/components/database/components/board/card/NewCard';
import { CardType } from '@/components/database/components/board/column/CardList';
import { useBoardContext } from '@/components/database/components/board/drag-and-drop/board-context';
import { DropCardIndicator } from '@/components/database/components/board/drag-and-drop/DropCardIndicator';
import { cn } from '@/lib/utils';
import React, { memo, useEffect, useRef, useState } from 'react';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { dropTargetForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter';
import {
  attachClosestEdge,
  type Edge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';

type State =
  | { type: 'idle' }
  | { type: 'preview' }
  | { type: 'dragging' };

const idleState: State = { type: 'idle' };
const draggingState: State = { type: 'dragging' };

export const Card = memo(({
  groupFieldId,
  rowId,
  type,
  ...props
}: {
  type: CardType;
  groupFieldId: string;
  rowId: string;
  beforeId?: string;
  columnId: string
  isCreating: boolean;
  setIsCreating: (isCreating: boolean) => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const { instanceId, registerCard } = useBoardContext();
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [state, setState] = useState<State>(idleState);
  const [editing, setEditing] = useState(false);
  const readOnly = useReadOnly();

  useEffect(() => {
    if (!ref.current || readOnly) return;

    return registerCard({
      cardId: rowId,
      entry: {
        element: ref.current,
      },
    });
  }, [registerCard, rowId, readOnly]);

  useEffect(() => {
    const element = ref.current;

    if (!element || readOnly) return;
    return combine(
      draggable({
        element: element,
        getInitialData: () => ({ type: 'card', itemId: rowId, instanceId }),
        onGenerateDragPreview: () => {
          setState({ type: 'preview' });
        },
        canDrag: () => {
          return !editing && !readOnly && rowId !== 'new_card';
        },
        onDragStart: () => setState(draggingState),
        onDrop: () => {
          setState(idleState);
        },
      }),
      dropTargetForExternal({
        element: element,
      }),
      dropTargetForElements({
        element: element,
        canDrop: ({ source }) => {
          return source.data.instanceId === instanceId && source.data.type === 'card';
        },
        getIsSticky: () => true,
        getData: ({ input, element }) => {
          const data = { type: 'card', itemId: rowId };

          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges: ['top', 'bottom'],
          });
        },
        onDragEnter: (args) => {
          if (args.source.data.itemId !== rowId) {
            setClosestEdge(rowId === 'new_card' ? 'top' : extractClosestEdge(args.self.data));
          }
        },
        onDrag: (args) => {

          if (args.source.data.itemId !== rowId) {
            setClosestEdge(rowId === 'new_card' ? 'top' : extractClosestEdge(args.self.data));
          }
        },
        onDragLeave: () => {
          setClosestEdge(null);
        },
        onDrop: () => {
          setClosestEdge(null);
        },
      }),
    );
  }, [instanceId, rowId, readOnly, editing]);

  return (
    <div
      ref={ref}
      className={'relative w-full'}
    >
      {type === CardType.NEW_CARD ? (
        <NewCard
          fieldId={groupFieldId}
          {...props}
        />
      ) : <CardPrimitive
        editing={editing}
        setEditing={setEditing}
        groupFieldId={groupFieldId}
        rowId={rowId}

        className={cn(state.type === 'dragging' && 'opacity-40')}
      />}

      {closestEdge && <DropCardIndicator edge={closestEdge} />}
    </div>
  );
});

