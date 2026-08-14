import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  FieldVisibility,
  isAIFieldType,
  useDatabaseContext,
  useFieldsSelector,
  useReadOnly,
} from '@/application/database-yjs';
import type { Row } from '@/application/database-yjs';
import { useReorderRowDispatch } from '@/application/database-yjs/dispatch';
import { useAIEnabled } from '@/components/app/app.hooks';
import { cn } from '@/lib/utils';

import {
  LIST_DESKTOP_INLINE_PADDING,
  LIST_INITIAL_ROW_LIMIT,
  LIST_LOAD_MORE_INCREMENT,
  LIST_LOAD_MORE_THRESHOLD,
  LIST_ROW_ACTIONS_WIDTH,
} from './list.constants';
import { getListRemainingRowCount, getVisibleListRows } from './list.utils';
import { ListLoadMore, ListLoadMoreIndicator, ListLoadingIndicator, ListNewRow } from './ListControls';
import { ListGroupFooter, ListGroupHeader, ListGroupSeparator } from './ListGroup';
import { useListGrouping } from './ListGroupingContext';
import { ListRow } from './ListRow';
import { ListSortSubscription } from './ListSortState';

import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

const LIST_FIELD_VISIBILITIES = [
  FieldVisibility.AlwaysShown,
  FieldVisibility.HideWhenEmpty,
  FieldVisibility.AlwaysHidden,
];

