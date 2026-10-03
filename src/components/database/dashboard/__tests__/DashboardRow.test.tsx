import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { DashboardRow as DashboardRowData } from '@/application/database-yjs/dashboard.type';
import { UIVariant } from '@/application/types';

import { DashboardRow } from '../DashboardRow';
import { DashboardHostContext, DashboardHostServices, DashboardUiContext } from '../DashboardUiContext';
import { ROW_HEIGHT_CSS_VARIABLE } from '../hooks/useRowHeightResize';
import { getHeightBandStyle, getWidthPillStyle } from '../RowResizeHandles';
import { preloadWidgetPicker } from '../WidgetPicker';

const mockGetWorkspaceDatabaseCatalog = jest.fn((_workspaceId: string) => Promise.resolve([]));

jest.mock('@/application/services/domains/view', () => ({
  getWorkspaceDatabaseCatalog: (workspaceId: string) => mockGetWorkspaceDatabaseCatalog(workspaceId),
}));

jest.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown> & { defaultValue?: string }) =>
    (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name]));

  return { useTranslation: () => ({ t }) };
});

jest.mock('../WidgetPickerContent', () => ({ __esModule: true, default: () => null }));

jest.mock('../DashboardWidget', () => ({
  DashboardWidget: ({ widget, span, lineSize }: { widget: { id: string }; span: number; lineSize: number }) => (
    <div data-line-size={lineSize} data-span={span} data-testid='dashboard-widget' data-widget-id={widget.id} />
  ),
}));

// The indicator package ships compiled CSS that jest cannot parse.
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({
  DropIndicator: () => null,
}));

// jsdom has no PointerEvent; a MouseEvent named after it carries the coordinates.
function pointer(type: string, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });

  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

const ROW: DashboardRowData = {
  id: 'r1',
  height: 360,
  widgets: [{ id: 'w0', viewId: 'v0', databaseId: 'db', width: 12 }],
};

const TWO_UP: DashboardRowData = {
  id: 'r1',
  height: 360,
  widgets: [
    { id: 'w0', viewId: 'v0', databaseId: 'db', width: 6 },
    { id: 'w1', viewId: 'v1', databaseId: 'db', width: 6 },
  ],
};

const FULL_ROW: DashboardRowData = {
  id: 'r1',
  height: 360,
  widgets: [0, 1, 2, 3].map((index) => ({ id: `w${index}`, viewId: `v${index}`, databaseId: 'db', width: 3 })),
};

const mockShowLimitMessage = jest.fn();
let setRows: (rows: DashboardRowData[]) => void = () => undefined;

