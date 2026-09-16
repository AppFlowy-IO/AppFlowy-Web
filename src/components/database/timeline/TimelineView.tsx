import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import dayjs from 'dayjs';
import { PointerEvent as ReactPointerEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldVisibility,
  isAIFieldType,
  TimelineDependencyDirection,
  TimelineDependencyLink,
  TimelineLayoutSetting,
  timelineLinkKey,
  TimelineLayout,
  useDatabaseContext,
  useDatabaseViewId,
  useFieldSelector,
  useDatabaseFields,
  useDatabaseView,
  useFieldsSelector,
  useNavigateToRow,
  usePrimaryFieldId,
} from '@/application/database-yjs';
import { useUpdateTimelineSetting } from '@/application/database-yjs/dispatch';
import { useUpdateAnyCellDispatch, useUpdateStartEndTimeCell } from '@/application/database-yjs/dispatch/cell';
import { useUpdateRelationCellDispatch } from '@/application/database-yjs/dispatch/relation';
import {
  useDuplicateRowDispatch,
  useNewRowDispatch,
  useReorderRowDispatch,
} from '@/application/database-yjs/dispatch/row';
import { useSetUpTimelineDependenciesDispatch } from '@/application/database-yjs/dispatch/timeline-dependencies';
import { getGroupRowCellsData } from '@/application/database-yjs/group-row';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as CollapseIcon } from '@/assets/icons/double_arrow_left.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/double_arrow_right.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useAIEnabled } from '@/components/app/app.hooks';
import { type Edge } from '@/components/database/components/drag-and-drop/useRowDnd';
import { FieldDisplay } from '@/components/database/components/field';
import { useTimeFormat } from '@/components/database/fullcalendar/hooks/useTimeFormat';
import { shouldUseFixedDatabaseViewport } from '@/components/database/layout';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { correctAllDayEndForStorage, dateToUnixTimestamp } from '@/utils/time';

import {
  TIMELINE_BOTTOM_PADDING,
  TIMELINE_COLLAPSED_SIDEBAR_WIDTH,
  TIMELINE_COLUMN_OVERSCAN,
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_ROW_HEIGHT,
  TIMELINE_SIDEBAR_WIDTH,
  TIMELINE_TABLE_COLUMN_WIDTH,
  TIMELINE_TABLE_CONTROL_WIDTH,
  TIMELINE_TODAY_ANCHOR,
} from './constants';
import { useScrollWindow } from './hooks/useScrollWindow';
import { TimelineDragMode, TimelineDragPreview, TimelineDragSpan, useTimelineDrag } from './hooks/useTimelineDrag';
import { parseProgressPercent, parseRelationRowIds, serializeTimelineProgressPercent, useTimelineFieldValues } from './hooks/useTimelineFieldValues';
import { useTimelineItems } from './hooks/useTimelineItems';
import { useTimelineLinkDrag } from './hooks/useTimelineLinkDrag';
import { useTimelinePermissions } from './hooks/useTimelinePermissions';
import { useTimelineRange } from './hooks/useTimelineRange';
import { useTimelineRects } from './hooks/useTimelineRects';
import { TimelineRowModel, useTimelineRows } from './hooks/useTimelineRows';
import { useTimelineVirtualizer } from './hooks/useTimelineVirtualizer';
import { buildDependencyGraph, collectDependents, linkOf } from './scale/dependencies';
import {
  buildHeaderColumns,
  buildHeaderSegments,
  calendarDaysBetween,
  dateToX,
  BarRect,
  getBarSpan,
  snapDate,
  totalWidth,
  xToDate,
} from './scale/geometry';
import { hitTestLink, TimelineArrows, TimelineLinkSelection } from './TimelineArrows';
import { TimelineBarDragLabel } from './TimelineBar';
import { TimelineCalculation } from './TimelineCalculation';
import { TimelineGrid } from './TimelineGrid';
import { useTimelineGrouping } from './TimelineGroupingContext';
import { TimelineGroupFooter, TimelineGroupRow } from './TimelineGroupRow';
import { TimelineHeader } from './TimelineHeader';
import { TimelineLinkEditor } from './TimelineLinkEditor';
import { TimelineRow, TimelineRowActions } from './TimelineRow';
import { TimelineTableProvider, TimelineTableViewport, timelineTableViewportWidth } from './TimelineTable';
import { TimelineToolbar } from './TimelineToolbar';

// Calendar cards carry only the title; a timeline bar adds chips solely for
// properties the user set to "always shown" in this view's Properties menu.
const CARD_FIELD_VISIBILITIES = [FieldVisibility.AlwaysShown];