function ListContent() {
  const grouping = useListGrouping();
  const allFields = useFieldsSelector(LIST_FIELD_VISIBILITIES);
  const aiEnabled = useAIEnabled();
  const fields = useMemo(
    () =>
      allFields.filter(
        (field) =>
          (field.isPrimary || field.visibility !== FieldVisibility.AlwaysHidden) &&
          (aiEnabled || !isAIFieldType(field.fieldType))
      ),
    [aiEnabled, allFields]
  );
  const readOnly = useReadOnly();
  const { activeViewId, isDocumentBlock, onRendered, paddingEnd, paddingStart } = useDatabaseContext();
  const rowOrders = grouping.rowOrders;
  // Stay in grouped mode even when every group is hidden. Falling back to the
  // ungrouped row order would leak rows that the user explicitly hid.
  const useGroupedView = grouping.isGrouped;
  const [visibleRowLimit, setVisibleRowLimit] = useState(LIST_INITIAL_ROW_LIMIT);
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const reorderRow = useReorderRowDispatch();

  useEffect(() => {
    setVisibleRowLimit(LIST_INITIAL_ROW_LIMIT);
    setGroupLimits({});
  }, [activeViewId, grouping.groupId, isDocumentBlock]);

  useEffect(() => {
    if (rowOrders !== undefined && grouping.ready) onRendered?.();
  }, [grouping.ready, onRendered, rowOrders]);

  const visibleRows = useMemo(() => getVisibleListRows(rowOrders, visibleRowLimit), [rowOrders, visibleRowLimit]);
  const remainingRowCount = getListRemainingRowCount(rowOrders, visibleRowLimit);
  const loadMoreRows = useCallback(() => {
    setVisibleRowLimit((current) => current + LIST_LOAD_MORE_INCREMENT);
  }, []);

  useEffect(() => {
    const listElement = scrollContainerRef.current;

    if (!listElement || isDocumentBlock || useGroupedView || remainingRowCount === 0) return;

    const nearestPageScroller = listElement.closest('.appflowy-scroll-container');
    const scrollElement =
      listElement.scrollHeight > listElement.clientHeight
        ? listElement
        : nearestPageScroller instanceof HTMLElement
        ? nearestPageScroller
        : listElement;

    const handleScroll = () => {
      if (scrollElement.clientHeight <= 0) return;

      const distanceFromBottom =
        scrollElement === listElement
          ? scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
          : listElement.getBoundingClientRect().bottom - scrollElement.getBoundingClientRect().bottom;

      if (distanceFromBottom <= LIST_LOAD_MORE_THRESHOLD) loadMoreRows();
    };

    const listenerOptions: AddEventListenerOptions = { passive: true };
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            handleScroll();
          });

    scrollElement.addEventListener('scroll', handleScroll, listenerOptions);
    resizeObserver?.observe(scrollElement);
    if (scrollElement !== listElement) resizeObserver?.observe(listElement);
    handleScroll();

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll, listenerOptions);
      resizeObserver?.disconnect();
    };
  }, [isDocumentBlock, loadMoreRows, remainingRowCount, useGroupedView]);

  const handleDropRow = useCallback(
    (sourceRowId: string, targetRowId: string, closestEdgeOfTarget: Edge) => {
      if (!rowOrders) return;

      const startIndex = rowOrders.findIndex((row) => row.id === sourceRowId);
      const indexOfTarget = rowOrders.findIndex((row) => row.id === targetRowId);

      if (startIndex < 0 || indexOfTarget < 0) return;

      const finishIndex = getReorderDestinationIndex({
        axis: 'vertical',
        closestEdgeOfTarget,
        indexOfTarget,
        startIndex,
      });

      if (finishIndex === startIndex) return;

      const nextRows = reorder({ finishIndex, list: rowOrders, startIndex });
      const previousRowId = nextRows[finishIndex - 1]?.id;

      reorderRow(sourceRowId, previousRowId);
    },
    [reorderRow, rowOrders]
  );

  const effectivePaddingStart = paddingStart || LIST_DESKTOP_INLINE_PADDING;
  const effectivePaddingEnd = paddingEnd || LIST_DESKTOP_INLINE_PADDING;
  const contentStyle = {
    paddingInlineEnd: effectivePaddingEnd,
    paddingInlineStart: Math.max(effectivePaddingStart - LIST_ROW_ACTIONS_WIDTH, 0),
  };
  const containerClassName = cn(
    'database-list appflowy-custom-scroller min-h-0 w-full',
    isDocumentBlock ? 'overflow-visible' : 'h-full flex-1 overflow-y-auto overflow-x-hidden'
  );

  if (rowOrders === undefined) {
    return (
      <div className={containerClassName} data-testid='database-list' ref={scrollContainerRef}>
        <ListLoadingIndicator fillAvailable={!isDocumentBlock} />
      </div>
    );
  }

  let remainingGroupedRowBudget = visibleRowLimit;
  const rowsContent = useGroupedView ? (
    grouping.visibleGroups.map((group) => {
      const groupLimit = groupLimits[group.id] ?? LIST_INITIAL_ROW_LIMIT;
      const groupRowLimit = Math.min(groupLimit, remainingGroupedRowBudget);
      const groupRows = group.collapsed ? [] : group.rows.slice(0, groupRowLimit);
      const groupRemainingRowCount = group.collapsed ? 0 : Math.max(group.rows.length - groupRows.length, 0);

      remainingGroupedRowBudget -= groupRows.length;

      return (
        <section data-group-id={group.id} key={group.id}>
          <ListGroupHeader
            fieldId={grouping.fieldId}
            fieldName={grouping.fieldName}
            fieldType={grouping.fieldType}
            group={group}
            groupConfigId={grouping.groupId}
          />

          {!group.collapsed ? (
            <>
              <div className='py-1'>
                {groupRows.map((row) => (
                  <ListRow
                    fields={fields}
                    groupFieldId={grouping.fieldId}
                    groupId={group.id}
                    key={`${group.id}/${row.id}`}
                    reorderable={false}
                    rowId={row.id}
                    rowOrders={rowOrders}
                  />
                ))}
              </div>
              {groupRemainingRowCount > 0 ? (
                <ListLoadMore
                  groupId={group.id}
                  onLoadMore={() => {
                    setVisibleRowLimit((currentLimit) => currentLimit + LIST_LOAD_MORE_INCREMENT);
                    setGroupLimits((current) => ({
                      ...current,
                      [group.id]: groupLimit + LIST_LOAD_MORE_INCREMENT,
                    }));
                  }}
                  remainingCount={groupRemainingRowCount}
                />
              ) : null}
              {!readOnly ? <ListGroupFooter fieldId={grouping.fieldId} groupId={group.id} /> : null}
            </>
          ) : null}

          <ListGroupSeparator />
        </section>
      );
    })
  ) : (
    <>
      {visibleRows?.map((row: Row) => (
        <ListRow
          fields={fields}
          key={row.id}
          onDropRow={handleDropRow}
          reorderable={!readOnly}
          rowId={row.id}
          rowOrders={rowOrders}
        />
      ))}

      {remainingRowCount > 0 && isDocumentBlock ? (
        <ListLoadMore onLoadMore={loadMoreRows} remainingCount={remainingRowCount} />
      ) : null}
      {!readOnly ? <ListNewRow /> : null}
      {remainingRowCount > 0 && !isDocumentBlock ? <ListLoadMoreIndicator /> : null}
    </>
  );

  return (
    <div className={containerClassName} data-testid='database-list' ref={scrollContainerRef}>
      <div className='w-full py-2' style={contentStyle}>
        {readOnly ? rowsContent : <ListSortSubscription>{rowsContent}</ListSortSubscription>}
      </div>
    </div>
  );
}

export function List() {
  return <ListContent />;
}

export default List;
