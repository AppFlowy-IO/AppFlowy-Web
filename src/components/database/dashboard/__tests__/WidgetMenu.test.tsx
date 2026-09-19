import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, useState } from 'react';

import { DASHBOARD_MAX_WIDGETS, DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { ViewLayout } from '@/application/types';

import { DashboardContext, DashboardContextValue } from '../DashboardContext';
import { NO_WIDGET_MOVES, WidgetMoveTargets } from '../widget-moves';
import { WidgetActions, WidgetContext, WidgetContextValue } from '../WidgetContext';
import { WidgetHeaderFrame } from '../WidgetHeader';
import { buildWidgetMenuEntries, WidgetMenu } from '../WidgetMenu';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: ({ view }: { view: { layout: ViewLayout } }) => <span data-layout={view.layout} data-testid='page-icon' />,
}));

jest.mock('@/components/database/components/conditions', () => ({
  DatabaseActions: () => <div data-testid='database-actions' />,
}));

const ALL_MOVES: WidgetMoveTargets = {
  left: { type: 'existing_row', rowId: 'r1', index: 0 },
  right: { type: 'existing_row', rowId: 'r1', index: 2 },
  up: { type: 'new_row', rowIndex: 0 },
  down: { type: 'new_row', rowIndex: 1 },
};

function createActions(overrides: Partial<WidgetActions> = {}): WidgetActions {
  return {
    open: jest.fn(),
    changeView: jest.fn(),
    duplicate: jest.fn(),
    remove: jest.fn(),
    move: jest.fn(),
    ...overrides,
  };
}

const widget = (id: string): DashboardWidget => ({ id, viewId: `view-${id}`, databaseId: 'db', width: 4 });
const row = (id: string, widgetIds: string[]): DashboardRow => ({ id, height: 360, widgets: widgetIds.map(widget) });

/** `w1` sits in the middle of a shared row between two other rows: every move is possible. */
const MOVABLE_ROWS = [row('r0', ['x']), row('r1', ['a', 'w1', 'b']), row('r2', ['y'])];
/** `w1` is the only widget: no move is possible. */
const LONE_ROWS = [row('r1', ['w1'])];
/** A full dashboard (`w1` included): duplicating is refused. */
const FULL_ROWS = Array.from({ length: DASHBOARD_MAX_WIDGETS / 4 }, (_, rowIndex) =>
  row(
    `r${rowIndex}`,
    Array.from({ length: 4 }, (_, index) => (rowIndex === 0 && index === 0 ? 'w1' : `f${rowIndex}-${index}`))
  )
);

function createDashboardContext(rows: DashboardRow[]): DashboardContextValue {
  return {
    dashboardViewId: 'dashboard',
    hostDatabaseId: 'db',
    hostViewIds: [],
    rows,
    showWidgetTitles: true,
    canEdit: true,
    isEditing: true,
    setEditing: jest.fn(),
    updateSetting: jest.fn(),
    updateRows: jest.fn(),
  };
}

function createContext(overrides: Partial<WidgetContextValue> = {}): WidgetContextValue {
  return {
    widgetId: 'w1',
    name: 'Tasks Grid',
    icon: null,
    layout: ViewLayout.Grid,
    isEditing: true,
    canEdit: true,
    showTitle: true,
    headerHeight: 36,
    isDragging: false,
    setDragHandle: jest.fn(),
    actions: createActions(),
    ...overrides,
  };
}

function withContext(value: WidgetContextValue, children: ReactNode, rows: DashboardRow[] = MOVABLE_ROWS) {
  return (
    <DashboardContext.Provider value={createDashboardContext(rows)}>
      <WidgetContext.Provider value={value}>{children}</WidgetContext.Provider>
    </DashboardContext.Provider>
  );
}

function ControlledMenu({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <WidgetMenu onOpenChange={setOpen} open={open}>
      <button data-testid='trigger' type='button'>
        Options
      </button>
    </WidgetMenu>
  );
}

function menuItemIds() {
  return within(screen.getByTestId('dashboard-widget-menu'))
    .getAllByRole('menuitem')
    .map((item) => item.getAttribute('data-testid'));
}

