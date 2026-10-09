import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';

import { DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { ViewLayout } from '@/application/types';

import { createDashboardContextValue, createWidgetContextValue } from '../../__tests__/dashboardTestHarness';
import { DashboardContext, DashboardLayoutContext, DashboardSourcesContext } from '../../DashboardContext';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
import { WidgetActions, WidgetContext } from '../../WidgetContext';
import { WidgetHeaderFrame } from '../../WidgetHeader';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: () => <span data-testid='page-icon' />,
}));

const widget = (id: string): DashboardWidget => ({ id, viewId: `view-${id}`, databaseId: 'db', width: 6 });
const ROWS: DashboardRow[] = [{ id: 'r1', height: 360, widgets: [widget('w1'), widget('w2')] }];

/** A phone's widget header whose menu state is real, as the widget box keeps it. */
function Harness({
  actions,
  showWidgetTitles = true,
  log,
}: {
  actions: WidgetActions;
  showWidgetTitles?: boolean;
  log?: string[];
}) {
  const [menuOpen, setMenuOpenState] = useState(false);

  const setMenuOpen = (open: boolean) => {
    log?.push(`menu:${open}`);
    setMenuOpenState(open);
  };

  const titleRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);

  return (
    <DashboardContext.Provider value={createDashboardContextValue({ mobileContext: true, canEnterEdit: false })}>
      <DashboardLayoutContext.Provider
        value={{ rows: ROWS, hostViewIds: [], showWidgetTitles, showIconsInHeading: false }}
      >
        <DashboardSourcesContext.Provider
          value={{ sourceDocs: {}, registerSourceDoc: jest.fn(), sourceNames: {}, registerSourceName: jest.fn() }}
        >
          <WidgetContext.Provider
            value={createWidgetContextValue({
              name: 'Projects Board',
              layout: ViewLayout.Board,
              mobileContext: true,
              showWidgetTitles,
              headerHeight: showWidgetTitles ? 40 : 0,
              menuOpen,
              setMenuOpen,
              titleRef,
              optionsRef,
              actions,
            })}
          >
            <WidgetHeaderFrame actions={<div data-testid='view-actions' />} />
          </WidgetContext.Provider>
        </DashboardSourcesContext.Provider>
      </DashboardLayoutContext.Provider>
    </DashboardContext.Provider>
  );
}

function createActions(): WidgetActions {
  return {
    open: jest.fn(),
    changeView: jest.fn(),
    duplicate: jest.fn(),
    remove: jest.fn(),
    move: jest.fn(),
    openSettings: jest.fn(),
  };
}

const pill = () => screen.getByTestId('dashboard-widget-title-button');
const sheet = () => screen.queryByTestId('mobile-sheet');

function expectOnlyViewDataSource() {
  const open = screen.getByTestId('mobile-sheet');

  expect(open.getAttribute('data-sheet')).toBe('widget-menu');
  expect(within(open).getByTestId('mobile-sheet-title').textContent).toBe('Projects Board');
  const items = within(open).getAllByTestId('mobile-sheet-item');

  expect(items.map((item) => item.getAttribute('data-item-id'))).toEqual(['view-data-source']);
  expect(items[0].textContent).toBe('View data source');
  // The ↗ glyph leads the row.
  expect(items[0].querySelector('svg')).toBeTruthy();
  // No dropdown menu on a phone.
  expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull();
}

// jsdom has no PointerEvent: a MouseEvent named after it carries the pointer type.
function touch(type: 'pointerdown' | 'pointerup') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });

  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
}

describe('WidgetMenuSheet (the widget menu on a phone)', () => {
  it('opens from a title tap as a sheet titled with the widget name, offering only View data source', () => {
    render(<Harness actions={createActions()} />);

    // Nothing hovers on a phone: the title announces a dialog and shows no breadcrumb tooltip.
    expect(pill().getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(pill());
    expectOnlyViewDataSource();
  });

  it('opens on a 500ms long press of the title', () => {
    render(<Harness actions={createActions()} />);
    jest.useFakeTimers();
    try {
      fireEvent(pill(), touch('pointerdown'));
      act(() => {
        jest.advanceTimersByTime(LONG_PRESS_MS - 1);
      });
      expect(sheet()).toBeNull();
      act(() => {
        jest.advanceTimersByTime(1);
      });
    } finally {
      jest.useRealTimers();
    }

    fireEvent(pill(), touch('pointerup'));
    expectOnlyViewDataSource();
  });

  it("opens from the hidden-title capsule's Widget options button", () => {
    render(<Harness actions={createActions()} showWidgetTitles={false} />);
    const capsule = screen.getByTestId('dashboard-widget-tool-capsule');

    // The capsule always shows on a phone.
    expect(capsule.className).toContain('opacity-100');
    fireEvent.click(screen.getByTestId('dashboard-widget-options-button'));
    expectOnlyViewDataSource();
  });

  it('closes the sheet first, then opens the data source', async () => {
    const actions = createActions();
    const log: string[] = [];

    (actions.open as jest.Mock).mockImplementation(() => log.push('open'));
    render(<Harness actions={actions} log={log} />);
    fireEvent.click(pill());
    fireEvent.click(screen.getByTestId('mobile-sheet-item'));

    expect(log).toEqual(['menu:true', 'menu:false', 'open']);
    await waitFor(() => expect(sheet()).toBeNull());
  });

  it('closes on the sheet close button without running anything', async () => {
    const actions = createActions();

    render(<Harness actions={actions} />);
    fireEvent.click(pill());
    fireEvent.click(screen.getByTestId('mobile-sheet-close'));
    await waitFor(() => expect(sheet()).toBeNull());
    expect(actions.open).not.toHaveBeenCalled();
  });
});
