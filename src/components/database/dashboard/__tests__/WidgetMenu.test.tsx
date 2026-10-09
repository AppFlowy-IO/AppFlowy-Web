import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, useState } from 'react';

import { DASHBOARD_MAX_WIDGETS, DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';

import { DashboardContext, DashboardLayoutContext, DashboardLayoutContextValue } from '../DashboardContext';
import { DashboardUiContext, DashboardUiContextValue } from '../DashboardUiContext';
import { NO_WIDGET_MOVES, WidgetMoveTargets } from '../widget-moves';
import { WidgetActions, WidgetContext, WidgetContextValue } from '../WidgetContext';
import { buildWidgetMenuEntries, WidgetMenu } from '../WidgetMenu';

import {
  createDashboardContextValue,
  createDashboardUiValue,
  createWidgetActions,
  createWidgetContextValue,
} from './dashboardTestHarness';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const ALL_MOVES: WidgetMoveTargets = {
  left: { type: 'existing_row', rowId: 'r1', index: 0 },
  right: { type: 'existing_row', rowId: 'r1', index: 2 },
  rowAbove: { type: 'new_row', rowIndex: 0 },
  rowBelow: { type: 'new_row', rowIndex: 1 },
};

function createActions(overrides: Partial<WidgetActions> = {}): WidgetActions {
  return { ...createWidgetActions(), ...overrides };
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

function createDashboardLayout(rows: DashboardRow[]): DashboardLayoutContextValue {
  return { rows, hostViewIds: [], showWidgetTitles: true, showIconsInHeading: false };
}

/** `w1` in Edit mode. */
function createContext(overrides: Partial<WidgetContextValue> = {}): WidgetContextValue {
  return createWidgetContextValue({ editing: true, isEditing: true, actions: createActions(), ...overrides });
}

function withContext(
  value: WidgetContextValue,
  children: ReactNode,
  rows: DashboardRow[] = MOVABLE_ROWS,
  ui: DashboardUiContextValue = createDashboardUiValue()
) {
  return (
    <DashboardContext.Provider value={createDashboardContextValue({ dashboardViewId: 'dashboard', isEditing: true })}>
      <DashboardLayoutContext.Provider value={createDashboardLayout(rows)}>
        <DashboardUiContext.Provider value={ui}>
          <WidgetContext.Provider value={value}>{children}</WidgetContext.Provider>
        </DashboardUiContext.Provider>
      </DashboardLayoutContext.Provider>
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
  it('offers only "View data source" outside Edit mode', () => {
    expect(
      buildWidgetMenuEntries({ editing: false, canDuplicate: true, moveTargets: ALL_MOVES }).map((entry) => entry.id)
    ).toEqual(['view-data-source']);
  });

  it('follows Notion in Edit mode', () => {
    const entries = buildWidgetMenuEntries({ editing: true, canDuplicate: true, moveTargets: ALL_MOVES });

    expect(entries.map((entry) => entry.id)).toEqual([
      'edit-view',
      'move-left',
      'move-right',
      'move-to-row',
      'duplicate',
      'delete',
    ]);
    expect(entries.every((entry) => !entry.disabled)).toBe(true);
    expect(entries.map((entry) => entry.group)).toEqual(['settings', 'move', 'move', 'move', 'manage', 'manage']);
    expect(entries[3].children?.map((child) => [child.id, child.disabled])).toEqual([
      ['create-row-above', false],
      ['create-row-below', false],
    ]);
  });

  it('omits Move left and Move right at the row ends', () => {
    const ids = (moveTargets: WidgetMoveTargets) =>
      buildWidgetMenuEntries({ editing: true, canDuplicate: true, moveTargets }).map((entry) => entry.id);

    expect(ids({ ...ALL_MOVES, left: null })).toEqual(['edit-view', 'move-right', 'move-to-row', 'duplicate', 'delete']);
    expect(ids({ ...ALL_MOVES, right: null })).toEqual(['edit-view', 'move-left', 'move-to-row', 'duplicate', 'delete']);
  });

  it('disables both new-row entries of a widget alone in its row', () => {
    const moveToRow = buildWidgetMenuEntries({ editing: true, canDuplicate: true, moveTargets: NO_WIDGET_MOVES }).find(
      (entry) => entry.id === 'move-to-row'
    );

    expect(moveToRow?.disabled).toBe(false);
    expect(moveToRow?.children?.map((child) => [child.id, child.disabled])).toEqual([
      ['create-row-above', true],
      ['create-row-below', true],
    ]);
  });

  it('disables Duplicate on a full dashboard and says why', () => {
    const duplicate = (canDuplicate: boolean) =>
      buildWidgetMenuEntries({ editing: true, canDuplicate, moveTargets: ALL_MOVES }).find(
        (entry) => entry.id === 'duplicate'
      );

    expect(duplicate(false)).toEqual({ id: 'duplicate', group: 'manage', disabled: true, disabledReason: 'dashboard_full' });
    expect(duplicate(true)).toEqual({ id: 'duplicate', group: 'manage', disabled: false });
  });
});

describe('WidgetMenu', () => {
  it('renders the Edit-mode entries with their test ids and the contract labels', () => {
    render(withContext(createContext(), <ControlledMenu />));

    expect(menuItemIds()).toEqual([
      'dashboard-widget-menu-edit-view',
      'dashboard-widget-menu-move-left',
      'dashboard-widget-menu-move-right',
      'dashboard-widget-menu-move-to-row',
      'dashboard-widget-menu-duplicate',
      'dashboard-widget-menu-delete',
    ]);
    expect(menuItemIds().map((id) => screen.getByTestId(id as string).textContent)).toEqual([
      'Edit view',
      'Move left',
      'Move right',
      'Move to row',
      'Duplicate',
      'Delete',
    ]);
    // Two separators: settings | move | manage.
    expect(within(screen.getByTestId('dashboard-widget-menu')).getAllByRole('separator')).toHaveLength(2);
  });

  it('has Notion chrome: 220 wide, radius 10, padding 4, neutral Delete and the parity ids', () => {
    render(withContext(createContext(), <ControlledMenu />));
    const menu = screen.getByTestId('dashboard-widget-menu');

    expect(menu.className).toContain('w-[220px]');
    expect(menu.className).toContain('!min-w-[220px]');
    expect(menu.className).toContain('!rounded-[10px]');
    expect(menu.className).toContain('!p-1');
    expect(menu.getAttribute('data-parity-id')).toBe('dash-widget-menu');

    const remove = screen.getByTestId('dashboard-widget-menu-delete');

    expect(remove.getAttribute('data-variant')).toBe('default');
    expect(remove.className).not.toContain('text-text-error');
    expect(remove.className).toContain('!h-7');
    expect(remove.getAttribute('data-parity-id')).toBe('dash-widget-menu-item-delete');
    expect(remove.querySelector('[data-parity-id="dash-widget-menu-item-delete__icon"]')).not.toBeNull();
    expect(remove.querySelector('[data-parity-id="dash-widget-menu-item-delete__label"]')?.textContent).toBe('Delete');
    expect(
      screen
        .getByTestId('dashboard-widget-menu-move-to-row')
        .querySelector('[data-parity-id="dash-widget-menu-item-move-to-row__chevron"]')
    ).not.toBeNull();
  });

  it.each([
    ['dashboard-widget-menu-edit-view', 'openSettings', undefined],
    ['dashboard-widget-menu-duplicate', 'duplicate', undefined],
    ['dashboard-widget-menu-delete', 'remove', undefined],
    ['dashboard-widget-menu-move-left', 'move', 'left'],
    ['dashboard-widget-menu-move-right', 'move', 'right'],
  ] as const)('%s runs its action and closes the menu', async (testId, action, argument) => {
    const actions = createActions();

    render(withContext(createContext({ actions }), <ControlledMenu />));
    fireEvent.click(screen.getByTestId(testId));

    expect(actions[action]).toHaveBeenCalledTimes(1);
    if (argument) expect(actions.move).toHaveBeenCalledWith(argument);
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
  });

  it('opens Move to row on hover and creates a row below from it', async () => {
    const actions = createActions();
    // jsdom has no PointerEvent, and the submenu opens for a mouse only (`pointerType`).
    const original = window.PointerEvent;

    class MousePointerEvent extends MouseEvent {
      pointerType: string;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }

    window.PointerEvent = MousePointerEvent as unknown as typeof PointerEvent;
    render(withContext(createContext({ actions }), <ControlledMenu />));
    try {
      fireEvent.pointerMove(screen.getByTestId('dashboard-widget-menu-move-to-row'), { pointerType: 'mouse' });
      await screen.findByTestId('dashboard-widget-menu-move-to-row-content');
    } finally {
      window.PointerEvent = original;
    }

    const content = screen.getByTestId('dashboard-widget-menu-move-to-row-content');

    expect(content.className).toContain('w-[220px]');
    expect(
      within(content)
        .getAllByRole('menuitem')
        .map((item) => [item.getAttribute('data-testid'), item.textContent])
    ).toEqual([
      ['dashboard-widget-menu-create-row-above', 'Create new row above'],
      ['dashboard-widget-menu-create-row-below', 'Create new row below'],
    ]);
    fireEvent.click(screen.getByTestId('dashboard-widget-menu-create-row-below'));
    expect(actions.move.mock.calls).toEqual([['rowBelow']]);
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
  });

  it('opens Move to row with ArrowRight and creates a row above from it', async () => {
    const actions = createActions();

    render(withContext(createContext({ actions }), <ControlledMenu />));
    const trigger = screen.getByTestId('dashboard-widget-menu-move-to-row');

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    await screen.findByTestId('dashboard-widget-menu-move-to-row-content');
    fireEvent.click(screen.getByTestId('dashboard-widget-menu-create-row-above'));
    expect(actions.move.mock.calls).toEqual([['rowAbove']]);
  });

  it('ignores the disabled new-row entries of a widget alone in its row and shows no move', async () => {
    const actions = createActions();

    render(withContext(createContext({ actions }), <ControlledMenu />, LONE_ROWS));
    expect(menuItemIds()).toEqual([
      'dashboard-widget-menu-edit-view',
      'dashboard-widget-menu-move-to-row',
      'dashboard-widget-menu-duplicate',
      'dashboard-widget-menu-delete',
    ]);
    fireEvent.click(screen.getByTestId('dashboard-widget-menu-move-to-row'));
    await screen.findByTestId('dashboard-widget-menu-move-to-row-content');

    for (const id of ['create-row-above', 'create-row-below']) {
      const item = screen.getByTestId(`dashboard-widget-menu-${id}`);

      expect(item.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(item);
    }

    expect(actions.move).not.toHaveBeenCalled();
  });

  it('keeps Duplicate on a full dashboard hoverable with the full tooltip, and announces instead of duplicating', async () => {
    const actions = createActions();
    const ui = createDashboardUiValue();

    render(withContext(createContext({ actions }), <ControlledMenu />, FULL_ROWS, ui));
    const item = screen.getByTestId('dashboard-widget-menu-duplicate');

    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.hasAttribute('data-disabled')).toBe(false);
    expect(item.getAttribute('data-disabled-reason')).toBe('dashboard-full');
    expect(item.className).toContain('!text-text-tertiary');

    act(() => item.focus());
    const tooltip = await screen.findByTestId('dashboard-full-tooltip');

    expect(tooltip.textContent).toContain('Dashboard is full');
    expect(tooltip.textContent).toContain('Delete a view to add a new one');
    expect(tooltip.getAttribute('data-parity-id')).toBe('dash-tooltip');

    fireEvent.click(item);
    expect(actions.duplicate).not.toHaveBeenCalled();
    expect(ui.announce).toHaveBeenCalledWith('Dashboard is full. Delete a view to add a new one.');
    // The menu stays open.
    expect(screen.getByTestId('dashboard-widget-menu')).toBeTruthy();
  });

  // WP05 §1.4: one duplicate at a time per widget, while its view copy is being created.
  it('disables owned duplication offline while retaining moves and removal, then updates on reconnect', () => {
    const actions = createActions();
    const ui = createDashboardUiValue();
    const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    try {
      render(withContext(createContext({ actions }), <ControlledMenu />, MOVABLE_ROWS, ui));
      const item = () => screen.getByTestId('dashboard-widget-menu-duplicate');

      expect(item().getAttribute('aria-disabled')).toBe('true');
      expect(item().getAttribute('data-disabled-reason')).toBe('online-required');
      expect(screen.getByTestId('dashboard-widget-menu-move-left').hasAttribute('data-disabled')).toBe(false);
      expect(screen.getByTestId('dashboard-widget-menu-delete').hasAttribute('data-disabled')).toBe(false);
      fireEvent.click(item());
      expect(actions.duplicate).not.toHaveBeenCalled();
      expect(ui.announce).toHaveBeenCalledWith('Connect to the internet to create dashboard widget views.');
      online.mockReturnValue(true);
      act(() => { window.dispatchEvent(new Event('online')); });
      expect(item().getAttribute('data-disabled-reason')).toBeNull();
      fireEvent.click(item());
      expect(actions.duplicate).toHaveBeenCalledTimes(1);
    } finally {
      online.mockRestore();
    }
  });

  it('disables Duplicate while this widget\'s duplicate is in flight', () => {
    const actions = createActions();
    const ui = createDashboardUiValue();
    let inFlight: string | null = 'w1';
    const listeners = new Set<() => void>();

    ui.ownedViews = {
      ...ui.ownedViews,
      duplicatingWidget: {
        get: () => inFlight,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };
    render(withContext(createContext({ actions }), <ControlledMenu />, MOVABLE_ROWS, ui));
    const item = () => screen.getByTestId('dashboard-widget-menu-duplicate');

    expect(item().hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(item());
    expect(actions.duplicate).not.toHaveBeenCalled();

    act(() => {
      inFlight = null;
      listeners.forEach((listener) => listener());
    });
    expect(item().hasAttribute('data-disabled')).toBe(false);
  });

  it('follows a layout change while it is open', () => {
    const context = createContext();
    const { rerender } = render(withContext(context, <ControlledMenu />));

    expect(screen.getByTestId('dashboard-widget-menu-move-left')).toBeTruthy();
    rerender(withContext(context, <ControlledMenu />, LONE_ROWS));
    expect(screen.queryByTestId('dashboard-widget-menu-move-left')).toBeNull();
    expect(screen.queryByTestId('dashboard-widget-menu-move-right')).toBeNull();
  });

  it('offers only "View data source" to viewers, which opens the view', async () => {
    const actions = createActions();

    render(withContext(createContext({ isEditing: false, editing: false, actions }), <ControlledMenu />));

    expect(menuItemIds()).toEqual(['dashboard-widget-menu-view-data-source']);
    const item = screen.getByTestId('dashboard-widget-menu-view-data-source');

    expect(item.textContent).toBe('View data source');
    expect(item.getAttribute('data-parity-id')).toBe('dash-widget-menu-item-view-data-source');
    fireEvent.click(item);
    expect(actions.open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
  });

  it('treats Edit mode without write access as View mode', () => {
    render(withContext(createContext({ isEditing: true, canEdit: false }), <ControlledMenu />));

    expect(menuItemIds()).toEqual(['dashboard-widget-menu-view-data-source']);
  });

  // WP14 §1.4.2: the same open state, as a bottom sheet with the View-mode model.
  it('is a bottom sheet in a mobile context, offering only View data source', async () => {
    const actions = createActions();

    render(
      withContext(
        createContext({ isEditing: false, editing: false, mobileContext: true, name: 'Projects Grid', actions }),
        <ControlledMenu />
      )
    );

    expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull();
    const sheet = screen.getByTestId('mobile-sheet');

    expect(sheet.getAttribute('data-sheet')).toBe('widget-menu');
    expect(within(sheet).getByTestId('mobile-sheet-title').textContent).toBe('Projects Grid');
    const items = within(sheet).getAllByTestId('mobile-sheet-item');

    expect(items.map((item) => item.getAttribute('data-item-id'))).toEqual(['view-data-source']);
    fireEvent.click(items[0]);
    expect(actions.open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('mobile-sheet')).toBeNull());
  });
});
