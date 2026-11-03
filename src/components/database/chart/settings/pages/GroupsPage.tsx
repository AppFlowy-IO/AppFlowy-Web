import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { attachClosestEdge, Edge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartGroupSummary } from '@/application/database-yjs/chart-config';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import { cn } from '@/lib/utils';

import { ChartSettingsSubPage } from '../ChartSettingsSubPage';

export interface GroupsPageProps {
  title: string;
  /** Every group in its sorted order, hidden ones included; `undefined` while the chart loads. */
  groups: readonly ChartGroupSummary[] | undefined;
  /**
   * The stored `hidden_groups`. Keys that match no listed group are kept by
   * every write except Show all (desktop `ChartGroupsPage` does the same).
   */
  hiddenGroups: readonly string[];
  onHiddenChange: (hiddenGroups: string[]) => void;
  /** A drop (or Alt+↑ / Alt+↓): every listed key in the new order, written with a manual sort. */
  onReorder: (keys: string[]) => void;
  onBack: () => void;
}

const NO_GROUPS: readonly ChartGroupSummary[] = [];

interface GroupRowProps {
  group: ChartGroupSummary;
  index: number;
  instanceId: symbol;
  onToggle: (group: ChartGroupSummary) => void;
  onMove: (index: number, step: -1 | 1) => void;
}

function GroupRow({ group, index, instanceId, onToggle, onMove }: GroupRowProps) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const [edge, setEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const element = rowRef.current;
    const dragHandle = handleRef.current;

    if (!element || !dragHandle) return;
    return combine(
      draggable({ element, dragHandle, getInitialData: () => ({ instanceId, key: group.key, index }) }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.instanceId === instanceId,
        getData: ({ input }) =>
          attachClosestEdge({ key: group.key, index }, { element, input, allowedEdges: ['top', 'bottom'] }),
        onDrag: ({ self }) => setEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null),
      })
    );
  }, [instanceId, group.key, index]);

  const label = group.hidden
    ? t('chart.groups.showGroup', { defaultValue: 'Show group' })
    : t('chart.groups.hideGroup', { defaultValue: 'Hide group' });

  return (
    <div
      ref={rowRef}
      tabIndex={0}
      role='listitem'
      data-testid={`chart-group-${group.key}`}
      data-hidden={group.hidden ? 'true' : 'false'}
      className='group relative flex h-7 shrink-0 items-center gap-2 rounded-[6px] px-1 outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
      onKeyDown={(event: KeyboardEvent) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        onMove(index, event.key === 'ArrowUp' ? -1 : 1);
      }}
    >
      {edge ? (
        <span
          aria-hidden='true'
          className={cn('absolute left-1 right-1 h-0.5 rounded bg-dash-accent', edge === 'top' ? '-top-px' : '-bottom-px')}
        />
      ) : null}
      <span
        ref={handleRef}
        data-testid={`chart-group-handle-${group.key}`}
        className='flex h-4 w-4 shrink-0 cursor-grab items-center justify-center text-icon-tertiary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
      >
        <DragIcon aria-hidden='true' className='h-4 w-4' />
      </span>
      <span aria-hidden='true' className='h-2 w-2 shrink-0 rounded-[2px]' style={{ backgroundColor: group.color }} />
      <span className={cn('min-w-0 flex-1 truncate text-sm leading-5', group.hidden ? 'text-text-tertiary' : 'text-text-primary')}>
        {group.label}
      </span>
      <span className='shrink-0 text-xs leading-4 text-text-tertiary tabular-nums'>{group.count}</span>
      <button
        type='button'
        aria-label={label}
        aria-pressed={group.hidden}
        data-testid={`chart-group-eye-${group.key}`}
        className='flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-dash-tool-icon outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
        onClick={() => onToggle(group)}
      >
        {group.hidden ? <HideIcon aria-hidden='true' className='h-4 w-4' /> : <ShowIcon aria-hidden='true' className='h-4 w-4' />}
      </button>
    </div>
  );
}

