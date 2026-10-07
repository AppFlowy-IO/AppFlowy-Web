/**
 * Budget of the row-height drag (W10; the drag rule shared with desktop): the
 * boxes follow the pointer at each 20px step through their own `height`, no
 * element of the row carries the old inherited `--dashboard-row-height`, the
 * content keeps its height from before the drag (clipped by the box) until it
 * takes the new one in one step, and the nested database renders 0 times
 * before pointer up and once after (a frame after it: the commit's own frame
 * lays out nothing).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';

import { DashboardRow as DashboardRowData } from '@/application/database-yjs/dashboard.type';

import { DashboardRow } from '../DashboardRow';

import { createWidgetHost, DashboardWidgetProviders, TEST_WIDGET } from './dashboardTestHarness';

/** The `embeddedHeight` of every render of the nested database. */
const mockDatabaseRenders: number[] = [];

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@/application/services/domains/view', () => ({
  getWorkspaceDatabaseCatalog: () => Promise.resolve([]),
}));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
jest.mock('@/components/database', () => ({
  Database: ({ embeddedHeight }: { embeddedHeight?: number }) => {
    mockDatabaseRenders.push(embeddedHeight ?? -1);
    return <div data-testid='widget-surface' />;
  },
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useViewMeta', () => ({
  useViewMeta: () => ({ viewMeta: null }),
}));
jest.mock('../hooks/useDashboardDnd', () => ({
  useDraggableWidget: () => undefined,
  useWidgetDropTarget: () => null,
  useRowGapDropTarget: () => false,
}));
jest.mock('../WidgetHeader', () => ({ WidgetHeaderFrame: () => null }));

const ROW_HEIGHT_PROPERTY = '--dashboard-row-height';
/** The header band (40) and the bottom padding (6) of a box with titles. */
const CHROME = 46;
/** The box's bottom padding: its content (header and card) is the rest of the box. */
const BOX_PADDING = 6;
const ROW: DashboardRowData = { id: 'r1', height: 360, widgets: [TEST_WIDGET] };

// jsdom has no PointerEvent; a MouseEvent named after it carries the coordinates.
function pointer(type: string, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });

  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function Harness() {
  const [host] = useState(() => createWidgetHost());
  const [rows, setRows] = useState([ROW]);
  const rowsRef = useRef(rows);

  rowsRef.current = rows;
  const [ui] = useState(() => ({
    getRows: () => rowsRef.current,
    updateRows: (update: (current: DashboardRowData[]) => DashboardRowData[]) => {
      setRows(update);
      return true;
    },
  }));

  return (
    <DashboardWidgetProviders editing host={host} ui={ui}>
      <DashboardRow
        addToRow='enabled'
        canEdit
        canMoveDown={false}
        canMoveUp={false}
        isEditing
        minColumns={1}
        pendingSpec={null}
        pendingWidgetId={null}
        row={rows[0]}
        rowIndex={0}
        showIconsInHeading={false}
        showWidgetTitles
        wrapColumns={1}
      />
    </DashboardWidgetProviders>
  );
}

const box = () => screen.getByTestId('dashboard-widget');
const content = () => box().firstElementChild as HTMLElement;
const handle = () => screen.getByTestId('dashboard-height-handle');
const move = (clientY: number) =>
  act(() => {
    document.dispatchEvent(pointer('pointermove', clientY));
  });

/** Every element of the row (the band, the track, the boxes and their content) that sets the old property. */
function elementsWithRowHeightProperty() {
  const row = screen.getByTestId('dashboard-row');

  return [row, ...Array.from(row.querySelectorAll<HTMLElement>('*'))].filter(
    (element) => element.style?.getPropertyValue(ROW_HEIGHT_PROPERTY) !== ''
  );
}

/** The content takes a committed height on a later animation frame. */
const nextFrames = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

function renderSettled() {
  render(<Harness />);
  expect(screen.getByTestId('widget-surface')).toBeTruthy();
  expect(mockDatabaseRenders.at(-1)).toBe(360 - CHROME);
  mockDatabaseRenders.length = 0;
}

afterEach(() => {
  mockDatabaseRenders.length = 0;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

describe('DashboardRow height drag budget', () => {
  it('moves the boxes at each step, renders the nested database 0 times before pointer up and once after', async () => {
    renderSettled();
    expect(box().style.height).toBe('360px');
    expect(elementsWithRowHeightProperty()).toEqual([]);

    fireEvent(handle(), pointer('pointerdown', 100));
    move(220);
    expect(box().style.height).toBe('480px');
    move(260);
    move(280);
    expect(box().style.height).toBe('540px');
    // The content keeps its height from before the drag, top-aligned; the box clips it.
    expect(content().style.height).toBe(`${360 - BOX_PADDING}px`);
    expect(content().dataset.contentHeld).toBe('true');
    expect(box().style.overflow).toBe('clip');
    expect(elementsWithRowHeightProperty()).toEqual([]);
    expect(mockDatabaseRenders).toEqual([]);

    act(() => {
      document.dispatchEvent(pointer('pointerup'));
    });
    // The box has its height at once; the content stays held, clipped, until its later frame.
    expect(box().style.height).toBe('540px');
    expect(content().style.height).toBe(`${360 - BOX_PADDING}px`);
    expect(content().dataset.contentHeld).toBe('true');
    expect(box().style.overflow).toBe('clip');
    expect(mockDatabaseRenders).toEqual([]);

    await nextFrames();
    // Then it takes the new height in one step: released and rendered once.
    expect(mockDatabaseRenders).toEqual([540 - CHROME]);
    expect(content().style.height).toBe('');
    expect(content().dataset.contentHeld).toBeUndefined();
    expect(box().style.overflow).toBe('');
    expect(elementsWithRowHeightProperty()).toEqual([]);
  });

  it('keeps the content when the box shrinks below it, and gives it the smaller height on pointer up', async () => {
    renderSettled();

    fireEvent(handle(), pointer('pointerdown', 300));
    move(240);
    expect(box().style.height).toBe('300px');
    expect(content().style.height).toBe(`${360 - BOX_PADDING}px`);
    expect(content().style.flexShrink).toBe('0');
    expect(mockDatabaseRenders).toEqual([]);

    act(() => {
      document.dispatchEvent(pointer('pointerup'));
    });
    // Still clipped by the smaller box until its frame: the old height never spills out of it.
    expect(content().style.height).toBe(`${360 - BOX_PADDING}px`);
    expect(box().style.overflow).toBe('clip');
    expect(mockDatabaseRenders).toEqual([]);
    await nextFrames();
    expect(mockDatabaseRenders).toEqual([300 - CHROME]);
    expect(content().style.height).toBe('');
    expect(box().style.overflow).toBe('');
  });

  it('renders nothing for a cancelled drag and puts the height back', async () => {
    renderSettled();

    fireEvent(handle(), pointer('pointerdown', 100));
    move(220);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(box().style.height).toBe('360px');
    expect(content().style.height).toBe('');
    await nextFrames();
    expect(mockDatabaseRenders).toEqual([]);
  });

  it('gives the content a keyboard step with one render', async () => {
    renderSettled();

    act(() => void fireEvent.keyDown(handle(), { key: 'ArrowDown' }));
    expect(box().style.height).toBe('380px');
    expect(content().style.height).toBe(`${360 - BOX_PADDING}px`);
    expect(mockDatabaseRenders).toEqual([]);
    await nextFrames();
    expect(mockDatabaseRenders).toEqual([380 - CHROME]);
    expect(content().style.height).toBe('');
    expect(elementsWithRowHeightProperty()).toEqual([]);
  });
});
