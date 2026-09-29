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
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});

jest.mock('../WidgetPickerContent', () => ({ __esModule: true, default: () => null }));

jest.mock('../DashboardWidget', () => ({
  DashboardWidget: ({ widget, span }: { widget: { id: string }; span: number }) => (
    <div data-span={span} data-testid='dashboard-widget' data-widget-id={widget.id} />
  ),
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

let setRows: (rows: DashboardRowData[]) => void = () => undefined;

function Harness({ variant = UIVariant.App }: { variant?: UIVariant }) {
  const [rows, updateRows] = useState([ROW]);
  const [ui] = useState(() => ({
    hostDatabaseId: 'db',
    openPicker: jest.fn(),
    showLimitMessage: jest.fn(),
    dndInstanceId: Symbol('dashboard-row-test'),
    getRows: () => rows,
    updateRows,
    acquireSourceDoc: () => () => undefined,
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
          row={rows[0]}
          rowIndex={0}
          showWidgetTitles
          stacked={false}
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