describe('buildWidgetMenuEntries', () => {
  it('offers only "Open view" outside Edit mode', () => {
    expect(
      buildWidgetMenuEntries({ editing: false, canDuplicate: true, moveTargets: ALL_MOVES }).map((entry) => entry.id)
    ).toEqual(['open']);
  });

  it('lists every layout action in Edit mode', () => {
    const entries = buildWidgetMenuEntries({ editing: true, canDuplicate: true, moveTargets: ALL_MOVES });

    expect(entries.map((entry) => entry.id)).toEqual([
      'open',
      'change-view',
      'duplicate',
      'move-left',
      'move-right',
      'move-up',
      'move-down',
      'delete',
    ]);
    expect(entries.every((entry) => !entry.disabled)).toBe(true);
    expect(entries.map((entry) => entry.group)).toEqual([
      'navigate',
      'edit',
      'edit',
      'move',
      'move',
      'move',
      'move',
      'danger',
    ]);
  });

  it('keeps Duplicate selectable at the widget limit so it can explain the limit', () => {
    const duplicate = buildWidgetMenuEntries({ editing: true, canDuplicate: false, moveTargets: ALL_MOVES }).find(
      (entry) => entry.id === 'duplicate'
    );

    expect(duplicate).toMatchObject({ disabled: false, limitReached: true });
    expect(
      buildWidgetMenuEntries({ editing: true, canDuplicate: true, moveTargets: ALL_MOVES }).find(
        (entry) => entry.id === 'duplicate'
      )?.limitReached
    ).toBe(false);
  });

  it('disables each impossible move', () => {
    const entries = buildWidgetMenuEntries({
      editing: true,
      canDuplicate: true,
      moveTargets: { ...NO_WIDGET_MOVES, right: ALL_MOVES.right, down: ALL_MOVES.down },
    });
    const disabled = Object.fromEntries(entries.map((entry) => [entry.id, entry.disabled]));

    expect(disabled).toMatchObject({
      'move-left': true,
      'move-right': false,
      'move-up': true,
      'move-down': false,
      delete: false,
      'change-view': false,
    });
  });

  it('uses the contract translation keys', () => {
    expect(
      buildWidgetMenuEntries({ editing: true, canDuplicate: true, moveTargets: ALL_MOVES }).map((entry) => [
        entry.labelKey,
        entry.defaultLabel,
      ])
    ).toEqual([
      ['dashboard.widget.open', 'Open view'],
      ['dashboard.widget.changeView', 'Change view'],
      ['dashboard.widget.duplicate', 'Duplicate'],
      ['dashboard.widget.moveLeft', 'Move left'],
      ['dashboard.widget.moveRight', 'Move right'],
      ['dashboard.widget.moveUp', 'Move up'],
      ['dashboard.widget.moveDown', 'Move down'],
      ['dashboard.widget.delete', 'Delete'],
    ]);
  });
});

