import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  forwardRef,
  type MutableRefObject,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  FieldType,
  FieldVisibility,
  GroupColumn,
  isAIFieldType,
  Row,
  useDatabase,
  useDatabaseContext,
  useDatabaseView,
  useFieldType,
  useReadOnly,
} from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { useAIEnabled } from '@/components/app/app.hooks';
import { BoardCardFieldsContext, CardFieldInfo } from '@/components/database/components/board/card/CardPrimitive';
import { Column } from '@/components/database/components/board/column';
import {
  CardListSizingContext,
  ColumnOnScreenContext,
  DEFAULT_CARD_LIST_SIZING,
  estimateCardHeight,
} from '@/components/database/components/board/column/CardList';
import HiddenGroupColumn from '@/components/database/components/board/column/HiddenGroupColumn';
import { BoardDragContext } from '@/components/database/components/board/drag-and-drop/board-context';
import AddGroupColumn from '@/components/database/components/board/group/AddGroupColumn';

/**
 * A widget board with more cards than this is large (W5: the employees boards
 * hold 2,000 cards). A large widget board mounts the cards of the columns near
 * its viewport only, with one card of overscan. A smaller board mounts its
 * cards as before, in every column with the usual overscan: virtualization
 * already keeps it cheap.
 */
export const LARGE_WIDGET_BOARD_CARDS = 100;

/** Cards mounted beyond each edge of a column's viewport in a large widget board (W5). */
const LARGE_WIDGET_BOARD_CARD_OVERSCAN = 1;

/** The visibilities `useFieldsSelector` lists by default, as cards read them. */
const CARD_FIELD_VISIBILITIES = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty];

const NO_CARD_FIELDS: CardFieldInfo[] = [];

/**
 * The fields of the view a card may show (shown or hidden when empty, in
 * order), as `useFieldsSelector` lists them, read from the document during
 * render: the board's cards render their fields on their first render, and
 * the board sizes them by the fields before they are measured. The list keeps
 * its identity while no field, type or visibility changes.
 */
