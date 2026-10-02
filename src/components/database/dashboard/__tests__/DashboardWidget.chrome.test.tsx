import { fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useState } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardWidget as DashboardWidgetData } from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { DashboardProvider } from '../DashboardContext';
import { DashboardHostContext, DashboardSelectionContext, DashboardUiContext } from '../DashboardUiContext';
import { DashboardWidget } from '../DashboardWidget';
import { RowHeightPreview } from '../hooks/useRowHeightResize';

const mockEmbeddedHeights: number[] = [];

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));
jest.mock('react-i18next', () => {
  const t = (key: string) => key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({ DropIndicator: () => null }));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
// The nested database: a probe of the widget's menu and settings state, an
// input, and an element that handles its own context menu.
jest.mock('@/components/database', () => ({
  Database: ({ embeddedHeight }: { embeddedHeight?: number }) => {
    const { useWidgetContext } = jest.requireActual<typeof import('../WidgetContext')>('../WidgetContext');
    const widget = useWidgetContext();

    mockEmbeddedHeights.push(embeddedHeight ?? -1);
    return (
      <div data-testid='widget-surface'>
        <output data-testid='menu-open'>{String(widget.menuOpen)}</output>
        <output data-testid='settings-open'>{String(widget.settingsOpen)}</output>
        <button data-testid='open-menu' onClick={() => widget.setMenuOpen(true)} type='button' />
        <button data-testid='close-menu' onClick={() => widget.setMenuOpen(false)} type='button' />
        <button data-testid='open-settings' onClick={() => widget.actions.openSettings()} type='button' />
        <button data-testid='close-settings' onClick={() => widget.setSettingsOpen(false)} type='button' />
        <input data-testid='widget-input' />
        <div data-testid='own-context-menu' onContextMenu={(event) => event.preventDefault()} />
      </div>
    );
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

const WIDGET: DashboardWidgetData = { id: 'w1', viewId: 'v1', databaseId: 'db', width: 12 };
const NO_PREVIEW: RowHeightPreview = { subscribe: () => () => undefined, get: () => null };

function createHost() {
  const doc = new Y.Doc({ guid: 'db' }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const dashboard = new Y.Map() as YDatabaseView;
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'db');
  database.set(YjsDatabaseKey.views, views);
  views.set('dashboard', dashboard);
  views.set('v1', view);
  view.set(YjsDatabaseKey.name, 'Tasks');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  updateDashboardLayoutSetting(dashboard, { rows: [{ id: 'r1', height: 360, widgets: [WIDGET] }] });

  const host: DatabaseContextState = {
    databaseDoc: doc,
    readOnly: false,
    canWrite: true,
    rowMap: {},
    databasePageId: 'dashboard',
    activeViewId: 'dashboard',
  };

  return host;
}

/** The parts of `Dashboard` a widget relies on: the UI context and the selection. */
function Harness({ editing, showWidgetTitles = true }: { editing: boolean; showWidgetTitles?: boolean }) {
  const [host] = useState(createHost);
  const [selected, setSelected] = useState<string | null>(null);
  const selectWidget = useCallback(
    (id: string | null, options?: { onlyIf?: string }) => {
      if (id === null) {
        setSelected((current) => (options?.onlyIf === undefined || current === options.onlyIf ? null : current));
      } else if (editing) {
        setSelected(id);
      }
    },
    [editing]
  );

  return (
    <DatabaseContext.Provider value={host}>
      <DashboardHostContext.Provider value={host}>
        <DashboardProvider>
          <DashboardUiContext.Provider
            value={{
              hostDatabaseId: 'db',
              dndInstanceId: Symbol.for('dashboard-chrome-test'),
              getRows: () => [],
              updateRows: jest.fn(),
              openPicker: jest.fn(),
              showLimitMessage: jest.fn(),
              acquireSourceDoc: () => () => undefined,
              selectWidget,
            }}
          >
            <DashboardSelectionContext.Provider value={editing ? selected : null}>
              <DashboardWidget
                canEdit
                height={360}
                heightPreview={NO_PREVIEW}
                isDragging={false}
                isEditing={editing}
                lineSize={1}
                showIconsInHeading={false}
                showWidgetTitles={showWidgetTitles}
                span={12}
                widget={WIDGET}
              />
            </DashboardSelectionContext.Provider>
          </DashboardUiContext.Provider>
        </DashboardProvider>
      </DashboardHostContext.Provider>
    </DatabaseContext.Provider>
  );
}

const box = () => screen.getByTestId('dashboard-widget');
const menuOpen = () => screen.getByTestId('menu-open').textContent;

beforeEach(() => {
  mockEmbeddedHeights.length = 0;
});

describe('DashboardWidget chrome', () => {
  it('is a padded box, tinted only in Edit mode', () => {
    const { rerender } = render(<Harness editing={false} />);

    expect(box().getAttribute('data-editing')).toBe('false');
    for (const name of ['rounded-500', 'px-1.5', 'pb-1.5', 'data-[editing=true]:bg-dash-edit-tint', 'duration-150']) {
      expect(box().className).toContain(name);
    }

    expect(box().className).not.toContain('pt-1.5');

    rerender(<Harness editing />);
    expect(box().getAttribute('data-editing')).toBe('true');
  });

  it('pads the top of the box when titles are hidden', () => {
    render(<Harness editing={false} showWidgetTitles={false} />);

    expect(box().className).toContain('pt-1.5');
  });

  it('is outlined in Edit mode while its menu or its settings are open', () => {
    render(<Harness editing />);

    expect(box().hasAttribute('data-selected')).toBe(false);
    fireEvent.click(screen.getByTestId('open-menu'));
    expect(box().getAttribute('data-selected')).toBe('true');
    expect(box().className).toContain('data-[selected=true]:shadow-[inset_0_0_0_2px_var(--dash-accent)]');
    fireEvent.click(screen.getByTestId('close-menu'));
    expect(box().hasAttribute('data-selected')).toBe(false);

    fireEvent.click(screen.getByTestId('open-settings'));
    expect(screen.getByTestId('settings-open').textContent).toBe('true');
    expect(box().getAttribute('data-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('close-settings'));
    expect(box().hasAttribute('data-selected')).toBe(false);
  });

  it('opens one of the menu and the settings host at a time, and keeps the outline across the switch', () => {
    render(<Harness editing />);

    fireEvent.click(screen.getByTestId('open-menu'));
    fireEvent.click(screen.getByTestId('open-settings'));
    expect(menuOpen()).toBe('false');
    expect(screen.getByTestId('settings-open').textContent).toBe('true');
    // The menu closing after the host took over must not clear the outline.
    fireEvent.click(screen.getByTestId('close-menu'));
    expect(box().getAttribute('data-selected')).toBe('true');

    fireEvent.click(screen.getByTestId('open-menu'));
    expect(screen.getByTestId('settings-open').textContent).toBe('false');
    expect(box().getAttribute('data-selected')).toBe('true');
  });

  it('is never outlined in View mode', () => {
    render(<Harness editing={false} />);

    fireEvent.click(screen.getByTestId('open-menu'));
    expect(menuOpen()).toBe('true');
    expect(box().hasAttribute('data-selected')).toBe(false);
  });

  it('opens the widget menu on a right-click anywhere on the box', () => {
    render(<Harness editing={false} />);

    expect(fireEvent.contextMenu(screen.getByTestId('widget-surface'))).toBe(false);
    expect(menuOpen()).toBe('true');
  });

  it('leaves the browser menu to inputs and to content that handles its own context menu', () => {
    render(<Harness editing={false} />);

    expect(fireEvent.contextMenu(screen.getByTestId('widget-input'))).toBe(true);
    expect(menuOpen()).toBe('false');
    fireEvent.contextMenu(screen.getByTestId('own-context-menu'));
    expect(menuOpen()).toBe('false');
  });

  it('hands the card height to the nested database, the same in View and Edit mode', () => {
    const { rerender, unmount } = render(<Harness editing={false} />);

    expect(mockEmbeddedHeights.at(-1)).toBe(360 - 46);
    rerender(<Harness editing />);
    expect(mockEmbeddedHeights.at(-1)).toBe(360 - 46);
    unmount();

    render(<Harness editing showWidgetTitles={false} />);
    expect(mockEmbeddedHeights.at(-1)).toBe(360 - 12);
  });
});
