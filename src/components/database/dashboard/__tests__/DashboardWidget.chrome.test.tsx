import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { DashboardWidget } from '../DashboardWidget';

import { createWidgetHost, DashboardWidgetProviders, widgetBoxProps } from './dashboardTestHarness';

const mockEmbeddedHeights: number[] = [];

jest.mock('react-i18next', () => {
  const t = (key: string) => key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({ DropIndicator: () => null }));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
// The nested database: a probe of the widget's mode, menu and settings state,
// an input, and an element that handles its own context menu.
jest.mock('@/components/database', () => ({
  Database: ({ embeddedHeight }: { embeddedHeight?: number }) => {
    const { useWidgetContext } = jest.requireActual<typeof import('../WidgetContext')>('../WidgetContext');
    const widget = useWidgetContext();

    mockEmbeddedHeights.push(embeddedHeight ?? -1);
    return (
      <div data-testid='widget-surface'>
        <output data-testid='widget-editing'>{String(widget.editing)}</output>
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

/** The widget box on a dashboard, with the dashboard's real selection. */
function Harness({ editing, showWidgetTitles = true }: { editing: boolean; showWidgetTitles?: boolean }) {
  const [host] = useState(() => createWidgetHost());

  return (
    <DashboardWidgetProviders editing={editing} host={host}>
      <DashboardWidget {...widgetBoxProps({ isEditing: editing, showWidgetTitles })} />
    </DashboardWidgetProviders>
  );
}

const box = () => screen.getByTestId('dashboard-widget');
/** Top, right, bottom and left padding of the box. */
const paddingOf = (element: HTMLElement) => [
  element.style.paddingTop,
  element.style.paddingRight,
  element.style.paddingBottom,
  element.style.paddingLeft,
];
const menuOpen = () => screen.getByTestId('menu-open').textContent;

beforeEach(() => {
  mockEmbeddedHeights.length = 0;
});

describe('DashboardWidget chrome', () => {
  it('is a padded box, tinted only in Edit mode', () => {
    const { rerender } = render(<Harness editing={false} />);

    expect(box().getAttribute('data-editing')).toBe('false');
    // The box the visual-parity probe measures (radius, tint), and the mode its content follows.
    expect(box().getAttribute('data-parity-id')).toBe('dash-widget-box');
    expect(screen.getByTestId('widget-editing').textContent).toBe('false');

    // `0 6 6` around the card: the header band stands in for the top padding.
    expect(paddingOf(box())).toEqual(['0px', '6px', '6px', '6px']);

    rerender(<Harness editing />);
    expect(box().getAttribute('data-editing')).toBe('true');
    expect(screen.getByTestId('widget-editing').textContent).toBe('true');
    expect(paddingOf(box())).toEqual(['0px', '6px', '6px', '6px']);
  });

  it('pads the top of the box when titles are hidden', () => {
    render(<Harness editing={false} showWidgetTitles={false} />);

    expect(paddingOf(box())).toEqual(['6px', '6px', '6px', '6px']);
  });

  it('animates its tint and outline only, never its width, and nothing under reduced motion', () => {
    render(<Harness editing />);
    const classes = box().className.split(' ');

    expect(classes).toContain('transition-[background-color,box-shadow]');
    expect(classes).toContain('duration-[var(--dash-motion-fast)]');
    expect(classes).toContain('ease-[var(--dash-motion-ease)]');
    expect(classes).toContain('motion-reduce:transition-none');
    // A layout change resizes the box at once: animating `flex-basis` would re-lay out the row and
    // resize every nested database on each frame. No other transition class may out-rank the
    // reduced-motion one either.
    expect(box().className).not.toContain('flex-basis');
    expect(classes.filter((name) => name.includes('transition-'))).toEqual([
      'transition-[background-color,box-shadow]',
      'motion-reduce:transition-none',
    ]);
  });

  it('is outlined in Edit mode while its menu or its settings are open', () => {
    render(<Harness editing />);

    expect(box().hasAttribute('data-selected')).toBe(false);
    fireEvent.click(screen.getByTestId('open-menu'));
    expect(box().getAttribute('data-selected')).toBe('true');
    // The outline is the open menu's: it goes when the menu closes.
    expect(menuOpen()).toBe('true');
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
