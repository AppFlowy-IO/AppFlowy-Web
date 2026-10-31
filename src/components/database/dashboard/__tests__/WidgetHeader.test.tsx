import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, useRef, useState } from 'react';

import { DashboardRow, DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { ViewLayout } from '@/application/types';

import {
  DashboardContext,
  DashboardLayoutContext,
  DashboardSourcesContext,
  DashboardSourcesContextValue,
} from '../DashboardContext';
import { LONG_PRESS_MS } from '../hooks/useLongPress';
import { WIDGET_TOOL_SLOT_CLASS } from '../widget-tools';
import { WidgetContext, WidgetContextValue } from '../WidgetContext';
import { WidgetHeaderFrame } from '../WidgetHeader';

import { createDashboardContextValue, createWidgetContextValue } from './dashboardTestHarness';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: ({ view }: { view: { layout: ViewLayout } }) => <span data-layout={view.layout} data-testid='page-icon' />,
}));

jest.mock('../widget-tool-buttons/WidgetActions', () => ({
  WidgetActions: () => <div data-testid='database-actions' />,
}));

jest.mock('../WidgetSettingsHost', () => ({
  WidgetSettingsHost: () => null,
}));

const widget = (id: string): DashboardWidget => ({ id, viewId: `view-${id}`, databaseId: 'db', width: 6 });
const ROWS: DashboardRow[] = [{ id: 'r1', height: 360, widgets: [widget('w1'), widget('w2')] }];

const DASHBOARD = createDashboardContextValue({ dashboardViewId: 'dashboard', isEditing: true });

const SOURCES: DashboardSourcesContextValue = {
  sourceDocs: {},
  registerSourceDoc: jest.fn(),
  sourceNames: { db: 'Projects' },
  registerSourceName: jest.fn(),
};

type HarnessProps = Partial<
  Pick<WidgetContextValue, 'editing' | 'showWidgetTitles' | 'showIcon' | 'name' | 'setDragHandle' | 'isDragging'>
> & { actions?: ReactNode };

/** A widget context whose menu state is real, as `DashboardWidget` keeps it. */
function Harness({ editing = false, showWidgetTitles = true, actions, ...overrides }: HarnessProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const settingsToolRef = useRef<HTMLButtonElement>(null);
  const value: WidgetContextValue = createWidgetContextValue({
    layout: ViewLayout.Grid,
    editing,
    showWidgetTitles,
    headerHeight: showWidgetTitles ? 40 : 0,
    menuOpen,
    setMenuOpen,
    titleRef,
    optionsRef,
    settingsToolRef,
    ...overrides,
  });

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
    const setDragHandle = jest.fn();

    render(<Harness actions={<div data-testid='view-actions' />} setDragHandle={setDragHandle} />);
    const header = screen.getByTestId('dashboard-widget-header');

    // The band's size comes from the tokens (`geometry.widget.headerHeight` and its paddings).
    expect(header.style.height).toBe('40px');
    expect(header.style.padding).toBe('2px 10px');
    // View mode: the band is no drag handle.
    expect(setDragHandle).not.toHaveBeenCalledWith(header);
    expect(pill().tagName).toBe('BUTTON');
    expect(pill().getAttribute('aria-label')).toBe('Widget options');
    expect(pill().getAttribute('aria-haspopup')).toBe('menu');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    // The band, the pill and its label the parity probe measures (the 12px label, its radius and padding).
    expect(header.getAttribute('data-parity-id')).toBe('dash-widget-header');
    expect(pill().getAttribute('data-parity-id')).toBe('dash-widget-title-pill');
    expect(screen.getByTestId('dashboard-widget-title').getAttribute('data-parity-id')).toBe(
      'dash-widget-title-pill__label'
    );
    expect(pill().getAttribute('type')).toBe('button');
    expect(pill().getAttribute('data-state')).toBe('closed');
    // A quiet label: the text alone, no glyph.
    expect(pill().querySelectorAll('svg')).toHaveLength(0);

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
    // In the pill, before its label.
    expect(glyph.nextElementSibling).toBe(screen.getByTestId('dashboard-widget-title'));
    // The shared layout glyph (`ViewIcon`) carries the probe's id and stays out of the accessible name.
    expect(glyph.getAttribute('data-parity-id')).toBe('dash-widget-title-pill__icon');
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByTestId('page-icon')).toBeNull();
  });

  it("shows the view's own icon in the heading when it has one", () => {
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

  // jsdom has no PointerEvent: a MouseEvent named after it carries the pointer type.
  function touch(type: 'pointerdown' | 'pointerup') {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });

    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    return event;
  }

  function longPress() {
    jest.useFakeTimers();
    try {
      fireEvent(pill(), touch('pointerdown'));
      act(() => {
        jest.advanceTimersByTime(LONG_PRESS_MS);
      });
    } finally {
      jest.useRealTimers();
    }
  }

  it('opens the widget menu on a long touch', async () => {
    render(<Harness />);
    longPress();

    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
  });

  it('keeps the menu open when the released long touch also sends a click', async () => {
    render(<Harness />);
    longPress();
    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();

    // Safari on iOS sends the click of the press; it must not toggle the menu shut.
    fireEvent(pill(), touch('pointerup'));
    expect(fireEvent.click(pill())).toBe(false);
    expect(screen.getByTestId('dashboard-widget-menu')).toBeTruthy();
    expect(pill().getAttribute('aria-expanded')).toBe('true');

    // Only that one click is swallowed: the next one toggles as usual.
    fireEvent.click(pill());
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
  });

  it('does not swallow the click of a long touch that was released without one', async () => {
    render(<Harness />);
    longPress();
    expect(await screen.findByTestId('dashboard-widget-menu')).toBeTruthy();
    fireEvent(pill(), touch('pointerup'));

    // Android sends no click after a long press. The next press, a mouse click, closes the menu.
    fireEvent.pointerDown(pill());
    fireEvent.click(pill());
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-menu')).toBeNull());
  });

  it('turns blue in Edit mode, where the band is the drag handle, with no drag glyph and no more button', () => {
    const setDragHandle = jest.fn();
    const { rerender } = render(<Harness setDragHandle={setDragHandle} />);
    const viewModeLook = pill().className;

    expect(setDragHandle).not.toHaveBeenCalledWith(screen.getByTestId('dashboard-widget-header'));
    rerender(<Harness editing setDragHandle={setDragHandle} />);
    const header = screen.getByTestId('dashboard-widget-header');

    // Edit mode alone restyles the pill (the accent title).
    expect(pill().className).not.toBe(viewModeLook);
    expect(setDragHandle).toHaveBeenCalledWith(header);
    // The same 40px band as in View mode: Edit mode never changes a size.
    expect(header.style.height).toBe('40px');
    expect(screen.queryByTestId('dashboard-widget-menu-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-widget-options-button')).toBeNull();
    expect(header.querySelectorAll('svg')).toHaveLength(0);
  });
});

