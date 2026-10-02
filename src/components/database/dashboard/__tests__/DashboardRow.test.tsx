import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { DashboardRow as DashboardRowData } from '@/application/database-yjs/dashboard.type';
import { UIVariant } from '@/application/types';

import { DashboardRow } from '../DashboardRow';
import { DashboardHostContext, DashboardHostServices, DashboardUiContext } from '../DashboardUiContext';
import { ROW_HEIGHT_CSS_VARIABLE } from '../hooks/useRowHeightResize';
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

let setRows: (rows: DashboardRowData[]) => void = () => undefined;

function Harness({
  variant = UIVariant.App,
  initialRow = ROW,
  wrapColumns,
  minColumns = 1,
}: {
  variant?: UIVariant;
  initialRow?: DashboardRowData;
  wrapColumns?: number;
  minColumns?: number;
}) {
  const [rows, updateRows] = useState([initialRow]);
  const [ui] = useState(() => ({
    hostDatabaseId: 'db',
    openPicker: jest.fn(),
    showLimitMessage: jest.fn(),
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
          dashboardFull={false}
          isEditing
          minColumns={minColumns}
          row={rows[0]}
          rowIndex={0}
          showIconsInHeading={false}
          showWidgetTitles
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