describe('WidgetMenu', () => {
  it('renders the Edit-mode entries with their test ids', () => {
    render(withContext(createContext(), <ControlledMenu />));

    expect(menuItemIds()).toEqual([
      'dashboard-widget-menu-open',
      'dashboard-widget-menu-change-view',
      'dashboard-widget-menu-duplicate',
      'dashboard-widget-menu-move-left',
      'dashboard-widget-menu-move-right',
      'dashboard-widget-menu-move-up',
      'dashboard-widget-menu-move-down',
      'dashboard-widget-menu-delete',
    ]);
    expect(screen.getByTestId('dashboard-widget-menu-delete').textContent).toBe('Delete');
  });

  it.each([
    ['dashboard-widget-menu-open', 'open', undefined],
    ['dashboard-widget-menu-change-view', 'changeView', undefined],
    ['dashboard-widget-menu-duplicate', 'duplicate', undefined],
    ['dashboard-widget-menu-delete', 'remove', undefined],
    ['dashboard-widget-menu-move-left', 'move', 'left'],
    ['dashboard-widget-menu-move-right', 'move', 'right'],
    ['dashboard-widget-menu-move-up', 'move', 'up'],
    ['dashboard-widget-menu-move-down', 'move', 'down'],
  ] as const)('%s runs its action and closes the menu', async (testId, action, argument) => {
    const actions = createActions();

    render(withContext(createContext({ actions }), <ControlledMenu />));
    fireEvent.click(screen.getByTestId(testId));

    expect(actions[action]).toHaveBeenCalledTimes(1);
    if (argument) expect(actions.move).toHaveBeenCalledWith(argument);
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
  });

  it('ignores disabled entries', () => {
    const actions = createActions();

    render(withContext(createContext({ actions }), <ControlledMenu />, LONE_ROWS));

    for (const testId of ['move-left', 'move-right', 'move-up', 'move-down']) {
      const item = screen.getByTestId(`dashboard-widget-menu-${testId}`);

      expect(item.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(item);
    }

    expect(actions.move).not.toHaveBeenCalled();
  });

  it('lets Duplicate at the widget limit run, so the limit message can be shown', () => {
    const actions = createActions();

    render(withContext(createContext({ actions }), <ControlledMenu />, FULL_ROWS));
    const item = screen.getByTestId('dashboard-widget-menu-duplicate');

    expect(item.getAttribute('aria-disabled')).toBeNull();
    expect(item.getAttribute('data-limit-reached')).toBe('true');
    expect(item.getAttribute('title')).toBe('Dashboards support up to {{count}} widgets.');
    fireEvent.click(item);
    expect(actions.duplicate).toHaveBeenCalledTimes(1);
  });

  it('follows a layout change while it is open', () => {
    const context = createContext();
    const { rerender } = render(withContext(context, <ControlledMenu />));

    expect(screen.getByTestId('dashboard-widget-menu-move-left').getAttribute('aria-disabled')).toBeNull();
    rerender(withContext(context, <ControlledMenu />, LONE_ROWS));
    expect(screen.getByTestId('dashboard-widget-menu-move-left').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('dashboard-widget-menu-move-down').getAttribute('aria-disabled')).toBe('true');
  });

  it('offers only "Open view" to viewers', () => {
    render(withContext(createContext({ isEditing: false }), <ControlledMenu />));

    expect(menuItemIds()).toEqual(['dashboard-widget-menu-open']);
  });

  it('treats Edit mode without write access as View mode', () => {
    render(withContext(createContext({ isEditing: true, canEdit: false }), <ControlledMenu />));

    expect(menuItemIds()).toEqual(['dashboard-widget-menu-open']);
  });
});

describe('WidgetHeaderFrame', () => {
  it('shows the drag handle, title, view actions and menu button in Edit mode', () => {
    const context = createContext();

    render(withContext(context, <WidgetHeaderFrame actions={<div data-testid='view-actions' />} />));
    const header = screen.getByTestId('dashboard-widget-header');

    expect(within(header).getByTestId('dashboard-widget-title').textContent).toBe('Tasks Grid');
    expect(within(header).getByTestId('view-actions')).toBeTruthy();
    expect(within(header).getByTestId('dashboard-widget-menu-button')).toBeTruthy();
    expect(context.setDragHandle).toHaveBeenCalledWith(header);
    expect(header.style.height).toBe('36px');
  });

  it('opens the widget menu from the menu button', async () => {
    render(withContext(createContext(), <WidgetHeaderFrame />));
    const button = screen.getByTestId('dashboard-widget-menu-button');

    fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
    fireEvent.keyDown(button, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('dashboard-widget-menu')).toBeTruthy());
  });

  it('opens the widget menu from the title, in both modes', async () => {
    const { unmount } = render(withContext(createContext(), <WidgetHeaderFrame />));

    fireEvent.click(screen.getByTestId('dashboard-widget-title-button'));
    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
    unmount();

    render(withContext(createContext({ isEditing: false }), <WidgetHeaderFrame />));
    fireEvent.click(screen.getByTestId('dashboard-widget-title-button'));
    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
  });

  it('opens the widget menu on right-click', async () => {
    render(withContext(createContext(), <WidgetHeaderFrame />));

    const event = fireEvent.contextMenu(screen.getByTestId('dashboard-widget-header'));

    expect(event).toBe(false);
    await waitFor(() => expect(screen.getByTestId('dashboard-widget-menu')).toBeTruthy());
    expect(menuItemIds()).toHaveLength(8);
  });

  it('shows a quiet title without the menu button in View mode', async () => {
    render(
      withContext(
        createContext({ isEditing: false }),
        <WidgetHeaderFrame actions={<div data-testid='view-actions' />} />
      )
    );
    const header = screen.getByTestId('dashboard-widget-header');

    expect(within(header).getByTestId('dashboard-widget-title').textContent).toBe('Tasks Grid');
    expect(within(header).getByTestId('view-actions')).toBeTruthy();
    expect(within(header).queryByTestId('dashboard-widget-menu-button')).toBeNull();
    expect(header.style.height).toBe('32px');

    fireEvent.contextMenu(header);
    await waitFor(() => expect(menuItemIds()).toEqual(['dashboard-widget-menu-open']));
  });

  it('renders only the floating actions when widget titles are hidden', () => {
    render(
      withContext(
        createContext({ isEditing: false, showTitle: false, headerHeight: 0 }),
        <WidgetHeaderFrame actions={<div data-testid='view-actions' />} />
      )
    );
    const header = screen.getByTestId('dashboard-widget-header');

    expect(within(header).queryByTestId('dashboard-widget-title')).toBeNull();
    expect(within(header).getByTestId('view-actions')).toBeTruthy();
    expect(header.className).toContain('absolute');
  });

  it('falls back to "untitled" for an unnamed view', () => {
    render(withContext(createContext({ name: '' }), <WidgetHeaderFrame />));

    expect(screen.getByTestId('dashboard-widget-title').textContent).toBe('untitled');
  });
});
