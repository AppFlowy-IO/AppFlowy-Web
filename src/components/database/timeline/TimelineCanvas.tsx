import {
  CSSProperties,
  memo,
  PointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import {
  addDays,
  createTicks,
  PIXELS_PER_DAY,
  rangeGeometry,
  shiftRange,
  startOfDay,
  TIMELINE_CANVAS_WIDTH,
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_ROW_HEIGHT,
  TimelineDragMode,
  TimelineRange,
  TimelineScale,
  timeToUnit,
  unitToTime,
} from './timeline.geometry';
import { TimelineRecord } from './useTimelineRows';

export type TimelineEntry =
  | { id: string; kind: 'row'; record: TimelineRecord }
  | { id: string; kind: 'group'; label: string; count: number; collapsed: boolean };

interface Props {
  entries: TimelineEntry[];
  interactionKey: string;
  scale: TimelineScale;
  anchor: { time: number; revision: number };
  locale: string;
  tableWidth: number;
  tableHeader: ReactNode;
  readOnly: boolean;
  renderTable: (record: TimelineRecord) => ReactNode;
  renderBarProperties: (record: TimelineRecord) => ReactNode;
  onOpen: (id: string) => void;
  onChange: (id: string, before: TimelineRange | undefined, next: TimelineRange) => void;
  onToggleGroup: (id: string) => void;
  onVisibleDate: (time: number) => void;
  onNavigate: (time: number) => void;
  onRowsVisible?: (ids: string[]) => void;
}

const Bar = memo(function Bar({
  record,
  range,
  origin,
  scale,
  viewportLeft,
  readOnly,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onOpen,
  onKeyboardChange,
  children,
}: {
  record: TimelineRecord;
  range: TimelineRange;
  origin: number;
  scale: TimelineScale;
  readOnly: boolean;
  viewportLeft: number;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, mode: TimelineDragMode) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onOpen: () => void;
  onKeyboardChange: (mode: TimelineDragMode, direction: number) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const geometry = rangeGeometry(range, origin, scale);
  const title = record.title || t('grid.row.titlePlaceholder');
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(
        undefined,
        range.includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }
      ),
    [range.includeTime]
  );
  const label = `${title}: ${formatter.format(range.start)}${
    range.end === undefined ? '' : ` – ${formatter.format(range.end)}`
  }`;
  const handlers = { onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel };

  return (
    <div
      className='timeline-bar group/bar absolute top-1.5 flex h-7 items-center rounded-200 border border-transparent text-sm shadow-sm hover:border-border-theme-thick'
      style={{ ...geometry, background: 'var(--other-colors-filled-event)', color: 'var(--other-colors-text-event)' }}
      data-testid={`timeline-bar-${record.id}`}
    >
      <button
        {...handlers}
        aria-label={label}
        className={cn(
          'absolute inset-0 z-[1] rounded-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick',
          !readOnly && 'cursor-grab active:cursor-grabbing'
        )}
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(event) => onPointerDown(event, 'move')}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (!readOnly && event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            onKeyboardChange(event.shiftKey ? 'end' : 'move', event.key === 'ArrowRight' ? 1 : -1);
          }
        }}
        title={label}
        type='button'
      />
      <div
        className='pointer-events-none flex min-w-0 items-center gap-2 overflow-hidden px-3'
        style={{ marginLeft: Math.min(Math.max(0, viewportLeft - geometry.left), Math.max(0, geometry.width - 40)) }}
      >
        <span className='truncate font-medium'>{title}</span>
        {children}
      </div>
      {!readOnly &&
        (['start', 'end'] as const).map((mode) => (
          <button
            {...handlers}
            key={mode}
            aria-label={t(mode === 'start' ? 'timeline.resizeStart' : 'timeline.resizeEnd', { title })}
            className={cn(
              'absolute inset-y-0 z-[2] w-2 cursor-ew-resize rounded-200 opacity-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick group-hover/bar:opacity-100',
              mode === 'start' ? 'left-0' : 'right-0'
            )}
            style={{ touchAction: 'none' }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onPointerDown(event, mode);
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                onKeyboardChange(mode, event.key === 'ArrowRight' ? 1 : -1);
              }
            }}
            type='button'
          >
            <span className='mx-auto block h-3 w-px bg-current' />
          </button>
        ))}
    </div>
  );
});