function useBoardCardFields(): CardFieldInfo[] {
  const database = useDatabase();
  const view = useDatabaseView();
  const fields = database?.get(YjsDatabaseKey.fields);
  const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
  const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
  const snapshot = useRef<{ key: string; fields: CardFieldInfo[] }>({ key: '', fields: NO_CARD_FIELDS });

  const subscribe = useCallback(
    (onChange: () => void) => {
      fieldOrders?.observeDeep(onChange);
      fieldSettings?.observeDeep(onChange);
      fields?.observeDeep(onChange);
      return () => {
        fieldOrders?.unobserveDeep(onChange);
        fieldSettings?.unobserveDeep(onChange);
        fields?.unobserveDeep(onChange);
      };
    },
    [fieldOrders, fieldSettings, fields]
  );
  const getSnapshot = useCallback(() => {
    if (!fields || !fieldOrders) return NO_CARD_FIELDS;
    const next = (fieldOrders.toJSON() as { id: string }[])
      .map(({ id }) => ({
        fieldId: id,
        fieldType: Number(fields.get(id)?.get(YjsDatabaseKey.type)) as FieldType,
        visibility: Number(
          fieldSettings?.get(id)?.get(YjsDatabaseKey.visibility) || FieldVisibility.AlwaysShown
        ) as FieldVisibility,
      }))
      .filter(({ visibility }) => CARD_FIELD_VISIBILITIES.includes(visibility));
    const key = next.map((field) => `${field.fieldId}:${field.fieldType}:${field.visibility}`).join('|');

    if (key !== snapshot.current.key) snapshot.current = { key, fields: next };
    return snapshot.current.fields;
  }, [fieldOrders, fieldSettings, fields]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The ids of the columns that intersect the scroller's viewport, plus one column on each side. */
function readOnScreenColumnIds(scroller: HTMLElement, container: HTMLElement): Set<string> {
  const { left, right } = scroller.getBoundingClientRect();
  const columns = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-column-id]'));
  const rects = columns.map((column) => column.getBoundingClientRect());
  let first = rects.findIndex((rect) => rect.right > left && rect.left < right);
  let last = first;

  if (first === -1) {
    // The viewport shows no column (only the hidden groups or the add button):
    // the columns on each side of it count as its neighbours.
    const next = rects.findIndex((rect) => rect.left >= right);

    first = next === -1 ? columns.length : next;
    last = first - 1;
  } else {
    while (last + 1 < rects.length && rects[last + 1].left < right) last += 1;
  }

  const ids = new Set<string>();

  for (let index = Math.max(0, first - 1); index <= Math.min(columns.length - 1, last + 1); index += 1) {
    const id = columns[index].dataset.columnId;

    if (id !== undefined) ids.add(id);
  }

  return ids;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

const NO_COLUMNS: ReadonlySet<string> = new Set();

/**
 * The columns on the board's horizontal viewport and one on each side, inside
 * a dashboard widget; `null` elsewhere. Every column keeps its header and its
 * size, so the board looks and scrolls the same; the set follows the scroll,
 * so a column mounts its cards as it scrolls near, also while a card is
 * dragged towards it (auto-scroll), and the column a dragged card comes from
 * stays in the set for the whole drag.
 */
function useOnScreenColumnIds({
  enabled,
  scrollElement,
  containerRef,
  columnIdsKey,
}: {
  enabled: boolean;
  scrollElement?: HTMLElement | null;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  /** The shown columns in order: their layout changes when it changes. */
  columnIdsKey: string;
}): ReadonlySet<string> | null {
  // Before the first measurement no column mounts cards; it happens before the first paint.
  const [onScreen, setOnScreen] = useState<ReadonlySet<string>>(NO_COLUMNS);
  const [draggedFromColumnId, setDraggedFromColumnId] = useState<string | null>(null);
  const drag = useContext(BoardDragContext);
  const instanceId = drag?.instanceId;

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!enabled || !scrollElement || !container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = readOnScreenColumnIds(scrollElement, container);

      setOnScreen((current) => (sameIds(current, next) ? current : next));
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    scrollElement.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);

    observer?.observe(scrollElement);
    // The columns move without a scroll when the hidden groups open or close.
    observer?.observe(container);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      scrollElement.removeEventListener('scroll', schedule);
      observer?.disconnect();
    };
  }, [enabled, scrollElement, containerRef, columnIdsKey]);

  useEffect(() => {
    if (!enabled || instanceId === undefined) return;

    return monitorForElements({
      canMonitor: ({ source }) => source.data.instanceId === instanceId && source.data.type === 'card',
      onDragStart: ({ source }) => setDraggedFromColumnId(String(source.data.columnId)),
      onDrop: () => setDraggedFromColumnId(null),
    });
  }, [enabled, instanceId]);

  return useMemo(() => {
    if (!enabled) return null;
    if (draggedFromColumnId === null || onScreen.has(draggedFromColumnId)) return onScreen;
    return new Set([...onScreen, draggedFromColumnId]);
  }, [enabled, onScreen, draggedFromColumnId]);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as MutableRefObject<T>).current = value;
}

const Columns = forwardRef<
  HTMLDivElement,
  {
    fieldId: string;
    groupResult: Map<string, Row[]>;
    columns: GroupColumn[];
    addCardBefore: (id: string) => void;
    groupId: string;
    groupRowsReady: boolean;
    /** The board's horizontal scroller, whose viewport decides which columns mount cards. */
    scrollElement?: HTMLElement | null;
  }
