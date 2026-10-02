import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, useRef, useState } from 'react';

import { DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { ViewLayout } from '@/application/types';

import {
  DashboardContext,
  DashboardContextValue,
  DashboardLayoutContext,
  DashboardSourcesContext,
  DashboardSourcesContextValue,
} from '../DashboardContext';
import { LONG_PRESS_MS } from '../hooks/useLongPress';
import { WidgetActions, WidgetContext, WidgetContextValue } from '../WidgetContext';
import { WidgetHeaderFrame } from '../WidgetHeader';

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

jest.mock('../WidgetSettingsHost', () => ({
  WidgetSettingsHost: () => null,
}));

const widget = (id: string): DashboardWidget => ({ id, viewId: `view-${id}`, databaseId: 'db', width: 6 });
const ROWS: DashboardRow[] = [{ id: 'r1', height: 360, widgets: [widget('w1'), widget('w2')] }];

const DASHBOARD: DashboardContextValue = {
  dashboardViewId: 'dashboard',
  hostDatabaseId: 'db',
  canEdit: true,
  isEditing: true,
  setEditing: jest.fn(),
  mobileContext: false,
  canEnterEdit: true,
  editPreference: 'on',
  pinEditing: jest.fn(),
  updateSetting: jest.fn(),
  updateRows: jest.fn(),
};

const SOURCES: DashboardSourcesContextValue = {
  sourceDocs: {},
  registerSourceDoc: jest.fn(),
  sourceNames: { db: 'Projects' },
  registerSourceName: jest.fn(),
};

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

type HarnessProps = Partial<
  Pick<WidgetContextValue, 'editing' | 'showWidgetTitles' | 'showIcon' | 'name' | 'setDragHandle' | 'isDragging'>
> & { actions?: ReactNode };

/** A widget context whose menu state is real, as `DashboardWidget` keeps it. */
function Harness({ editing = false, showWidgetTitles = true, actions, ...overrides }: HarnessProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const value: WidgetContextValue = {
    widgetId: 'w1',
    databaseId: 'db',
    viewId: 'view-w1',
    name: 'Tasks Grid',
    icon: null,
    layout: ViewLayout.Grid,
    isEditing: editing,
    canEdit: true,
    editing,
    showWidgetTitles,
    showIcon: false,
    headerHeight: showWidgetTitles ? 40 : 0,
    isDragging: false,
    setDragHandle: jest.fn(),
    menuOpen,
    setMenuOpen,
    settingsOpen: false,
    setSettingsOpen: jest.fn(),
    getBoxElement: () => null,
    titleRef,
    optionsRef,
    actions: createActions(),
    ...overrides,
  };

  return (
    <DashboardContext.Provider value={{ ...DASHBOARD, isEditing: editing }}>
      <DashboardLayoutContext.Provider
        value={{ rows: ROWS, hostViewIds: [], showWidgetTitles, showIconsInHeading: false }}
      >
        <DashboardSourcesContext.Provider value={SOURCES}>
          <WidgetContext.Provider value={value}>
            <WidgetHeaderFrame actions={actions} />
          </WidgetContext.Provider>
        </DashboardSourcesContext.Provider>
      </DashboardLayoutContext.Provider>
    </DashboardContext.Provider>
  );
}

const pill = () => screen.getByTestId('dashboard-widget-title-button');

describe('WidgetHeaderFrame with titles', () => {
  it('renders a 40px band with a quiet 12px title pill named "Widget options"', () => {
    render(<Harness actions={<div data-testid='view-actions' />} />);
    const header = screen.getByTestId('dashboard-widget-header');

    expect(header.className).toContain('h-10');
    expect(header.className).toContain('px-2.5');
    expect(header.className).not.toContain('cursor-grab');
    expect(pill().tagName).toBe('BUTTON');
    expect(pill().getAttribute('aria-label')).toBe('Widget options');
    expect(pill().getAttribute('aria-haspopup')).toBe('menu');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    for (const name of ['text-xs', 'font-medium', 'rounded-600', 'px-2.5', 'py-1', 'text-dash-title']) {
      expect(pill().className).toContain(name);
    }

    expect(pill().getAttribute('aria-describedby')).toBe(screen.getByTestId('dashboard-widget-title').id);
    expect(screen.getByTestId('dashboard-widget-title').textContent).toBe('Tasks Grid');
    expect(within(header).getByTestId('view-actions')).toBeTruthy();
  });

  it('shows no icon unless "Show icons in heading" is on', () => {
    const { unmount } = render(<Harness />);

    expect(screen.queryByTestId('dashboard-widget-title-icon')).toBeNull();
    unmount();

    render(<Harness showIcon />);
    // The layout glyph itself is the 16px title icon (the parity probe measures its svg).
    const glyph = screen.getByTestId('dashboard-widget-title-icon');

    expect(glyph.tagName.toLowerCase()).toBe('svg');
    expect(glyph.getAttribute('class')).toContain('h-4 w-4');
    expect(screen.queryByTestId('page-icon')).toBeNull();
  });

  it('shows the view\'s own icon in the heading when it has one', () => {
    render(<Harness showIcon icon={{ ty: 0, value: '🚀' } as never} />);
    expect(within(screen.getByTestId('dashboard-widget-title-icon')).getByTestId('page-icon')).toBeTruthy();
  });

  it('names the source database and the view in its tooltip', async () => {
    render(<Harness />);

    act(() => pill().focus());
    const tooltip = await screen.findAllByTestId('dashboard-widget-source-tooltip');
    const text = tooltip.map((element) => element.textContent).join('');

    expect(text).toContain('Projects');
    expect(text).toContain('└');
    expect(text).toContain('Tasks Grid');
  });

  it('toggles the widget menu on click and gives the focus back to the pill when it closes', async () => {
    render(<Harness />);

    fireEvent.click(pill());
    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    expect(pill().getAttribute('data-state')).toBe('open');

    fireEvent.keyDown(screen.getByTestId('dashboard-widget-menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
    expect(document.activeElement).toBe(pill());

    fireEvent.click(pill());
    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
    fireEvent.click(pill());
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
  });

  it('opens the widget menu on a long touch', async () => {
    jest.useFakeTimers();
    try {
      render(<Harness />);
      // jsdom has no PointerEvent: a MouseEvent named after it carries the pointer type.
      const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });

      Object.defineProperty(press, 'pointerType', { value: 'touch' });
      fireEvent(pill(), press);
      act(() => {
        jest.advanceTimersByTime(LONG_PRESS_MS);
      });
    } finally {
      jest.useRealTimers();
    }

    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
  });

  it('turns blue in Edit mode, where the band is the drag handle, with no drag glyph and no more button', () => {
    const setDragHandle = jest.fn();

    render(<Harness editing setDragHandle={setDragHandle} />);
    const header = screen.getByTestId('dashboard-widget-header');

    expect(pill().className).toContain('text-dash-edit-title');
    expect(header.className).toContain('cursor-grab');
    expect(setDragHandle).toHaveBeenCalledWith(header);
    expect(header.style.height).toBe('');
    expect(screen.queryByTestId('dashboard-widget-menu-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-widget-options-button')).toBeNull();
    expect(header.querySelectorAll('svg')).toHaveLength(0);
  });
});

describe('WidgetHeaderFrame without titles', () => {
  it('floats a capsule with the tools and a "Widget options" button that opens the menu', async () => {
    render(<Harness actions={<div data-testid='view-actions' />} showWidgetTitles={false} />);
    const capsule = screen.getByTestId('dashboard-widget-tool-capsule');
    const options = screen.getByTestId('dashboard-widget-options-button');

    expect(screen.queryByTestId('dashboard-widget-header')).toBeNull();
    expect(screen.queryByTestId('dashboard-widget-title')).toBeNull();
    expect(capsule.className).toContain('absolute');
    expect(capsule.className).toContain('right-2');
    expect(capsule.className).toContain('top-2');
    // Hidden until hovered in View mode, like the tools.
    expect(capsule.className).toContain('opacity-0');
    expect(within(capsule).getByTestId('view-actions')).toBeTruthy();
    expect(options.getAttribute('aria-label')).toBe('Widget options');

    fireEvent.click(options);
    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('dashboard-widget-menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
    expect(document.activeElement).toBe(options);
  });

  it('keeps the capsule shown in Edit mode, as the drag handle', () => {
    const setDragHandle = jest.fn();

    render(<Harness editing setDragHandle={setDragHandle} showWidgetTitles={false} />);
    const capsule = screen.getByTestId('dashboard-widget-tool-capsule');

    expect(capsule.className).toContain('opacity-100');
    expect(capsule.className).toContain('cursor-grab');
    expect(setDragHandle).toHaveBeenCalledWith(capsule);
  });

  it('falls back to "untitled" for an unnamed view', () => {
    render(<Harness name='' />);

    expect(screen.getByTestId('dashboard-widget-title').textContent).toBe('untitled');
  });
});