/**
 * The Groups page (WP11 §1.8): every group in the chart's order with its
 * color, row count and an eye toggle; Hide all / Show all; dragging a row (or
 * Alt+↑ / Alt+↓) makes the order manual.
 */
export function GroupsPage({ title, groups, hiddenGroups, onHiddenChange, onReorder, onBack }: GroupsPageProps) {
  const { t } = useTranslation();
  const [instanceId] = useState(() => Symbol('chart-groups'));
  const list = groups ?? NO_GROUPS;
  const listRef = useRef(list);
  const hiddenRef = useRef(hiddenGroups);

  // Written after commit, not during render: the drop monitor and the eye
  // toggles read what was rendered last, never a render React discarded.
  useLayoutEffect(() => {
    listRef.current = list;
    hiddenRef.current = hiddenGroups;
  }, [list, hiddenGroups]);

  const anyHidden = list.some((group) => group.hidden);

  const toggle = useCallback(
    (group: ChartGroupSummary) => {
      const stored = hiddenRef.current;

      onHiddenChange(stored.includes(group.key) ? stored.filter((key) => key !== group.key) : [...stored, group.key]);
    },
    [onHiddenChange]
  );
  // Hide all: the stored keys first, then every listed key not hidden yet.
  const hideAll = () => onHiddenChange([...new Set([...hiddenGroups, ...list.map((group) => group.key)])]);

  const move = useCallback(
    (startIndex: number, finishIndex: number) => {
      const current = listRef.current.map((group) => group.key);

      if (finishIndex < 0 || finishIndex >= current.length || finishIndex === startIndex) return;
      onReorder(reorder({ list: current, startIndex, finishIndex }));
    },
    [onReorder]
  );

  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => source.data.instanceId === instanceId,
        onDrop: ({ source, location }) => {
          const target = location.current.dropTargets[0];

          if (!target) return;
          const startIndex = Number(source.data.index);
          const indexOfTarget = Number(target.data.index);
          const finishIndex = getReorderDestinationIndex({
            startIndex,
            indexOfTarget,
            closestEdgeOfTarget: extractClosestEdge(target.data),
            axis: 'vertical',
          });

          move(startIndex, finishIndex);
        },
      }),
    [instanceId, move]
  );

  return (
    <ChartSettingsSubPage title={title} onBack={onBack}>
      <div className='flex h-7 items-center gap-2 px-2'>
        <span className='flex-1 text-xs font-medium leading-4 text-text-secondary' data-testid='chart-groups-count'>
          {t('chart.groups.count', { defaultValue: '{{count}} groups', count: list.length })}
        </span>
        {list.length > 0 && anyHidden ? (
          <button
            type='button'
            data-testid='chart-groups-show-all'
            className='text-xs leading-4 text-text-action hover:underline'
            onClick={() => onHiddenChange([])}
          >
            {t('chart.groups.showAll', { defaultValue: 'Show all' })}
          </button>
        ) : null}
        {list.length > 0 && !anyHidden ? (
          <button
            type='button'
            data-testid='chart-groups-hide-all'
            className='text-xs leading-4 text-text-action hover:underline'
            onClick={hideAll}
          >
            {t('chart.groups.hideAll', { defaultValue: 'Hide all' })}
          </button>
        ) : null}
      </div>
      {list.length === 0 ? (
        <div data-testid='chart-groups-empty' className='flex h-7 items-center justify-center text-xs text-text-tertiary'>
          {t('chart.groups.noGroups', { defaultValue: 'No groups' })}
        </div>
      ) : (
        <div role='list' aria-label={title} className='flex flex-col'>
          {list.map((group, index) => (
            <GroupRow
              key={group.key}
              group={group}
              index={index}
              instanceId={instanceId}
              onToggle={toggle}
              onMove={(from, step) => move(from, from + step)}
            />
          ))}
        </div>
      )}
    </ChartSettingsSubPage>
  );
}

export default GroupsPage;