function dragLabelFor(preview: TimelineDragPreview): TimelineBarDragLabel {
  if (preview.mode === 'progress') return { side: 'end', text: `${preview.progress ?? 0}%` };
  const side = preview.mode === 'resize-end' ? 'end' : 'start';

  if (preview.allDay) {
    const date = side === 'end' ? dayjs(preview.endExclusive).subtract(1, 'day') : dayjs(preview.start);

    return { side, text: date.format('MMM D') };
  }

  const date = side === 'end' ? dayjs(preview.endExclusive) : dayjs(preview.start);

  return { side, text: date.format('MMM D, h:mm A') };
}

export function TimelineView({ setting }: { setting: TimelineLayoutSetting }) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // The element itself, as state, so rows rendered before the scroller
  // mounted still get it as their hover-card boundary.
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((element: HTMLDivElement | null) => {
    scrollerRef.current = element;
    setScrollerEl(element);
  }, []);
  const { isDocumentBlock, variant, paddingStart, paddingEnd } = useDatabaseContext();
  const fixedViewport = shouldUseFixedDatabaseViewport({ isDocumentBlock, variant });
  const updateSetting = useUpdateTimelineSetting();
  const updateStartEnd = useUpdateStartEndTimeCell();
  const updateAnyCell = useUpdateAnyCellDispatch();
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const newRow = useNewRowDispatch();
  const navigateToRow = useNavigateToRow();
  const aiEnabled = useAIEnabled();
  const permissions = useTimelinePermissions(setting.fieldId, setting.endFieldId);
  // One subscription to the user's time format, shared by every bar.
  const { formatTimeDisplay } = useTimeFormat();
  const primaryFieldId = usePrimaryFieldId();
  const { field: primaryField } = useFieldSelector(primaryFieldId || '');
  const primaryFieldName = (primaryField?.get(YjsDatabaseKey.name) as string | undefined) ?? '';

  // Read-only viewers may explore another scale or hide the table without
  // writing shared data, exactly as the calendar keeps a local view mode. The
  // entry is tagged with its view id and ignored once the view or the
  // permission changes, so no effect is needed to reset it.
  const [localSetting, setLocalSetting] = useState<{
    viewId: string;
    layout?: TimelineLayout;
    showTable?: boolean;
  }>();
  const viewId = useDatabaseViewId();
  const localOverride = permissions.readOnly && localSetting?.viewId === viewId ? localSetting : undefined;
  const layout = localOverride?.layout ?? setting.layout;
  const showSidebar = localOverride?.showTable ?? setting.showTable;
  // Only columns whose field still exists are shown, in the setting's order.
  const databaseFields = useDatabaseFields();
  const tableFieldIds = useMemo(
    () => setting.tableFieldIds.filter((fieldId) => fieldId !== primaryFieldId && databaseFields?.has(fieldId)),
    [databaseFields, primaryFieldId, setting.tableFieldIds]
  );
  const tableContentWidth = showSidebar
    ? TIMELINE_SIDEBAR_WIDTH + tableFieldIds.length * TIMELINE_TABLE_COLUMN_WIDTH
    : TIMELINE_COLLAPSED_SIDEBAR_WIDTH;
  const scroll = useScrollWindow(scrollerRef);
  const sidebarWidth = timelineTableViewportWidth(tableContentWidth, scroll.clientWidth);

  const { rows, emptyEvents, rowOrders, hasEndField } = useTimelineRows(showSidebar);
  const grouping = useTimelineGrouping();
  // Rows, or group headers / rows / "+ New" footers when the view is grouped.
  const items = useTimelineItems(rows, grouping, permissions.editable);
  // Bars and arrows are addressed by item index; non-row items carry no id.
  const itemRowIds = useMemo(() => items.map((item) => (item.kind === 'row' ? item.row.rowId : '')), [items]);
  const itemGroupIds = useMemo(() => items.map((item) => (item.kind === 'row' ? item.groupId : undefined)), [items]);
  const reorderRow = useReorderRowDispatch();
  // The row gutter's actions, created once here rather than by every row:
  // their dispatch hooks subscribe to the whole database context, and the
  // values are only read inside click handlers.
  const duplicateRow = useDuplicateRowDispatch();
  const databaseView = useDatabaseView();
  // Everything the actions read at click time lives in a ref, so the actions
  // object itself never changes and never invalidates the memoized rows.
  const rowActionsDepsRef = useRef({ rowOrders, newRow, duplicateRow, databaseFields, databaseView });

  rowActionsDepsRef.current = { rowOrders, newRow, duplicateRow, databaseFields, databaseView };
  const rowActions = useMemo<TimelineRowActions>(() => {
    const cells = (groupFieldId?: string, groupId?: string) => {
      const deps = rowActionsDepsRef.current;

      return getGroupRowCellsData(deps.databaseFields, groupFieldId, groupId, deps.databaseView);
    };

    return {
      addAbove: (rowId, groupFieldId, groupId) => {
        const deps = rowActionsDepsRef.current;
        const index = deps.rowOrders.findIndex((row) => row.id === rowId);

        return deps.newRow({
          beforeRowId: index > 0 ? deps.rowOrders[index - 1]?.id : undefined,
          cellsData: cells(groupFieldId, groupId),
        });
      },
      addBelow: (rowId, groupFieldId, groupId) =>
        rowActionsDepsRef.current.newRow({ beforeRowId: rowId, cellsData: cells(groupFieldId, groupId) }),
      duplicate: (rowId) => rowActionsDepsRef.current.duplicateRow(rowId),
    };
  }, []);
  // Same reorder semantics as the List view: drop above / below a row, then
  // tell the view which row now precedes the moved one.
  const handleDropRow = useCallback(
    (sourceRowId: string, targetRowId: string, closestEdgeOfTarget: Edge) => {
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

      reorderRow(sourceRowId, nextRows[finishIndex - 1]?.id);
    },
    [reorderRow, rowOrders]
  );
  const relations = useTimelineFieldValues(setting.dependencyFieldId, parseRelationRowIds);
  const progressValues = useTimelineFieldValues(setting.progressFieldId, parseProgressPercent);
  const rowIds = useMemo(() => rows.map((row) => row.rowId), [rows]);
  const graph = useMemo(
    () =>
      buildDependencyGraph(rowIds, relations, {
        direction: setting.dependencyDirection,
        links: setting.dependencyLinks,
      }),
    [relations, rowIds, setting.dependencyDirection, setting.dependencyLinks]
  );
  const { geometry, handleScroll, scrollToDate, scrollToX, scrollByColumns } = useTimelineRange({
    layout,
    scrollerRef,
    sidebarWidth,
  });

  const fields = useFieldsSelector(CARD_FIELD_VISIBILITIES);
  const propertyFields = useMemo(
    () =>
      fields.filter(
        (field) =>
          !field.isPrimary &&
          field.fieldId !== setting.fieldId &&
          field.fieldId !== setting.dependencyFieldId &&
          field.fieldId !== setting.progressFieldId &&
          field.visibility === FieldVisibility.AlwaysShown &&
          (aiEnabled || !isAIFieldType(field.fieldType))
      ),
    [aiEnabled, fields, setting.dependencyFieldId, setting.fieldId, setting.progressFieldId]
  );

  const canvasWidth = totalWidth(geometry);
  const viewLeft = scroll.scrollLeft;
  const viewRight = scroll.scrollLeft + Math.max(0, scroll.clientWidth - sidebarWidth);
  const { columnWidth } = geometry.preset;
  // Whole columns, so scrolling within a column doesn't rebuild the header.
  const fromIndex = Math.floor(viewLeft / columnWidth) - TIMELINE_COLUMN_OVERSCAN;
  const toIndex = Math.ceil(viewRight / columnWidth) + TIMELINE_COLUMN_OVERSCAN;
  const now = useMemo(() => new Date(), []);

  const columns = useMemo(
    () => buildHeaderColumns(geometry, fromIndex, toIndex, setting.firstDayOfWeek, now, setting.use24Hour),
    [geometry, fromIndex, toIndex, setting.firstDayOfWeek, now, setting.use24Hour]
  );
  const segments = useMemo(() => buildHeaderSegments(geometry, fromIndex, toIndex), [geometry, fromIndex, toIndex]);
  const todayX = dateToX(geometry, now);
  const showToday = todayX >= 0 && todayX <= canvasWidth;
  // The toolbar names the month (or day) at the left edge, as the calendar's title does.
  const anchorColumn = Math.max(0, Math.floor(viewLeft / columnWidth));
  const title = useMemo(
    () => geometry.preset.upperText(xToDate(geometry, anchorColumn * columnWidth)),
    [anchorColumn, columnWidth, geometry]
  );

  const handleOpen = useCallback((rowId: string) => navigateToRow?.(rowId), [navigateToRow]);

  const commitSpan = useCallback(
    (rowId: string, start: Date, endExclusive: Date, allDay: boolean, keepSingle: boolean, historyGroup?: object) => {
      if (!permissions.dateEditable) return;
      const history = historyGroup ? { historyGroup } : undefined;

      if (hasEndField) {
        // Separate start and end fields: the start cell and the end cell each
        // hold a single date, written as one undo group.
        const group = history ?? { historyGroup: {} };
        const end = allDay ? correctAllDayEndForStorage(endExclusive) : endExclusive;

        updateStartEnd(rowId, setting.fieldId, dateToUnixTimestamp(start), undefined, allDay, group);
        if (!keepSingle) updateStartEnd(rowId, setting.endFieldId, dateToUnixTimestamp(end), undefined, allDay, group);
        return;
      }

      if (allDay) {
        const singleDay = calendarDaysBetween(start, endExclusive) <= 1;
        const end = singleDay ? undefined : dateToUnixTimestamp(correctAllDayEndForStorage(endExclusive));

        updateStartEnd(rowId, setting.fieldId, dateToUnixTimestamp(start), end, true, history);
        return;
      }

      updateStartEnd(
        rowId,
        setting.fieldId,
        dateToUnixTimestamp(start),
        keepSingle ? undefined : dateToUnixTimestamp(endExclusive),
        false,
        history
      );
    },
    [hasEndField, permissions.dateEditable, setting.endFieldId, setting.fieldId, updateStartEnd]
  );

  // Row lookups by id (bar press followers, editor titles) without rescans.
  const rowById = useMemo(() => new Map(rows.map((row) => [row.rowId, row] as const)), [rows]);
  const rowByIdRef = useRef(rowById);

  rowByIdRef.current = rowById;

  const handleDragCommit = useCallback(
    (preview: TimelineDragPreview) => {
      if (preview.mode === 'progress') {
        const progressField = databaseFields?.get(setting.progressFieldId);

        const data = progressField && preview.progress !== undefined
          ? serializeTimelineProgressPercent(preview.progress, progressField)
          : undefined;

        if (data !== undefined) updateAnyCell(preview.rowId, setting.progressFieldId, data);

        return;
      }

      const byId = rowByIdRef.current;
      const row = byId.get(preview.rowId);
      // A timed row without an end keeps its synthetic length only while moving.
      const keepSingle = Boolean(row && !row.isRange && preview.mode === 'move');
      // The dragged bar and every follower undo together.
      const historyGroup = {};

      commitSpan(preview.rowId, preview.start, preview.endExclusive, preview.allDay, keepSingle, historyGroup);
      preview.followers.forEach((follower) => {
        const followerRow = byId.get(follower.rowId);

        commitSpan(
          follower.rowId,
          follower.start,
          follower.endExclusive,
          follower.allDay,
          Boolean(followerRow && !followerRow.isRange),
          historyGroup
        );
      });
    },
    [commitSpan, databaseFields, setting.progressFieldId, updateAnyCell]
  );

  const {
    preview,
    dragging,
    startDrag,
    clickAfterDragRef: clickAfterBarDragRef,
  } = useTimelineDrag({
    geometry,
    scrollerRef,
    sidebarWidth,
    onCommit: handleDragCommit,
    onClick: handleOpen,
  });

  const handleBarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, row: TimelineRowModel, mode: TimelineDragMode) => {
      if (!permissions.editable || (mode !== 'progress' && !permissions.dateEditable) || !row.start) return;
      const span = getBarSpan(row.start, row.end, row.allDay);
      const byId = rowByIdRef.current;
      // Dependents move with the bar per the "Shift dependents" setting; each
      // carries the dependencies it has inside the moving set so "only when
      // overlapping" can cascade through the chain.
      const dependentIds = collectDependents(row.rowId, graph);
      const movingSet = new Set([row.rowId, ...dependentIds]);
      const followers: TimelineDragSpan[] = dependentIds.flatMap((dependentId) => {
        const dependent = byId.get(dependentId);

        if (!dependent?.start) return [];
        return [
          {
            rowId: dependent.rowId,
            allDay: dependent.allDay,
            ...getBarSpan(dependent.start, dependent.end, dependent.allDay),
            predecessors: (graph.predecessors.get(dependentId) ?? [])
              .filter((id) => movingSet.has(id))
              .map((id) => ({ rowId: id, ...linkOf(graph, id, dependentId) })),
          },
        ];
      });

      startDrag(
        event,
        {
          rowId: row.rowId,
          allDay: row.allDay,
          ...span,
          followers,
          shift: setting.dependencyShift,
          avoidWeekends: setting.avoidWeekends,
          progress: progressValues.get(row.rowId) ?? 0,
        },
        mode
      );
    },
    [
      graph,
      permissions.editable,
      permissions.dateEditable,
      progressValues,
      setting.avoidWeekends,
      setting.dependencyShift,
      startDrag,
    ]
  );

  const handleEmptyClick = useCallback(
    (row: TimelineRowModel, x: number) => {
      if (!permissions.dateEditable) return;
      const start = snapDate(geometry.preset, xToDate(geometry, x), 'floor');
      const endExclusive = dayjs(start).add(geometry.preset.snapMinutes, 'minute').toDate();
      const allDay = geometry.preset.unit === 'day';

      commitSpan(row.rowId, start, endExclusive, allDay, !allDay);
    },
    [commitSpan, geometry, permissions.dateEditable]
  );

  const virtualizer = useTimelineVirtualizer(items, scrollerRef);

  const updateRelationCell = useUpdateRelationCellDispatch();
  const graphRef = useRef(graph);

  graphRef.current = graph;
  // Dropping a bar's connector on another bar makes the target depend on the
  // source: the source row id is appended to the target's relation cell.
  // The relation cell that stores a link depends on which side the bound
  // field lists: "Blocked by" writes the predecessor into the successor's
  // cell, "Blocking" the successor into the predecessor's.
  const setUpDependencies = useSetUpTimelineDependenciesDispatch();
  const writeLink = useCallback(
    (
      predecessorId: string,
      successorId: string,
      change: 'insert' | 'remove',
      binding: { fieldId: string; direction: TimelineDependencyDirection } = {
        fieldId: setting.dependencyFieldId,
        direction: setting.dependencyDirection,
      }
    ) => {
      if (!binding.fieldId) return;
      const listsSuccessors = binding.direction === TimelineDependencyDirection.Blocking;
      const [ownerId, otherId] = listsSuccessors ? [predecessorId, successorId] : [successorId, predecessorId];

      void updateRelationCell(ownerId, binding.fieldId, {
        [change === 'insert' ? 'insertedRowIds' : 'removedRowIds']: [otherId],
      }).catch(() => undefined);
    },
    [setting.dependencyDirection, setting.dependencyFieldId, updateRelationCell]
  );
  const handleLinkCommit = useCallback(
    (sourceRowId: string, targetRowId: string) => {
      const current = graphRef.current;

      if (sourceRowId === targetRowId) return;
      if (current.predecessors.get(targetRowId)?.includes(sourceRowId)) return;
      // Refuse a link that would close a cycle (the source already depends on the target).
      if (collectDependents(targetRowId, current).includes(sourceRowId)) return;
      if (setting.dependencyFieldId) {
        writeLink(sourceRowId, targetRowId, 'insert');
        return;
      }

      // First connector on a view without dependencies: set the pair up, like Notion.
      const fieldId = setUpDependencies();

      if (fieldId) {
        writeLink(sourceRowId, targetRowId, 'insert', { fieldId, direction: TimelineDependencyDirection.BlockedBy });
      }
    },
    [setUpDependencies, setting.dependencyFieldId, writeLink]
  );

  const {
    link,
    startLink,
    clickAfterDragRef: clickAfterLinkDragRef,
  } = useTimelineLinkDrag({ scrollerRef, sidebarWidth, onCommit: handleLinkCommit });
  // Clicking an arrow opens the link editor (type, lag, remove). The arrows
  // are drawn under the rows, so the row canvas hands its clicks here.
  const [selectedLink, setSelectedLink] = useState<TimelineLinkSelection | null>(null);
  const arrowsRef = useRef<SVGSVGElement | null>(null);
  const handleCanvasClick = useCallback(
    (clientX: number, clientY: number) => {
      // A drop's trailing click is not a click on the canvas.
      if (clickAfterBarDragRef.current || clickAfterLinkDragRef.current) return;
      const hit = hitTestLink(arrowsRef.current, clientX, clientY);

      if (hit) {
        setSelectedLink(hit);
        return;
      }

      setSelectedRowId(null);
    },
    [clickAfterBarDragRef, clickAfterLinkDragRef]
  );

  const selectedLinkKey = selectedLink ? timelineLinkKey(selectedLink.predecessorId, selectedLink.successorId) : '';
  const selectedLinkMeta = selectedLink ? linkOf(graph, selectedLink.predecessorId, selectedLink.successorId) : null;
  // Canvas → body coordinates for the popover anchor; stable across scroll frames.
  const editorSelection = useMemo(
    () => (selectedLink ? { ...selectedLink, x: selectedLink.x + sidebarWidth, y: selectedLink.y } : null),
    [selectedLink, sidebarWidth]
  );
  const closeLinkEditor = useCallback(() => setSelectedLink(null), []);
  const handleLinkChange = useCallback(
    (next: TimelineDependencyLink) => {
      if (!selectedLink) return;
      updateSetting({
        dependencyLinks: {
          ...setting.dependencyLinks,
          [timelineLinkKey(selectedLink.predecessorId, selectedLink.successorId)]: next,
        },
      });
    },
    [selectedLink, setting.dependencyLinks, updateSetting]
  );
  const handleLinkRemove = useCallback(() => {
    if (!selectedLink) return;
    const { [selectedLinkKey]: removed, ...rest } = setting.dependencyLinks;

    void removed;
    if (selectedLinkKey in setting.dependencyLinks) updateSetting({ dependencyLinks: rest });
    writeLink(selectedLink.predecessorId, selectedLink.successorId, 'remove');
    setSelectedLink(null);
  }, [selectedLink, selectedLinkKey, setting.dependencyLinks, updateSetting, writeLink]);
  const editorTitles = useMemo(() => {
    if (!selectedLink) return null;
    const titleOf = (rowId: string) => rowById.get(rowId)?.title || t('grid.row.titlePlaceholder');

    return { predecessor: titleOf(selectedLink.predecessorId), successor: titleOf(selectedLink.successorId) };
  }, [rowById, selectedLink, t]);
  const handleLinkPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, row: TimelineRowModel, rect: BarRect, index: number) => {
      startLink(event, row.rowId, {
        x: rect.left + rect.width,
        y: index * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2,
      });
    },
    [startLink]
  );
  const { rects, previewRect } = useTimelineRects(items, geometry, preview);
  const followerIds = useMemo(() => new Set(preview?.followers.map((follower) => follower.rowId) ?? []), [preview]);
  const dragLabel = useMemo(() => (preview ? dragLabelFor(preview) : undefined), [preview]);

  const handleLayoutChange = useCallback(
    (nextLayout: TimelineLayout) => {
      if (permissions.readOnly) {
        setLocalSetting((prev) =>
          prev?.viewId === viewId ? { ...prev, layout: nextLayout } : { viewId, layout: nextLayout }
        );
      } else {
        updateSetting({ layout: nextLayout });
      }
    },
    [permissions.readOnly, updateSetting, viewId]
  );
  const handleToday = useCallback(() => scrollToDate(new Date(), TIMELINE_TODAY_ANCHOR), [scrollToDate]);
  const handleStep = useCallback(
    (direction: -1 | 1) => scrollByColumns(direction * geometry.preset.stepColumns),
    [geometry.preset.stepColumns, scrollByColumns]
  );
  const handleScrollToX = useCallback((x: number) => scrollToX(x, TIMELINE_TODAY_ANCHOR), [scrollToX]);
  const toggleSidebar = useCallback(() => {
    if (permissions.readOnly) {
      setLocalSetting((prev) =>
        prev?.viewId === viewId ? { ...prev, showTable: !showSidebar } : { viewId, showTable: !showSidebar }
      );
    } else {
      updateSetting({ showTable: !showSidebar });
    }
  }, [permissions.readOnly, showSidebar, updateSetting, viewId]);
  const handleNewRow = useCallback(() => {
    void newRow({ tailing: true, openAfterCreate: true }).catch(() => undefined);
  }, [newRow]);

  // Grouped views create rows from their group footers instead of one global footer.
  const showNewRowFooter = !permissions.readOnly && !grouping.isGrouped;
  const footerRows = (showNewRowFooter ? 1 : 0) + (showSidebar ? 1 : 0);
  const bodyHeight = virtualizer.getTotalSize() + footerRows * TIMELINE_ROW_HEIGHT + TIMELINE_BOTTOM_PADDING;
  const virtualItems = virtualizer.getVirtualItems();
  const firstVisibleIndex = virtualItems[0]?.index ?? 0;
  const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  return (
    <TimelineTableProvider contentWidth={tableContentWidth} viewportWidth={sidebarWidth}>
      <div
        className={cn(
          'mx-24 flex flex-col max-sm:!mx-6',
          fixedViewport ? 'h-full min-h-0' : '',
          dragging && 'select-none'
        )}
        // Same inline margins as the calendar: the page's gutters on desktop, or
        // whatever an embedding document block dictates.
        style={{ marginLeft: paddingStart, marginRight: paddingEnd }}
        data-testid='timeline-view'
      >
        <TimelineToolbar
          title={title}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          onToday={handleToday}
          onStep={handleStep}
          emptyEvents={emptyEvents}
        />
        <div
          ref={attachScroller}
          onScroll={handleScroll}
          className={cn('appflowy-scroller relative w-full overflow-auto', fixedViewport ? 'h-full min-h-0 flex-1' : '')}
          style={fixedViewport ? undefined : { maxHeight: '75vh' }}
        >
          <div className='relative' style={{ width: sidebarWidth + canvasWidth, minHeight: '100%' }}>
            <div className='sticky top-0 z-20 flex bg-background-primary' style={{ height: TIMELINE_HEADER_HEIGHT }}>
              <TimelineTableViewport>
                <div
                  className={cn(
                    // Grid-style header cell: the primary field name plus the table toggle.
                    'flex h-full items-center border-b border-r border-border-primary bg-background-primary',
                    showSidebar ? 'justify-between' : 'justify-center'
                  )}
                  // Line the field name up with the row titles, which sit after the
                  // 40px hover gutter when the table is editable.
                  style={{ paddingLeft: showSidebar ? (permissions.editable ? 44 : 12) : undefined }}
                >
                  {showSidebar ? (
                    <span className='min-w-0 flex-1 basis-0 truncate text-sm text-text-secondary'>
                      {primaryFieldName}
                    </span>
                  ) : null}
                  {showSidebar
                    ? tableFieldIds.map((fieldId) => (
                        <div
                          key={fieldId}
                          className='flex h-full shrink-0 items-center overflow-hidden border-l border-border-primary px-2 text-sm text-text-secondary'
                          style={{ width: TIMELINE_TABLE_COLUMN_WIDTH }}
                          data-testid={`timeline-table-header-${fieldId}`}
                        >
                          <FieldDisplay fieldId={fieldId} className='min-w-0 [&_svg]:h-4 [&_svg]:w-4' />
                        </div>
                      ))
                    : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        className={showSidebar ? 'mx-0.5 shrink-0' : undefined}
                        aria-label={t('timeline.settings.showTable', { defaultValue: 'Show table' })}
                        aria-pressed={showSidebar}
                        data-testid='timeline-toggle-table'
                        onClick={toggleSidebar}
                      >
                        {showSidebar ? (
                          <CollapseIcon aria-hidden className='h-4 w-4' />
                        ) : (
                          <ExpandIcon aria-hidden className='h-4 w-4' />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('timeline.settings.showTable', { defaultValue: 'Show table' })}</TooltipContent>
                  </Tooltip>
                </div>
              </TimelineTableViewport>
              <TimelineHeader
                mode={geometry.preset.headerMode}
                segments={segments}
                columns={columns}
                canvasWidth={canvasWidth}
                highlight={previewRect}
                stickyOffset={sidebarWidth}
              />
            </div>

            <div className='relative' style={{ height: bodyHeight }} data-testid='timeline-body'>
              {/* Blank sticky column so overlays never show through below the last table cell. */}
              <div
                aria-hidden
                className='sticky left-0 z-[1] h-full bg-background-primary'
                style={{ width: sidebarWidth }}
              />
              <TimelineGrid columns={columns} left={sidebarWidth} todayX={todayX} showToday={showToday} />

              {graph.predecessors.size > 0 || link ? (
                <TimelineArrows
                  pending={link}
                  rowIds={itemRowIds}
                  groupIds={itemGroupIds}
                  rects={rects}
                  graph={graph}
                  firstVisibleIndex={firstVisibleIndex}
                  lastVisibleIndex={lastVisibleIndex}
                  canvasWidth={canvasWidth}
                  bodyHeight={bodyHeight}
                  left={sidebarWidth}
                  svgRef={arrowsRef}
                  selectedKey={selectedLinkKey}
                />
              ) : null}
              {selectedLink && selectedLinkMeta && editorTitles ? (
                <TimelineLinkEditor
                  selection={editorSelection}
                  link={selectedLinkMeta}
                  predecessorTitle={editorTitles.predecessor}
                  successorTitle={editorTitles.successor}
                  readOnly={!permissions.editable}
                  onChange={handleLinkChange}
                  onRemove={handleLinkRemove}
                  onClose={closeLinkEditor}
                />
              ) : null}

              {virtualItems.map((virtualRow) => {
                const item = items[virtualRow.index];

                if (!item) return null;
                if (item.kind !== 'row') {
                  return (
                    <div
                      key={virtualRow.key}
                      className='absolute left-0 top-0 z-[2] w-full'
                      style={{
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                      }}
                    >
                      {item.kind === 'group' ? (
                        <TimelineGroupRow
                          group={item.group}
                          fieldId={grouping.fieldId}
                          fieldName={grouping.fieldName}
                          fieldType={grouping.fieldType}
                          groupConfigId={grouping.groupId}
                          sidebarWidth={sidebarWidth}
                          showSidebar={showSidebar}
                        />
                      ) : (
                        <TimelineGroupFooter
                          group={item.group}
                          fieldId={grouping.fieldId}
                          sidebarWidth={sidebarWidth}
                          showSidebar={showSidebar}
                        />
                      )}
                    </div>
                  );
                }

                const { row } = item;
                const isDragged = preview?.rowId === row.rowId;
                const rect = rects[virtualRow.index];
                // Booleans, not pixels, so a scroll frame only re-renders rows whose pill state flips.
                const offscreenLeft = rect !== null && !isDragged && rect.left < viewLeft;
                const offscreenRight = rect !== null && !isDragged && rect.left + rect.width > viewRight;

                return (
                  <div
                    key={virtualRow.key}
                    className={cn('absolute left-0 top-0 w-full', isDragged ? 'z-[3]' : 'z-[2]')}
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                    }}
                  >
                    <TimelineRow
                      row={row}
                      rowIndex={virtualRow.index}
                      rect={rect}
                      offscreenLeft={offscreenLeft}
                      offscreenRight={offscreenRight}
                      sidebarWidth={sidebarWidth}
                      showSidebar={showSidebar}
                      propertyFields={propertyFields}
                      editable={permissions.editable}
                      dateEditable={permissions.dateEditable}
                      selected={selectedRowId === row.rowId}
                      dragging={isDragged}
                      following={followerIds.has(row.rowId)}
                      dragLabel={isDragged ? dragLabel : undefined}
                      progress={setting.progressFieldId ? progressValues.get(row.rowId) ?? 0 : undefined}
                      progressPreview={isDragged && preview?.mode === 'progress' ? preview.progress : undefined}
                      anyDragging={dragging}
                      hoverCardBoundary={scrollerEl}
                      formatTime={formatTimeDisplay}
                      rowActions={rowActions}
                      tableFieldIds={tableFieldIds}
                      onOpen={handleOpen}
                      onSelect={setSelectedRowId}
                      onScrollTo={handleScrollToX}
                      onBarPointerDown={handleBarPointerDown}
                      onEmptyClick={handleEmptyClick}
                      onCanvasClick={handleCanvasClick}
                      onDropRow={permissions.editable && !grouping.isGrouped ? handleDropRow : undefined}
                      groupFieldId={grouping.isGrouped ? grouping.fieldId : undefined}
                      groupId={item.groupId}
                      linkable={permissions.editable}
                      linkTarget={link?.targetRowId === row.rowId}
                      onLinkPointerDown={handleLinkPointerDown}
                    />
                  </div>
                );
              })}

              {showNewRowFooter ? (
                <div
                  className='absolute left-0 z-[2] flex w-full'
                  style={{ top: virtualizer.getTotalSize(), height: TIMELINE_ROW_HEIGHT }}
                >
                  <div
                    role='button'
                    tabIndex={0}
                    // Same treatment as the grid's "+ New row" footer.
                    className={cn(
                      'sticky left-0 z-10 flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-b border-r border-border-primary bg-fill-content text-sm font-medium text-text-secondary hover:bg-fill-content-hover',
                      showSidebar ? 'px-2' : 'justify-center'
                    )}
                    style={{ width: sidebarWidth }}
                    data-testid='timeline-new-row'
                    aria-label={t('grid.row.newRow', { defaultValue: 'New row' })}
                    onClick={handleNewRow}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleNewRow();
                      }
                    }}
                  >
                    <PlusIcon aria-hidden className='h-5 w-5' />
                    {showSidebar ? t('grid.row.newRow', { defaultValue: 'New row' }) : null}
                  </div>
                </div>
              ) : null}

              {showSidebar ? (
                // Borderless like the grid: empty calculation controls appear on hover.
                <div
                  className='absolute left-0 z-[2] flex w-full'
                  style={{
                    top: virtualizer.getTotalSize() + (showNewRowFooter ? TIMELINE_ROW_HEIGHT : 0),
                    height: TIMELINE_ROW_HEIGHT,
                  }}
                  data-testid='timeline-calculations'
                >
                  <TimelineTableViewport>
                    <div className='flex h-full bg-background-primary text-sm'>
                      <div className='min-w-0 flex-1 basis-0' data-testid={`timeline-calculation-${primaryFieldId}`}>
                        {primaryFieldId ? <TimelineCalculation fieldId={primaryFieldId} /> : null}
                      </div>
                      {tableFieldIds.map((fieldId, index) => (
                        <div
                          key={fieldId}
                          className='shrink-0'
                          // The last calculation fills the unused row-control slot;
                          // earlier property columns stay aligned with their headers.
                          style={{
                            width:
                              TIMELINE_TABLE_COLUMN_WIDTH +
                              (index === tableFieldIds.length - 1 ? TIMELINE_TABLE_CONTROL_WIDTH : 0),
                          }}
                          data-testid={`timeline-calculation-${fieldId}`}
                        >
                          <TimelineCalculation fieldId={fieldId} />
                        </div>
                      ))}
                    </div>
                  </TimelineTableViewport>
                </div>
              ) : null}
              {/* Keep the table divider continuous above row and footer backgrounds. */}
              <div aria-hidden className='pointer-events-none absolute inset-0 z-[3]'>
                <div className='sticky left-0 h-full border-r border-border-primary' style={{ width: sidebarWidth }} />
              </div>
            </div>
          </div>
        </div>
        <TimelineTableViewport scrollbar />
      </div>
    </TimelineTableProvider>
  );
}

export default TimelineView;