export default function TimelineCanvas({
  entries,
  interactionKey,
  scale,
  anchor,
  locale,
  tableWidth,
  tableHeader,
  readOnly,
  renderTable,
  renderBarProperties,
  onOpen,
  onChange,
  onToggleGroup,
  onVisibleDate,
  onNavigate,
  onRowsVisible,
}: Props) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState(() => timeToUnit(startOfDay(anchor.time), scale) - 4000 / PIXELS_PER_DAY[scale]);
  const [scroll, setScroll] = useState({ top: 0, left: 4000, height: 600, width: 1000 });
  const [preview, setPreview] = useState<{ id: string; range: TimelineRange }>();
  const gesture = useRef<{
    id: string;
    before: TimelineRange;
    mode: TimelineDragMode;
    startX: number;
    clientX: number;
    scrollLeft: number;
    moved: boolean;
    element: HTMLButtonElement;
    pointerId: number;
  }>();
  const ignoreClick = useRef(false);
  const dragFrame = useRef<number>();
  const scrollFrame = useRef<number>();
  const pendingScroll = useRef<number>();
  const originRef = useRef(origin);

  originRef.current = origin;
  const refreshScroll = useCallback(() => {
    const element = viewport.current;

    if (element)
      setScroll({
        top: element.scrollTop,
        left: element.scrollLeft,
        height: element.clientHeight,
        width: element.clientWidth,
      });
  }, []);

  useLayoutEffect(() => {
    const next = timeToUnit(startOfDay(anchor.time), scale) - 4000 / PIXELS_PER_DAY[scale];

    setOrigin(next);
    if (viewport.current) viewport.current.scrollLeft = 4000;
    refreshScroll();
  }, [anchor, refreshScroll, scale]);

  useLayoutEffect(() => {
    if (pendingScroll.current !== undefined && viewport.current) {
      viewport.current.scrollLeft = pendingScroll.current;
      pendingScroll.current = undefined;
      refreshScroll();
    }
  }, [origin, refreshScroll]);

  useEffect(() => {
    const observer = new ResizeObserver(refreshScroll);

    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [refreshScroll]);

  const stopGesture = useCallback(() => {
    const active = gesture.current;

    gesture.current = undefined;
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    if (dragFrame.current !== undefined) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = undefined;
    setPreview(undefined);
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        stopGesture();
      }
    };

    document.addEventListener('keydown', onEscape, true);
    return () => {
      document.removeEventListener('keydown', onEscape, true);
      if (dragFrame.current !== undefined) cancelAnimationFrame(dragFrame.current);
      if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    };
  }, [stopGesture]);

  useLayoutEffect(() => stopGesture(), [interactionKey, scale, stopGesture]);
  useEffect(() => {
    if (readOnly) stopGesture();
  }, [readOnly, stopGesture]);
  useEffect(() => {
    if (gesture.current && !entries.some((entry) => entry.id === gesture.current?.id)) stopGesture();
  }, [entries, stopGesture]);

  const updatePreview = useCallback(() => {
    const active = gesture.current;
    const element = viewport.current;

    if (!active || !element) return;
    const delta = active.clientX - active.startX + element.scrollLeft - active.scrollLeft;

    if (Math.abs(delta) > 3) active.moved = true;
    setPreview({ id: active.id, range: shiftRange(active.before, active.mode, delta, scale) });
  }, [scale]);

  const beginGesture = (event: PointerEvent<HTMLButtonElement>, record: TimelineRecord, mode: TimelineDragMode) => {
    if (readOnly || !record.range || event.button !== 0) return;
    ignoreClick.current = false;
    gesture.current = {
      id: record.id,
      before: record.range,
      mode,
      startX: event.clientX,
      clientX: event.clientX,
      scrollLeft: viewport.current?.scrollLeft ?? 0,
      moved: false,
      element: event.currentTarget,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    const autoScroll = () => {
      const active = gesture.current;
      const element = viewport.current;

      if (!active || !element) return;
      const rect = element.getBoundingClientRect();
      const left = rect.left + tableWidth + 24;
      const right = rect.right - 24;

      if (active.moved && (active.clientX < left || active.clientX > right)) {
        element.scrollLeft += active.clientX < left ? -12 : 12;
        updatePreview();
      }

      dragFrame.current = requestAnimationFrame(autoScroll);
    };

    dragFrame.current = requestAnimationFrame(autoScroll);
  };

  const endGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;

    if (!active || event.pointerId !== active.pointerId) return;
    active.clientX = event.clientX;
    const delta = active.clientX - active.startX + (viewport.current?.scrollLeft ?? 0) - active.scrollLeft;
    const next = shiftRange(active.before, active.mode, delta, scale);

    ignoreClick.current = active.moved;
    stopGesture();
    if (!readOnly && active.moved && next !== active.before) onChange(active.id, active.before, next);
  };

  const ticks = useMemo(() => createTicks(origin, scale, locale), [locale, origin, scale]);
  const visibleDate = unitToTime(origin + scroll.left / PIXELS_PER_DAY[scale], scale);

  useEffect(() => onVisibleDate(visibleDate), [onVisibleDate, visibleDate]);
  const startIndex = Math.max(0, Math.floor((scroll.top - TIMELINE_HEADER_HEIGHT) / TIMELINE_ROW_HEIGHT) - 6);
  const endIndex = Math.min(entries.length, startIndex + Math.ceil(scroll.height / TIMELINE_ROW_HEIGHT) + 14);
  const visibleRowKey = entries
    .slice(startIndex, endIndex)
    .filter((entry) => entry.kind === 'row')
    .map((entry) => entry.id)
    .join(',');

  useEffect(() => {
    onRowsVisible?.(visibleRowKey ? visibleRowKey.split(',') : []);
  }, [onRowsVisible, visibleRowKey]);
  const rowHeight = TIMELINE_ROW_HEIGHT;
  const todayX = (timeToUnit(startOfDay(Date.now()), scale) - origin) * PIXELS_PER_DAY[scale];
  const tableStyle: CSSProperties = { width: tableWidth, flexShrink: 0, position: 'sticky', left: 0, zIndex: 10 };
  const monthFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(
        locale,
        scale === 'hour' ? { month: 'long', day: 'numeric', year: 'numeric' } : { month: 'long', year: 'numeric' }
      ),
    [locale, scale]
  );

  const periods = useMemo(() => {
    const groups: { label: string; left: number; right: number }[] = [];

    ticks.forEach((tick) => {
      const label = monthFormat.format(tick.time);
      const previous = groups[groups.length - 1];

      if (previous?.label === label) previous.right = tick.left + tick.width;
      else groups.push({ label, left: tick.left, right: tick.left + tick.width });
    });
    return groups;
  }, [monthFormat, ticks]);

  return (
    <div
      ref={viewport}
      className='appflowy-scroller relative min-h-0 w-full flex-1 overflow-auto overscroll-contain border-y border-border-primary bg-surface-primary'
      data-testid='timeline-viewport'
      onScroll={() => {
        if (scrollFrame.current !== undefined) return;
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = undefined;
          const element = viewport.current;

          if (!element) return;
          if (
            !gesture.current &&
            (element.scrollLeft < 1000 || element.scrollLeft > TIMELINE_CANVAS_WIDTH - element.clientWidth - 1000)
          ) {
            const shift = element.scrollLeft < 1000 ? -4000 : 4000;

            pendingScroll.current = element.scrollLeft - shift;
            setOrigin(originRef.current + shift / PIXELS_PER_DAY[scale]);
          }

          refreshScroll();
        });
      }}
    >
      <div
        className='sticky top-0 z-30 flex border-b border-border-primary bg-surface-primary text-xs text-text-secondary'
        style={{ width: tableWidth + TIMELINE_CANVAS_WIDTH, height: TIMELINE_HEADER_HEIGHT }}
      >
        {tableWidth > 0 && (
          <div className='flex items-end border-r border-border-primary bg-surface-primary pb-2' style={tableStyle}>
            {tableHeader}
          </div>
        )}
        <div className='relative shrink-0 overflow-hidden' style={{ width: TIMELINE_CANVAS_WIDTH }}>
          {periods.map((period) => {
            if (period.right <= scroll.left || period.left >= scroll.left + scroll.width - tableWidth) return null;
            const left = Math.max(period.left, scroll.left);

            return (
              <div
                key={`${period.label}-${period.left}`}
                className='absolute top-0 h-7 truncate px-3 py-1 font-medium text-text-primary'
                style={{ left, width: Math.max(0, period.right - left) }}
              >
                {period.label}
              </div>
            );
          })}
          {ticks.map((tick) => (
            <div
              key={tick.time}
              className={cn(
                'border-border-primary/50 absolute bottom-0 flex h-7 items-center border-l px-2',
                tick.weekend && 'bg-fill-content-hover'
              )}
              style={{ left: tick.left, width: tick.width }}
            >
              {tick.label}
            </div>
          ))}
        </div>
      </div>
      <div
        className='relative'
        style={{
          width: tableWidth + TIMELINE_CANVAS_WIDTH,
          height: Math.max(rowHeight * entries.length, scroll.height - TIMELINE_HEADER_HEIGHT - 1),
        }}
      >
        {tableWidth > 0 && (
          <div
            className='pointer-events-none sticky left-0 z-[2] h-full border-r border-border-primary bg-surface-primary'
            style={{ width: tableWidth }}
          />
        )}
        <div
          className='pointer-events-none absolute inset-y-0 overflow-hidden'
          style={{ left: tableWidth, width: TIMELINE_CANVAS_WIDTH }}
        >
          {ticks.map((tick) => (
            <div
              key={tick.time}
              className={cn(
                'border-border-primary/50 absolute inset-y-0 border-l',
                tick.weekend && 'bg-fill-content-hover/50'
              )}
              style={{ left: tick.left, width: tick.width }}
            />
          ))}
          <div
            data-testid='timeline-today-marker'
            className='absolute inset-y-0 z-[1] w-px bg-fill-theme-thick'
            style={{ left: todayX }}
          >
            <span className='absolute -left-1 top-0 h-2 w-2 rounded-full bg-fill-theme-thick' />
          </div>
        </div>
        {entries.slice(startIndex, endIndex).map((entry, offset) => (
          <div
            key={entry.id}
            className='border-border-primary/40 absolute left-0 flex border-b'
            style={{
              top: (startIndex + offset) * rowHeight,
              width: tableWidth + TIMELINE_CANVAS_WIDTH,
              height: rowHeight,
            }}
            data-testid={`timeline-row-${entry.id}`}
          >
            {entry.kind === 'group' ? (
              <button
                type='button'
                className='sticky left-0 z-20 flex h-full items-center gap-2 bg-surface-primary px-3 text-sm font-medium text-text-primary hover:bg-fill-content-hover'
                style={{ width: Math.max(tableWidth, scroll.width) }}
                onClick={() => onToggleGroup(entry.id)}
                aria-expanded={!entry.collapsed}
              >
                <span aria-hidden>{entry.collapsed ? '›' : '⌄'}</span>
                <span className='truncate'>{entry.label}</span>
                <span className='text-xs font-normal text-text-tertiary'>{entry.count}</span>
              </button>
            ) : (
              <>
                {tableWidth > 0 && (
                  <div
                    className='flex items-center border-r border-border-primary bg-surface-primary'
                    style={tableStyle}
                  >
                    {renderTable(entry.record)}
                  </div>
                )}
                <div
                  className='relative shrink-0 overflow-hidden'
                  style={{ width: TIMELINE_CANVAS_WIDTH }}
                  onDoubleClick={(event) => {
                    if (readOnly || entry.record.range || !entry.record.loaded) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const start = startOfDay(
                      unitToTime(origin + (event.clientX - rect.left) / PIXELS_PER_DAY[scale], scale)
                    );

                    onChange(entry.id, undefined, { start, end: addDays(start, 2), includeTime: false });
                  }}
                >
                  {entry.record.range ? (
                    <Bar
                      record={entry.record}
                      range={preview?.id === entry.id ? preview.range : entry.record.range}
                      origin={origin}
                      scale={scale}
                      viewportLeft={scroll.left}
                      readOnly={readOnly}
                      onPointerDown={(event, mode) => beginGesture(event, entry.record, mode)}
                      onPointerMove={(event) => {
                        if (gesture.current?.pointerId === event.pointerId) {
                          gesture.current.clientX = event.clientX;
                          updatePreview();
                        }
                      }}
                      onPointerUp={endGesture}
                      onPointerCancel={stopGesture}
                      onOpen={() => {
                        if (!ignoreClick.current) onOpen(entry.id);
                        ignoreClick.current = false;
                      }}
                      onKeyboardChange={(mode, direction) => {
                        if (entry.record.range)
                          onChange(
                            entry.id,
                            entry.record.range,
                            shiftRange(
                              entry.record.range,
                              mode,
                              direction *
                                PIXELS_PER_DAY[scale] *
                                (scale === 'hour' && entry.record.range.includeTime ? 1 / 96 : 1),
                              scale
                            )
                          );
                      }}
                    >
                      {renderBarProperties(entry.record)}
                    </Bar>
                  ) : (
                    <button
                      type='button'
                      className='sticky left-0 m-1.5 h-7 rounded-200 px-3 text-xs text-text-tertiary hover:bg-fill-content-hover'
                      style={{ marginLeft: scroll.left + 8 }}
                      onClick={() => onOpen(entry.id)}
                    >
                      {entry.record.invalid
                        ? t('timeline.invalidRange')
                        : entry.record.loaded
                        ? t('timeline.noDate')
                        : t('grid.row.loading', 'Loading row')}
                    </button>
                  )}
                  {entry.record.range &&
                    (() => {
                      const geometry = rangeGeometry(entry.record.range, origin, scale);
                      const before = geometry.left + geometry.width < scroll.left;
                      const after = geometry.left > scroll.left + scroll.width - tableWidth;

                      return (
                        (before || after) && (
                          <button
                            type='button'
                            aria-label={t('timeline.jumpToDates')}
                            className='absolute top-1.5 h-7 rounded-200 border border-border-primary bg-surface-primary px-2 text-text-secondary hover:bg-fill-content-hover'
                            style={{ left: scroll.left + (before ? 8 : Math.max(8, scroll.width - tableWidth - 42)) }}
                            onClick={() => onNavigate(entry.record.range!.start)}
                          >
                            {before ? '←' : '→'}
                          </button>
                        )
                      );
                    })()}
                </div>
              </>
            )}
          </div>
        ))}
        {entries.length === 0 && (
          <p
            className='pointer-events-none absolute top-0 z-20 py-16 text-center text-sm text-text-tertiary'
            style={{ left: scroll.left, width: scroll.width }}
          >
            {t('timeline.empty')}
          </p>
        )}
      </div>
      {preview && (
        <div className='sr-only' role='status' aria-live='polite'>
          {new Date(preview.range.start).toLocaleDateString()} –{' '}
          {new Date(preview.range.end ?? preview.range.start).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
