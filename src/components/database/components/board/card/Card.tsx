import { CardPrimitive } from '@/components/database/components/board/card/CardPrimitive';
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
}: {
  groupFieldId: string;
  rowId: string;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const { instanceId, registerCard } = useBoardContext();
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [state, setState] = useState<State>(idleState);

  useEffect(() => {
    if (!ref.current) return;

    return registerCard({
      cardId: rowId,
      entry: {
        element: ref.current,
      },
    });
  }, [registerCard, rowId]);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;
    return combine(
      draggable({
        element: element,
        getInitialData: () => ({ type: 'card', itemId: rowId, instanceId }),
        onGenerateDragPreview: () => {
          setState({ type: 'preview' });
        },

        onDragStart: () => setState(draggingState),
        onDrop: () => setState(idleState),
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
            setClosestEdge(extractClosestEdge(args.self.data));
          }
        },
        onDrag: (args) => {
          if (args.source.data.itemId !== rowId) {
            setClosestEdge(extractClosestEdge(args.self.data));
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
  }, [instanceId, rowId]);

  return (
    <div className={'relative w-full'}>
      <CardPrimitive
        groupFieldId={groupFieldId}
        rowId={rowId}
        ref={ref}
        className={cn(state.type === 'dragging' && 'opacity-40')}
      />
      {closestEdge && <DropCardIndicator edge={closestEdge} />}
    </div>
  );
});

