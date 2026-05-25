import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { Tooltip } from '@mui/material';
import React, { useEffect, useMemo, useRef } from 'react';

import { View } from '@/application/types';
import { ReactComponent as PrivateIcon } from '@/assets/icons/lock.svg';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import ViewItem from '@/components/app/outline/ViewItem';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import { cn } from '@/lib/utils';

type SpaceDragState =
  | { type: 'idle' }
  | { type: 'dragging' }
  | { type: 'over'; closestEdge: Edge | null };

const idleState: SpaceDragState = { type: 'idle' };

function SpaceItem({
  view,
  width,
  renderExtra,
  expandIds,
  toggleExpand,
  onClickView,
  onClickSpace,
  loadingViewIds,
  loadedViewIds,
  canReorder,
  dragInstanceId,
}: {
  view: View;
  width: number;
  expandIds: string[];
  toggleExpand: (id: string, isExpand: boolean) => void;
  renderExtra?: ({ hovered, view }: { hovered: boolean; view: View }) => React.ReactNode;
  onClickView?: (viewId: string) => void;
  onClickSpace?: (viewId: string) => void;
  loadingViewIds?: Set<string>;
  loadedViewIds?: Set<string>;
  canReorder?: boolean;
  dragInstanceId?: symbol;
}) {
  const [hovered, setHovered] = React.useState<boolean>(false);
  const [dragState, setDragState] = React.useState<SpaceDragState>(idleState);
  const rowRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<number>();
  const isExpanded = expandIds.includes(view.view_id);
  const isPrivate = view.is_private;

  useEffect(() => {
    return () => {
      if (suppressClickTimeoutRef.current !== undefined) {
        window.clearTimeout(suppressClickTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const element = rowRef.current;

    if (!canReorder || !dragInstanceId || !element) return;

    const data = {
      type: 'space',
      instanceId: dragInstanceId,
      id: view.view_id,
    };

    return combine(
      draggable({
        element,
        getInitialData: () => data,
        onDragStart() {
          suppressClickRef.current = true;
          if (suppressClickTimeoutRef.current !== undefined) {
            window.clearTimeout(suppressClickTimeoutRef.current);
            suppressClickTimeoutRef.current = undefined;
          }

          setDragState({ type: 'dragging' });
        },
        onDrop() {
          suppressClickTimeoutRef.current = window.setTimeout(() => {
            suppressClickRef.current = false;
            suppressClickTimeoutRef.current = undefined;
          }, 0);

          setDragState(idleState);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source.data.type === 'space' &&
          source.data.instanceId === dragInstanceId &&
          source.data.id !== view.view_id,
        getIsSticky: () => true,
        getData({ input }) {
          return attachClosestEdge(data, {
            element,
            input,
            allowedEdges: ['top', 'bottom'],
          });
        },
        onDrag({ self }) {
          const closestEdge = extractClosestEdge(self.data);

          setDragState((current) => {
            if (current.type === 'over' && current.closestEdge === closestEdge) return current;
            return { type: 'over', closestEdge };
          });
        },
        onDragLeave() {
          setDragState(idleState);
        },
        onDrop() {
          setDragState(idleState);
        },
      })
    );
  }, [canReorder, dragInstanceId, view.view_id]);

  const renderItem = useMemo(() => {
    if (!view) return null;
    const extra = view?.extra;
    const name = view?.name || '';

    return (
      <div
        ref={rowRef}
        data-testid={`space-${view.view_id}`}
        data-expanded={isExpanded}
        style={{
          width,
        }}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            if (suppressClickTimeoutRef.current !== undefined) {
              window.clearTimeout(suppressClickTimeoutRef.current);
              suppressClickTimeoutRef.current = undefined;
            }

            return;
          }

          toggleExpand(view.view_id, !isExpanded);
          onClickSpace?.(view.view_id);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'relative flex min-h-[30px] w-full cursor-pointer select-none items-center gap-0.5 truncate rounded-[8px] px-1 py-0.5 text-sm hover:bg-fill-content-hover focus:bg-fill-content-hover focus:outline-none',
          dragState.type === 'dragging' && 'opacity-40'
        )}
      >
        <SpaceIcon
          className={'icon mr-1.5 !h-5 !w-5 !min-w-5'}
          bgColor={extra?.space_icon_color}
          value={extra?.space_icon || ''}
          char={extra?.space_icon ? undefined : name.slice(0, 1)}
        />
        <Tooltip title={name} disableInteractive={true}>
          <div className={'flex flex-1 items-center justify-start gap-1 overflow-hidden text-sm'}>
            <div data-testid="space-name" className={'truncate font-medium'}>{name}</div>

            {isPrivate && (
              <div className={'min-h-5 min-w-5 text-base text-text-primary opacity-80'}>
                <PrivateIcon className='h-5 w-5' />
              </div>
            )}
          </div>
        </Tooltip>
        {renderExtra && renderExtra({ hovered, view })}
        {dragState.type === 'over' ? <DropRowIndicator edge={dragState.closestEdge} /> : null}
      </div>
    );
  }, [dragState, hovered, isExpanded, isPrivate, onClickSpace, renderExtra, toggleExpand, view, width]);

  const isLoading = loadingViewIds?.has(view.view_id) && (!view.children || view.children.length === 0);

  const renderChildren = useMemo(() => {
    return (
      <div
        className={'flex transform flex-col gap-2 transition-all'}
        style={{
          display: isExpanded ? 'block' : 'none',
        }}
      >
        {isLoading ? (
          <div className={'flex flex-col'}>
            {[96, 72, 88].map((w, i) => (
              <div key={i} className={'flex min-h-[30px] items-center gap-1.5 py-1 px-0.5'} style={{ paddingLeft: '16px' }}>
                <div className={'h-4 w-4 animate-pulse rounded bg-fill-content-hover'} />
                <div className={`h-4 animate-pulse rounded bg-fill-content-hover`} style={{ width: `${w}px` }} />
              </div>
            ))}
          </div>
        ) : (
          view?.children?.map((child) => (
            <ViewItem
              key={child.view_id}
              view={child}
              width={width}
              renderExtra={renderExtra}
              expandIds={expandIds}
              toggleExpand={toggleExpand}
              onClickView={onClickView}
              loadingViewIds={loadingViewIds}
              loadedViewIds={loadedViewIds}
            />
          ))
        )}
      </div>
    );
  }, [onClickView, isExpanded, isLoading, view?.children, width, renderExtra, expandIds, toggleExpand, loadingViewIds, loadedViewIds]);

  return (
    <div className={'flex h-fit w-full flex-col'} data-testid='space-item'>
      <div data-testid='space-expanded' data-expanded={isExpanded} style={{ display: 'none' }} />
      {renderItem}
      {renderChildren}
    </div>
  );
}

export default SpaceItem;