function Harness({
  variant = UIVariant.App,
  initialRow = ROW,
  wrapColumns,
  minColumns = 1,
  showWidgetTitles = true,
  dashboardFull = false,
}: {
  variant?: UIVariant;
  initialRow?: DashboardRowData;
  wrapColumns?: number;
  minColumns?: number;
  showWidgetTitles?: boolean;
  dashboardFull?: boolean;
}) {
  const [rows, updateRows] = useState([initialRow]);
  const [ui] = useState(() => ({
    hostDatabaseId: 'db',
    openPicker: jest.fn(),
    showLimitMessage: mockShowLimitMessage,
    dndInstanceId: Symbol('dashboard-row-test'),
    getRows: () => rows,
    updateRows,
    acquireSourceDoc: () => () => undefined,
    selectWidget: jest.fn(),
  }));
  const host = { workspaceId: 'workspace-id', variant } as DashboardHostServices;

  setRows = updateRows;

  return (
    <DashboardHostContext.Provider value={host}>
      <DashboardUiContext.Provider value={ui}>
        <DashboardRow
          canEdit
          dashboardFull={dashboardFull}
          isEditing
          minColumns={minColumns}
          row={rows[0]}
          rowIndex={0}
          showIconsInHeading={false}
          showWidgetTitles={showWidgetTitles}
          wrapColumns={wrapColumns ?? rows[0].widgets.length}
        />
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
}

const grid = () => screen.getByTestId('dashboard-row').firstElementChild as HTMLElement;
const rowHeightVariable = () => grid().style.getPropertyValue(ROW_HEIGHT_CSS_VARIABLE);

beforeEach(() => {
  mockGetWorkspaceDatabaseCatalog.mockClear();
  mockShowLimitMessage.mockClear();
});

afterEach(() => {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

describe('DashboardRow height', () => {
  it('shows the committed height after a drag during which the row re-rendered', () => {
    render(<Harness />);
    expect(rowHeightVariable()).toBe('360px');

    const handle = screen.getByTestId('dashboard-height-handle');

    fireEvent(handle, pointer('pointerdown', 100));
    act(() => {
      document.dispatchEvent(pointer('pointermove', 220));
    });
    expect(rowHeightVariable()).toBe('480px');

    // A collaborator edits the row while the preview already shows the final
    // height: the row renders with it before the drag ends.
    act(() => setRows([{ ...ROW, widgets: [{ ...ROW.widgets[0], viewId: 'v1' }] }]));
    act(() => {
      document.dispatchEvent(pointer('pointerup'));
    });

    expect(handle.getAttribute('aria-valuenow')).toBe('480');
    expect(rowHeightVariable()).toBe('480px');
  });
});

describe('DashboardRow handles (WP02)', () => {
  it('reports the snapped height to assistive technology and never shows a px badge', () => {
    render(<Harness />);
    const handle = screen.getByTestId('dashboard-height-handle');

    expect(handle.getAttribute('aria-valuetext')).toBe('360 pixels');
    fireEvent(handle, pointer('pointerdown', 100));
    act(() => {
      document.dispatchEvent(pointer('pointermove', 211));
    });

    expect(rowHeightVariable()).toBe('480px');
    expect(handle.getAttribute('aria-valuenow')).toBe('480');
    expect(handle.getAttribute('aria-valuetext')).toBe('480 pixels');
    expect(screen.queryByText(/\d+\s?px$/)).toBeNull();
    expect(screen.getByTestId('dashboard-resize-band').getAttribute('data-state')).toBe('active');
    act(() => {
      document.dispatchEvent(pointer('pointerup'));
    });
    expect(handle.getAttribute('aria-valuenow')).toBe('480');
    expect(screen.getByTestId('dashboard-resize-band').getAttribute('data-state')).toBe('idle');
  });

  it('puts the height handle in the band below the row, outside the track', () => {
    render(<Harness />);
    const gap = screen.getByTestId('dashboard-row-gap');

    expect(gap.getAttribute('data-gap-index')).toBe('1');
    expect(gap.style.height).toBe('16px');
    expect(gap.contains(screen.getByTestId('dashboard-height-handle'))).toBe(true);
    expect(grid().getAttribute('data-testid')).toBe('dashboard-row-track');
    expect(grid().contains(screen.getByTestId('dashboard-height-handle'))).toBe(false);
  });

  it('turns the width pill active while dragged or focused, and idle again', () => {
    render(<Harness initialRow={TWO_UP} minColumns={3} />);
    const handle = screen.getByTestId('dashboard-width-handle');
    const pill = () => screen.getByTestId('dashboard-resize-pill');

    expect(pill().getAttribute('data-state')).toBe('idle');
    expect(handle.getAttribute('aria-valuemin')).toBe('3');
    expect(handle.getAttribute('aria-valuemax')).toBe('9');
    expect(handle.getAttribute('aria-valuetext')).toBe('6 of 12 columns');

    fireEvent.pointerEnter(handle);
    expect(pill().getAttribute('data-state')).toBe('hover');
    fireEvent.pointerLeave(handle);
    expect(pill().getAttribute('data-state')).toBe('idle');

    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1244 } as DOMRect);
    fireEvent(handle, pointer('pointerdown'));
    expect(pill().getAttribute('data-state')).toBe('active');
    act(() => {
      document.dispatchEvent(pointer('pointerup'));
    });
    expect(pill().getAttribute('data-state')).toBe('idle');

    act(() => handle.focus());
    expect(pill().getAttribute('data-state')).toBe('active');
    act(() => handle.blur());
    expect(pill().getAttribute('data-state')).toBe('idle');
    jest.restoreAllMocks();
  });

  it('sizes the width pill and the height band from the resize tokens', () => {
    render(<Harness initialRow={TWO_UP} />);
    const handle = screen.getByTestId('dashboard-width-handle');
    const pill = screen.getByTestId('dashboard-resize-pill');
    const band = screen.getByTestId('dashboard-resize-band');
    const { hitWidth, pillMin, pillFraction, pillMax, pillWidthHover, pillWidthActive, bandHover, bandActive } =
      DASHBOARD_GEOMETRY.resize;

    // jsdom drops `clamp()` and mixed-unit `calc()` values, so the whole style is checked where it is built.
    expect(getWidthPillStyle('hover', '50%')).toEqual({
      top: '50%',
      height: `clamp(${pillMin}px, ${pillFraction * 100}%, ${pillMax}px)`,
      width: pillWidthHover,
    });
    expect(getWidthPillStyle('active', '50%').width).toBe(pillWidthActive);
    expect(getHeightBandStyle('idle')).toEqual({ height: bandHover });
    expect(getHeightBandStyle('active')).toEqual({ height: bandActive });

    expect(handle.style.width).toBe(`${hitWidth}px`);
    expect(pill.style.width).toBe(`${pillWidthHover}px`);
    expect(band.style.height).toBe(`${bandHover}px`);

    act(() => handle.focus());
    expect(pill.style.width).toBe(`${pillWidthActive}px`);
    act(() => screen.getByTestId('dashboard-height-handle').focus());
    expect(band.style.height).toBe(`${bandActive}px`);

    // The dashboard's motion tokens, never a literal duration, and no motion when the user asked for less.
    for (const element of [pill, band]) {
      expect(element.className).toContain('duration-[var(--dash-motion-fast)]');
      expect(element.className).toContain('ease-[var(--dash-motion-ease)]');
      expect(element.className).toContain('motion-reduce:transition-none');
      expect(element.className).not.toMatch(/duration-\d/);
    }
  });

  it('centres the width pill on the cards, also with titles hidden', () => {
    // Titles hidden: the card spans 6px to H - 6px, so the pill sits on the middle of the box.
    const hidden = render(<Harness initialRow={TWO_UP} showWidgetTitles={false} />);
    const pill = () => screen.getByTestId('dashboard-resize-pill');

    expect(pill().style.top).toBe('50%');
    expect(pill().className).toContain('-translate-y-1/2');
    hidden.unmount();

    // Titles shown: the centre of the card under the 40px header (`calc(40px + (100% - 46px) / 2)`,
    // a value jsdom cannot hold; `getWidgetCardCenter` is checked in utils.test.ts).
    render(<Harness initialRow={TWO_UP} />);
    expect(pill().style.top).not.toBe('50%');
  });

  it('never animates a layout change: the row carries no reflow state', () => {
    render(<Harness initialRow={TWO_UP} />);
    const row = screen.getByTestId('dashboard-row');

    act(() => setRows([{ ...TWO_UP, widgets: [{ ...TWO_UP.widgets[0], width: 4 }, { ...TWO_UP.widgets[1], width: 8 }] }]));
    expect(row.hasAttribute('data-reflow')).toBe(false);
    expect(screen.getAllByTestId('dashboard-widget').map((widget) => widget.dataset.span)).toEqual(['4', '8']);
  });

  it('has no width handles on a wrapped row but keeps its row controls', () => {
    render(<Harness initialRow={TWO_UP} wrapColumns={1} />);

    expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
    expect(screen.getAllByTestId('dashboard-row-control-anchor').map((anchor) => anchor.dataset.side)).toEqual([
      'start',
      'end',
    ]);
    expect(screen.getByTestId('dashboard-row').getAttribute('data-lines')).toBe('1,1');
    expect(screen.getAllByTestId('dashboard-widget').map((widget) => widget.dataset.span)).toEqual(['12', '12']);
  });
});

describe('DashboardRow limits', () => {
  const insertButton = () => screen.getByTestId('dashboard-insert-row-button');
  const addButton = () => screen.getByTestId('dashboard-add-widget-row-button');

  it('offers both row controls while there is room', () => {
    render(<Harness />);

    expect(insertButton().hasAttribute('disabled')).toBe(false);
    expect(addButton().hasAttribute('disabled')).toBe(false);
    // No wrapper takes the click of a usable control.
    expect(insertButton().parentElement?.getAttribute('data-testid')).toBe('dashboard-row-control-anchor');
    expect(addButton().parentElement?.getAttribute('data-testid')).toBe('dashboard-row-control-anchor');
  });

  it('explains the row limit from the disabled add control of a full row, and still inserts rows', () => {
    render(<Harness initialRow={FULL_ROW} />);

    expect(insertButton().hasAttribute('disabled')).toBe(false);
    expect(addButton().hasAttribute('disabled')).toBe(true);
    fireEvent.click(addButton().parentElement as HTMLElement);
    expect(mockShowLimitMessage.mock.calls).toEqual([['row']]);
  });

  it('explains the widget limit from both disabled controls of a full dashboard', () => {
    render(<Harness dashboardFull initialRow={FULL_ROW} />);

    expect(insertButton().hasAttribute('disabled')).toBe(true);
    expect(addButton().hasAttribute('disabled')).toBe(true);
    fireEvent.click(insertButton().parentElement as HTMLElement);
    fireEvent.click(addButton().parentElement as HTMLElement);
    expect(mockShowLimitMessage.mock.calls).toEqual([['dashboard'], ['dashboard']]);
  });
});

describe('widget picker preload', () => {
  it('warms the workspace catalog on hover or focus of the add buttons', () => {
    render(<Harness />);

    fireEvent.pointerEnter(screen.getByTestId('dashboard-add-widget-row-button'));
    act(() => screen.getByTestId('dashboard-insert-row-button').focus());

    expect(mockGetWorkspaceDatabaseCatalog.mock.calls).toEqual([['workspace-id'], ['workspace-id']]);
  });

  it('leaves the catalog alone where the picker never loads it', () => {
    render(<Harness variant={UIVariant.Publish} />);
    fireEvent.pointerEnter(screen.getByTestId('dashboard-add-widget-row-button'));

    preloadWidgetPicker(undefined, UIVariant.App);
    expect(mockGetWorkspaceDatabaseCatalog).not.toHaveBeenCalled();
  });

  it('does not surface a failed catalog request (the picker retries it)', async () => {
    mockGetWorkspaceDatabaseCatalog.mockImplementationOnce(() => Promise.reject(new Error('offline')));

    preloadWidgetPicker('workspace-id', UIVariant.App);
    await act(() => Promise.resolve());
    expect(mockGetWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
  });
});