>(({ columns, groupResult, fieldId, groupRowsReady, scrollElement, ...props }, ref) => {
  const fieldType = useFieldType(fieldId);
  const isSelectField = useMemo(() => {
    return [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);
  }, [fieldType]);
  const { isDashboardWidget } = useDatabaseContext();
  const isWidget = Boolean(isDashboardWidget);
  const cardFields = useBoardCardFields();
  const aiEnabled = useAIEnabled();
  // The fields a card of this board shows, as the card filters them.
  const shownFieldCount = useMemo(
    () =>
      cardFields.filter(
        (field) =>
          field.fieldId !== fieldId &&
          field.visibility !== FieldVisibility.AlwaysHidden &&
          (aiEnabled || !isAIFieldType(field.fieldType))
      ).length,
    [aiEnabled, cardFields, fieldId]
  );
  const getRows = useCallback(
    (id: string) => {
      return groupResult.get(id) || [];
    },
    [groupResult]
  );

  const columnsWithRows = useMemo(() => {
    if (!groupResult) return [];

    return columns
      .map((data) => {
        if (!groupResult.has(data.id)) {
          return null;
        }

        return {
          ...data,
          rows: groupResult.get(data.id) || [],
        };
      })
      .filter(Boolean) as (GroupColumn & { rows: Row[] })[];
  }, [columns, groupResult]);
  const shownColumnIds = useMemo(() => new Set(columnsWithRows.map((column) => column.id)), [columnsWithRows]);

  const readOnly = useReadOnly();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setContainer = useCallback(
    (element: HTMLDivElement | null) => {
      containerRef.current = element;
      assignRef(ref, element);
    },
    [ref]
  );
  const onScreenColumnIds = useOnScreenColumnIds({
    enabled: isWidget,
    scrollElement,
    containerRef,
    columnIdsKey: columnsWithRows.map((column) => column.id).join('\n'),
  });
  const cardCount = useMemo(() => columnsWithRows.reduce((count, column) => count + column.rows.length, 0), [
    columnsWithRows,
  ]);
  // The view's rows count too: they are known before its rows load and are
  // grouped, so a large board never starts as a small one, mounting cards in
  // every column it then unmounts.
  const viewRowCount = useDatabaseView()?.get(YjsDatabaseKey.row_orders)?.length ?? 0;
  const isLargeWidgetBoard = isWidget && Math.max(cardCount, viewRowCount) > LARGE_WIDGET_BOARD_CARDS;
  const cardListSizing = useMemo(
    () => ({
      estimatedCardHeight: estimateCardHeight(shownFieldCount),
      overscan: isLargeWidgetBoard ? LARGE_WIDGET_BOARD_CARD_OVERSCAN : DEFAULT_CARD_LIST_SIZING.overscan,
    }),
    [isLargeWidgetBoard, shownFieldCount]
  );
  // Which columns mount their cards: all of them, but in a large widget board
  // only those near the viewport (W5).
  const mountsCardsOf = (columnId: string) =>
    !isLargeWidgetBoard || onScreenColumnIds === null || onScreenColumnIds.has(columnId);

  return (
    <BoardCardFieldsContext.Provider value={cardFields}>
      <CardListSizingContext.Provider value={cardListSizing}>
        <div ref={setContainer} className={'columns flex h-full min-h-0 w-fit min-w-full flex-1 gap-2'}>
          {!readOnly && (
            <HiddenGroupColumn
              fieldId={fieldId}
              groupId={props.groupId}
              getRows={getRows}
              groupRowsReady={groupRowsReady}
              shownColumnIds={shownColumnIds}
            />
          )}

          {columnsWithRows.map((data) => (
            <ColumnOnScreenContext.Provider key={data.id} value={mountsCardsOf(data.id)}>
              <Column id={data.id} fieldId={fieldId} rows={data.rows} {...props} />
            </ColumnOnScreenContext.Provider>
          ))}
          {isSelectField && !readOnly && <AddGroupColumn groupId={props.groupId} fieldId={fieldId} />}
        </div>
      </CardListSizingContext.Provider>
    </BoardCardFieldsContext.Provider>
  );
});

export default Columns;
