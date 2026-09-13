import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  Column,
  FieldType,
  FieldVisibility,
  useCellSelector,
  useDatabaseContext,
  useDatabaseView,
  useFieldsSelector,
} from '@/application/database-yjs';
import {
  useNewRowDispatch,
  useNewPropertyDispatch,
  useReorderRowDispatch,
  useToggleDatabaseGroupCollapsedDispatch,
} from '@/application/database-yjs/dispatch';
import { useTimelineSettings, useUpdateTimelineSettings } from '@/application/database-yjs/timeline-layout';
import { YjsDatabaseKey } from '@/application/types';
import { Cell } from '@/components/database/components/cell/Cell';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { FieldDisplay } from '@/components/database/components/field';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { addDays, startOfDay, TIMELINE_SCALES, TimelineRange, TimelineScale } from './timeline.geometry';
import TimelineCanvas, { TimelineEntry } from './TimelineCanvas';
import { useTimelineGrouping } from './TimelineGroupingContext';
import { TimelineRecord, useCommitTimelineRange, useTimelineRows } from './useTimelineRows';

const ALL_VISIBILITIES = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty, FieldVisibility.AlwaysHidden];
const PROPERTY_WIDTH = 148;
const CELL_STYLE = { minHeight: 24, maxHeight: 32, minWidth: 0, fontSize: 12, overflow: 'hidden' };

const PropertyCell = memo(function PropertyCell({
  fieldId,
  rowId,
  readOnly,
  placement = 'table',
}: {
  fieldId: string;
  rowId: string;
  readOnly: boolean;
  placement?: 'table' | 'bar';
}) {
  const cell = useCellSelector({ rowId, fieldId });
  const [editing, setEditing] = useState(false);

  return (
    <div
      data-testid={`timeline-${placement}-cell-${rowId}-${fieldId}`}
      className='flex min-w-0 items-center overflow-hidden px-2'
      style={{ width: PROPERTY_WIDTH, flexShrink: 0 }}
      onClick={() => {
        if (!readOnly) setEditing(true);
      }}
    >
      <Cell
        rowId={rowId}
        fieldId={fieldId}
        cell={cell || undefined}
        readOnly={readOnly}
        editing={!readOnly && editing}
        setEditing={setEditing}
        style={CELL_STYLE}
        wrap={false}
      />
    </div>
  );
});

const TableRow = memo(function TableRow({
  record,
  primaryWidth,
  properties,
  readOnly,
  reorderable,
  scope,
  onMove,
}: {
  record: TimelineRecord;
  primaryWidth: number;
  properties: Column[];
  readOnly: boolean;
  reorderable: boolean;
  scope: string;
  onMove: (source: string, target: string, after: boolean) => void;
}) {
  const { t } = useTranslation();
  const { bindRowSync, navigateToRow } = useDatabaseContext();
  const elementRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const [edge, setEdge] = useState<'top' | 'bottom'>();

  useEffect(() => {
    bindRowSync?.(record.id);
  }, [bindRowSync, record.id]);
  useEffect(() => {
    const element = elementRef.current;
    const handle = handleRef.current;

    if (!reorderable || readOnly || !element || !handle) return;
    return combine(
      draggable({
        element,
        dragHandle: handle,
        getInitialData: () => ({ type: 'timeline-row', rowId: record.id, scope }),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source.data.type === 'timeline-row' && source.data.scope === scope && source.data.rowId !== record.id,
        onDrag: ({ location }) =>
          setEdge(location.current.input.clientY < element.getBoundingClientRect().top + 20 ? 'top' : 'bottom'),
        onDragLeave: () => setEdge(undefined),
        onDrop: ({ source, location }) => {
          setEdge(undefined);
          if (typeof source.data.rowId === 'string')
            onMove(
              source.data.rowId,
              record.id,
              location.current.input.clientY >= element.getBoundingClientRect().top + 20
            );
        },
      })
    );
  }, [onMove, readOnly, record.id, reorderable, scope]);

  return (
    <div
      ref={elementRef}
      className={cn(
        'group/timeline-table-row relative flex h-full items-center',
        edge && 'border-fill-theme-thick',
        edge === 'top' && 'border-t-2',
        edge === 'bottom' && 'border-b-2'
      )}
    >
      <div className='flex h-full shrink-0 items-center' style={{ width: primaryWidth }}>
        {!readOnly && reorderable ? (
          <button
            ref={handleRef}
            type='button'
            aria-label={t('timeline.reorderRow', { title: record.title })}
            className='h-full w-7 shrink-0 cursor-grab text-icon-tertiary opacity-0 focus:opacity-100 group-hover/timeline-table-row:opacity-100'
          >
            ⠿
          </button>
        ) : (
          <span className='w-3 shrink-0' />
        )}
        <button
          className='min-w-0 flex-1 truncate rounded-200 px-1.5 py-1 text-left text-sm text-text-primary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
          type='button'
          onClick={() => navigateToRow?.(record.id)}
        >
          {record.loaded ? record.title || t('grid.row.titlePlaceholder') : t('grid.row.loading', 'Loading row')}
        </button>
      </div>
      {properties.map((field) => (
        <PropertyCell key={field.fieldId} fieldId={field.fieldId} rowId={record.id} readOnly={readOnly} />
      ))}
    </div>
  );
});