describe('WidgetHeaderFrame without titles', () => {
  it('floats a capsule with the tools and a "Widget options" button that opens the menu', async () => {
    const setDragHandle = jest.fn();

    render(
      <Harness actions={<div data-testid='view-actions' />} setDragHandle={setDragHandle} showWidgetTitles={false} />
    );
    const capsule = screen.getByTestId('dashboard-widget-tool-capsule');
    const options = screen.getByTestId('dashboard-widget-options-button');

    expect(screen.queryByTestId('dashboard-widget-header')).toBeNull();
    expect(screen.queryByTestId('dashboard-widget-title')).toBeNull();
    // The capsule the parity probe measures in the card's top-right corner, holding the options button.
    expect(capsule.getAttribute('data-parity-id')).toBe('dash-widget-capsule');
    expect(options.closest('[data-testid="dashboard-widget-tool-capsule"]')).toBe(capsule);
    expect(setDragHandle).not.toHaveBeenCalledWith(capsule);
    // Hidden until hovered in View mode: the tools' tested visibility rule.
    expect(capsule.className).toContain(WIDGET_TOOL_SLOT_CLASS);
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

    // Always shown: the hover rule no longer applies.
    expect(capsule.className).not.toContain(WIDGET_TOOL_SLOT_CLASS);
    expect(capsule.getAttribute('data-parity-id')).toBe('dash-widget-capsule');
    expect(setDragHandle).toHaveBeenCalledWith(capsule);
  });

  it('falls back to "untitled" for an unnamed view', () => {
    render(<Harness name='' />);

    expect(screen.getByTestId('dashboard-widget-title').textContent).toBe('untitled');
  });

  it('keeps the capsule shown in View mode while its search field is expanded (WP09)', () => {
    render(<Harness showWidgetTitles={false} />);

    expect(screen.getByTestId('dashboard-widget-tool-capsule').className).toContain(
      'has-[[data-search-active=true]]:opacity-100'
    );
  });
});

describe('WidgetHeaderFrame and the widget search (WP09 §1.2)', () => {
  it('makes the band the size container its expanded search field measures 45% of', () => {
    render(<Harness actions={<div data-testid='view-actions' />} />);

    expect(screen.getByTestId('dashboard-widget-header').style.containerType).toBe('inline-size');
  });
});