export default function Timeline() {
  const { t, i18n } = useTranslation();
  const {
    activeViewId,
    bindRowSync,
    readOnly,
    canWrite,
    navigateToRow,
    onRendered,
    isDocumentBlock,
    embeddedHeight,
    paddingStart = 0,
    paddingEnd = 0,
  } = useDatabaseContext();
  const view = useDatabaseView();
  const settings = useTimelineSettings();
  const updateSettings = useUpdateTimelineSettings();
  const grouping = useTimelineGrouping();
  const fields = useFieldsSelector(ALL_VISIBILITIES);
  const primary = fields.find((field) => field.isPrimary);
  const records = useTimelineRows(grouping.rowOrders, primary?.fieldId ?? '', settings);
  const { query } = useDatabaseSearch();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingIds = useMemo(
    () =>
      new Set(
        Array.from(records.values())
          .filter((record) => !normalizedQuery || record.searchText?.includes(normalizedQuery))
          .map((record) => record.id)
      ),
    [normalizedQuery, records]
  );
  const commit = useCommitTimelineRange(settings);
  const createRow = useNewRowDispatch();
  const createProperty = useNewPropertyDispatch();
  const reorderRow = useReorderRowDispatch();
  const toggleGroup = useToggleDatabaseGroupCollapsedDispatch(grouping.groupId);
  const [anchor, setAnchor] = useState({ time: Date.now(), revision: 0 });
  const [visibleDate, setVisibleDate] = useState(anchor.time);
  const [creating, setCreating] = useState(false);
  const [localScale, setLocalScale] = useState<TimelineScale>();
  const [localCollapsed, setLocalCollapsed] = useState<Record<string, boolean>>({});
  const scale = localScale ?? settings.scale;
  const [unscheduledSearch, setUnscheduledSearch] = useState('');
  const [primaryWidth, setPrimaryWidth] = useState(settings.tableWidth);
  const resizeOrigin = useRef<{ x: number; width: number }>();
  const disabled = readOnly || canWrite === false;
  const validDateField = fields.some(
    (field) =>
      field.fieldId === settings.fieldId &&
      [FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime].includes(field.fieldType as FieldType)
  );
  const writableDates =
    !disabled &&
    validDateField &&
    [settings.fieldId, settings.endFieldId]
      .filter(Boolean)
      .every((id) => fields.some((field) => field.fieldId === id && field.fieldType === FieldType.DateTime));
  const tableProperties = useMemo(
    () =>
      settings.tableFieldIds
        .map((id) => fields.find((field) => field.fieldId === id && !field.isPrimary))
        .filter((field): field is Column => Boolean(field)),
    [fields, settings.tableFieldIds]
  );
  const barProperties = useMemo(
    () => settings.barFieldIds.filter((id) => fields.some((field) => field.fieldId === id && !field.isPrimary)),
    [fields, settings.barFieldIds]
  );
  const noDate = useMemo(
    () => Array.from(records.values()).filter((record) => record.loaded && !record.range && matchingIds.has(record.id)),
    [matchingIds, records]
  );
  const filteredNoDate = useMemo(
    () => noDate.filter((record) => record.title.toLocaleLowerCase().includes(unscheduledSearch.toLocaleLowerCase())),
    [noDate, unscheduledSearch]
  );
  const [noDateLimit, setNoDateLimit] = useState(40);
  const entries = useMemo(() => {
    const result: TimelineEntry[] = [];
    const append = (ids: { id: string }[]) =>
      ids.forEach(({ id }) => {
        const record = records.get(id);

        if (record && matchingIds.has(id)) result.push({ id, kind: 'row', record });
      });

    if (grouping.isGrouped) {
      grouping.visibleGroups.forEach((group) => {
        const rows = group.rows.filter((row) => matchingIds.has(row.id));

        if (normalizedQuery && rows.length === 0) return;
        const collapsed = disabled ? localCollapsed[`${activeViewId}:${group.id}`] ?? group.collapsed : group.collapsed;

        result.push({
          id: group.id,
          kind: 'group',
          label: group.label,
          count: rows.length,
          collapsed,
        });
        if (!collapsed) append(rows);
      });
    } else append(grouping.rowOrders ?? []);
    return result;
  }, [
    activeViewId,
    disabled,
    grouping.isGrouped,
    grouping.rowOrders,
    grouping.visibleGroups,
    localCollapsed,
    matchingIds,
    normalizedQuery,
    records,
  ]);

  useEffect(() => {
    onRendered?.();
  }, [onRendered]);
  useEffect(() => setPrimaryWidth(settings.tableWidth), [settings.tableWidth]);
  const onRowsVisible = useCallback(
    (ids: string[]) => {
      ids.forEach((id) => bindRowSync?.(id));
    },
    [bindRowSync]
  );
  const goTo = useCallback((time: number) => setAnchor((current) => ({ time, revision: current.revision + 1 })), []);
  const onChange = useCallback(
    (id: string, before: TimelineRange | undefined, next: TimelineRange) => {
      void commit(id, before, next).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : t('timeline.saveFailed'))
      );
    },
    [commit, t]
  );
  const onOpen = useCallback((id: string) => navigateToRow?.(id), [navigateToRow]);
  const onMove = useCallback(
    (source: string, target: string, after: boolean) => {
      if (disabled || grouping.isGrouped || view?.get(YjsDatabaseKey.sorts)?.length) return;
      const remaining = (grouping.rowOrders ?? []).filter((row) => row.id !== source);
      const index = remaining.findIndex((row) => row.id === target);

      if (index < 0) return;
      reorderRow(source, after ? target : remaining[index - 1]?.id);
    },
    [disabled, grouping.isGrouped, grouping.rowOrders, reorderRow, view]
  );
  const renderTable = useCallback(
    (record: TimelineRecord) => (
      <TableRow
        record={record}
        primaryWidth={primaryWidth}
        properties={tableProperties}
        readOnly={disabled}
        reorderable={!grouping.isGrouped && !view?.get(YjsDatabaseKey.sorts)?.length}
        scope={activeViewId}
        onMove={onMove}
      />
    ),
    [activeViewId, disabled, grouping.isGrouped, onMove, primaryWidth, tableProperties, view]
  );
  const renderBarProperties = useCallback(
    (record: TimelineRecord) => (
      <>
        {barProperties.map((fieldId) => (
          <PropertyCell key={fieldId} fieldId={fieldId} rowId={record.id} readOnly placement='bar' />
        ))}
      </>
    ),
    [barProperties]
  );
  const navigatePeriod = (direction: number) => {
    const date = new Date(visibleDate);

    if (scale === 'year') date.setFullYear(date.getFullYear() + direction);
    else if (scale === 'month' || scale === 'quarter') {
      date.setDate(1);
      date.setMonth(date.getMonth() + direction * (scale === 'quarter' ? 3 : 1));
    } else date.setDate(date.getDate() + direction * (scale === 'week' ? 7 : scale === 'biweek' ? 14 : 1));
    goTo(date.getTime());
  };

  const changeScale = (nextScale: TimelineScale) => {
    goTo(visibleDate);
    if (disabled) setLocalScale(nextScale);
    else updateSettings({ scale: nextScale });
  };

  const addRow = async () => {
    if (creating || disabled) return;
    setCreating(true);
    try {
      const start = startOfDay(visibleDate);
      const end = addDays(start, 2);
      const cellsData = writableDates
        ? {
            [settings.fieldId]: {
              data: String(start / 1000),
              endTimestamp: settings.endFieldId ? undefined : String(end / 1000),
              isRange: !settings.endFieldId,
              includeTime: false,
            },
            ...(settings.endFieldId
              ? { [settings.endFieldId]: { data: String(end / 1000), isRange: false, includeTime: false } }
              : {}),
          }
        : undefined;

      await createRow({ tailing: true, cellsData, openAfterCreate: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('timeline.saveFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className='flex min-h-0 w-full flex-1 flex-col text-text-primary'
      data-testid='database-timeline'
      style={{
        paddingLeft: paddingStart,
        paddingRight: paddingEnd,
        ...(isDocumentBlock && embeddedHeight === undefined ? { height: 540, flex: 'none' } : { minHeight: 240 }),
      }}
    >
      <div className='flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-1.5'>
        <div className='flex items-center gap-1'>
          <Button variant='ghost' size='sm' onClick={() => goTo(Date.now())}>
            {t('timeline.today')}
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            aria-label={t('timeline.previous')}
            onClick={() => navigatePeriod(-1)}
          >
            ‹
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            aria-label={t('timeline.next')}
            onClick={() => navigatePeriod(1)}
          >
            ›
          </Button>
          <span className='ml-1 text-sm font-medium' data-testid='timeline-visible-period'>
            {new Date(visibleDate).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className='flex items-center gap-1'>
          {noDate.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant='ghost' size='sm' data-testid='timeline-no-date-button'>
                  {t('timeline.noDate')} <span className='ml-1 text-text-tertiary'>{noDate.length}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align='end' className='w-80 p-2'>
                <input
                  type='search'
                  aria-label={t('timeline.searchUnscheduled')}
                  placeholder={t('timeline.searchUnscheduled')}
                  value={unscheduledSearch}
                  onChange={(event) => {
                    setUnscheduledSearch(event.target.value);
                    setNoDateLimit(40);
                  }}
                  className='mb-2 h-8 w-full rounded-200 border border-border-primary bg-surface-primary px-2 text-sm'
                />
                <div className='max-h-72 overflow-y-auto'>
                  {filteredNoDate.slice(0, noDateLimit).map((record) => (
                    <div key={record.id} className='flex items-center gap-2 rounded-200 p-1 hover:bg-fill-content-hover'>
                      <button
                        type='button'
                        className='min-w-0 flex-1 truncate text-left text-sm'
                        onClick={() => onOpen(record.id)}
                      >
                        {record.title || t('grid.row.titlePlaceholder')}
                      </button>
                      {writableDates && !record.invalid && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() =>
                            onChange(record.id, undefined, {
                              start: startOfDay(visibleDate),
                              end: addDays(startOfDay(visibleDate), 2),
                              includeTime: false,
                            })
                          }
                        >
                          {t('timeline.schedule')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {filteredNoDate.length > noDateLimit && (
                  <Button variant='ghost' className='w-full' onClick={() => setNoDateLimit((count) => count + 40)}>
                    {t('timeline.loadMore')}
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='sm' data-testid='timeline-scale-button'>
                {t(`timeline.scales.${scale}`)} <span className='ml-2'>⌄</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {TIMELINE_SCALES.map((option) => (
                <DropdownMenuItem key={option} onSelect={() => changeScale(option)}>
                  {t(`timeline.scales.${option}`)}
                  {option === scale && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {!disabled && (
            <Button
              variant='ghost'
              size='sm'
              aria-pressed={settings.showTable}
              onClick={() => updateSettings({ showTable: !settings.showTable })}
            >
              {t('timeline.table')}
            </Button>
          )}
          {!disabled && (
            <Button size='sm' loading={creating} onClick={() => void addRow()} data-testid='timeline-new-row'>
              {t('timeline.new')}
            </Button>
          )}
        </div>
      </div>
      {!validDateField ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-3 py-16'>
          <p className='text-sm text-text-secondary'>{t('timeline.chooseDate')}</p>
          {!disabled && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline'>{t('timeline.dateProperty')}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {fields
                  .filter((field) =>
                    [FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime].includes(
                      field.fieldType as FieldType
                    )
                  )
                  .map((field) => (
                    <DropdownMenuItem
                      key={field.fieldId}
                      onSelect={() => updateSettings({ fieldId: field.fieldId, endFieldId: '' })}
                    >
                      <FieldDisplay fieldId={field.fieldId} />
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuItem
                  onSelect={() => {
                    const fieldId = createProperty(FieldType.DateTime);

                    updateSettings({ fieldId, endFieldId: '' });
                  }}
                >
                  {t('timeline.addDateProperty')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ) : (
        <TimelineCanvas
          interactionKey={`${settings.fieldId}:${settings.endFieldId}`}
          entries={entries}
          anchor={anchor}
          scale={scale}
          locale={i18n.language}
          tableWidth={settings.showTable ? primaryWidth + tableProperties.length * PROPERTY_WIDTH : 0}
          tableHeader={
            <>
              <div className='relative flex shrink-0 items-center px-3' style={{ width: primaryWidth }}>
                <span className='truncate'>{primary?.fieldName || t('timeline.name')}</span>
                {!disabled && (
                  <button
                    type='button'
                    role='separator'
                    aria-label={t('timeline.resizeTable')}
                    aria-orientation='vertical'
                    aria-valuemin={180}
                    aria-valuemax={640}
                    aria-valuenow={primaryWidth}
                    className='absolute -bottom-2 right-0 top-[-20px] w-1.5 cursor-col-resize hover:bg-fill-theme-thick'
                    style={{ touchAction: 'none' }}
                    onKeyDown={(event) => {
                      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                        event.preventDefault();
                        updateSettings({
                          tableWidth: Math.max(
                            180,
                            Math.min(640, primaryWidth + (event.key === 'ArrowRight' ? 20 : -20))
                          ),
                        });
                      }
                    }}
                    onPointerDown={(event) => {
                      resizeOrigin.current = { x: event.clientX, width: primaryWidth };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (resizeOrigin.current)
                        setPrimaryWidth(
                          Math.max(
                            180,
                            Math.min(640, resizeOrigin.current.width + event.clientX - resizeOrigin.current.x)
                          )
                        );
                    }}
                    onPointerUp={(event) => {
                      resizeOrigin.current = undefined;
                      event.currentTarget.releasePointerCapture(event.pointerId);
                      updateSettings({ tableWidth: primaryWidth });
                    }}
                    onPointerCancel={() => {
                      resizeOrigin.current = undefined;
                      setPrimaryWidth(settings.tableWidth);
                    }}
                  />
                )}
              </div>
              {tableProperties.map((field) => (
                <div className='shrink-0 truncate px-2' key={field.fieldId} style={{ width: PROPERTY_WIDTH }}>
                  <FieldDisplay fieldId={field.fieldId} />
                </div>
              ))}
            </>
          }
          readOnly={!writableDates}
          renderTable={renderTable}
          renderBarProperties={renderBarProperties}
          onOpen={onOpen}
          onChange={onChange}
          onToggleGroup={(id) => {
            const stored = Boolean(grouping.visibleGroups.find((group) => group.id === id)?.collapsed);

            if (disabled)
              setLocalCollapsed((current) => ({
                ...current,
                [`${activeViewId}:${id}`]: !(current[`${activeViewId}:${id}`] ?? stored),
              }));
            else toggleGroup(id, !stored);
          }}
          onRowsVisible={onRowsVisible}
          onVisibleDate={setVisibleDate}
          onNavigate={goTo}
        />
      )}
    </div>
  );
}
