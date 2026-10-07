import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';

import { DatabaseViewLayout } from '@/application/types';

import { createAddWidgetFlowStore } from '../add-widget/add-widget-api';
import { DashboardSourcesContext } from '../DashboardContext';
import { DashboardUiContext } from '../DashboardUiContext';
import { WidgetSettingsTool } from '../widget-tool-buttons/WidgetSettingsTool';
import { WidgetContext, WidgetContextValue } from '../WidgetContext';
import { WidgetSettingsHost } from '../WidgetSettingsHost';

import { createDashboardUiValue, createWidgetActions, createWidgetContextValue } from './dashboardTestHarness';

let mockLayout: DatabaseViewLayout | null = DatabaseViewLayout.Grid;
let mockFilters: { id: string }[] = [];
let mockSorts: { id: string; fieldId: string }[] = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const mockWidgetDoc = { guid: 'widget-source-doc' };

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs/database.type'),
  useDatabaseContext: () => ({ databaseDoc: mockWidgetDoc }),
  useDatabaseViewLayout: () => mockLayout,
  useReadOnly: () => false,
  useConditionsReadOnly: () => false,
  useFiltersSelector: () => mockFilters,
  useSortsSelector: () => mockSorts,
  useFieldSelector: (fieldId: string) => ({
    field: fieldId ? { get: () => (fieldId === 'status' ? 'Status' : fieldId) } : undefined,
  }),
}));

function mockItems(name: string, rows: string[]) {
  const { DropdownMenuItem } = jest.requireActual('@/components/ui/dropdown-menu');

  return {
    [name]: () => (
      <>
        {rows.map((row) => (
          <DropdownMenuItem data-testid={`settings-row-${row}`} key={row}>
            {row}
          </DropdownMenuItem>
        ))}
      </>
    ),
  };
}

jest.mock('@/components/database/components/settings/GridSettings', () =>
  mockItems('GridSettingsItems', ['properties', 'layout', 'group'])
);
jest.mock('@/components/database/components/settings/BoardSettings', () =>
  mockItems('BoardSettingsItems', ['properties', 'layout', 'group'])
);
jest.mock('@/components/database/components/settings/CalendarSettings', () =>
  mockItems('CalendarSettingsItems', ['properties', 'layout', 'calendar'])
);
jest.mock('@/components/database/components/settings/ChartSettings', () =>
  mockItems('ChartSettingsItems', ['properties', 'layout', 'chart'])
);
jest.mock('@/components/database/components/settings/FeedSettings', () =>
  mockItems('FeedSettingsItems', ['properties', 'layout'])
);
jest.mock('@/components/database/components/settings/GallerySettings', () =>
  mockItems('GallerySettingsItems', ['properties', 'layout', 'gallery'])
);
jest.mock('@/components/database/components/settings/ListSettings', () =>
  mockItems('ListSettingsItems', ['properties', 'layout', 'group'])
);
jest.mock('@/components/database/components/settings/TimelineSettings', () =>
  mockItems('TimelineSettingsItems', ['properties', 'layout', 'timeline'])
);

let mockOpenPagesIn: unknown;
const mockSetOpenPagesIn = jest.fn();

jest.mock('@/application/database-yjs/dispatch/open-pages-in', () => ({
  useViewOpenPagesIn: () => mockOpenPagesIn,
  useSetViewOpenPagesIn: () => mockSetOpenPagesIn,
}));

jest.mock('../WidgetConditionsPopover', () => ({
  WidgetFiltersBody: () => <div data-testid='filters-body' />,
  WidgetSortsBody: () => <div data-testid='sorts-body' />,
}));

let actions = createWidgetActions();
let renameWidgetView = jest.fn().mockResolvedValue(true);
let flow = createAddWidgetFlowStore(() => undefined);

/**
 * How the settings tool sits in the box: the real tool (`WidgetSettingsTool`,
 * which attaches the widget's `settingsToolRef`), a stand-in that attaches
 * the ref, or a stand-in that only sits in its slot of the box.
 */
type SettingsTool = 'real' | 'ref' | 'slot';

/** The widget box with its settings tool, and the settings state `DashboardWidget` keeps. */
function Harness({ editing = true, tool = 'slot' }: { editing?: boolean; tool?: SettingsTool }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const settingsToolRef = useRef<HTMLButtonElement>(null);
  const getBoxElement = useCallback(() => boxRef.current, []);
  const value: WidgetContextValue = createWidgetContextValue({
    viewId: 'v1',
    editing,
    settingsOpen,
    setSettingsOpen,
    getBoxElement,
    settingsToolRef,
    actions: { ...actions, openSettings: () => setSettingsOpen(true) },
  });

  const [ui] = useState(() => {
    const base = createDashboardUiValue();

    return { ...base, ownedViews: { ...base.ownedViews, renameWidgetView }, addWidget: { ...base.addWidget, flow } };
  });

  return (
    <DashboardUiContext.Provider value={ui}>
      <DashboardSourcesContext.Provider
        value={{
          sourceDocs: {},
          registerSourceDoc: jest.fn(),
          sourceNames: { db: 'Projects' },
          registerSourceName: jest.fn(),
        }}
      >
        <WidgetContext.Provider value={value}>
          <div className='relative' data-testid='dashboard-widget' ref={boxRef}>
            {/* The tool as `WidgetTools` renders it: in its slot, toggling the host. */}
            <div data-widget-tool={tool === 'ref' ? undefined : 'settings'}>
              {tool === 'real' ? (
                <WidgetSettingsTool />
              ) : (
                <button
                  data-testid='dashboard-widget-settings-button'
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  ref={tool === 'ref' ? settingsToolRef : undefined}
                  type='button'
                />
              )}
            </div>
            <button data-testid='elsewhere' type='button' />
            <WidgetSettingsHost />
          </div>
        </WidgetContext.Provider>
      </DashboardSourcesContext.Provider>
    </DashboardUiContext.Provider>
  );
}

async function openHost() {
  fireEvent.click(screen.getByTestId('dashboard-widget-settings-button'));
  return screen.findByTestId('dashboard-widget-settings');
}

const rowIds = (host: HTMLElement) =>
  within(host)
    .getAllByRole('menuitem')
    .map((item) => item.getAttribute('data-testid'));

beforeEach(() => {
  mockOpenPagesIn = undefined;
  mockSetOpenPagesIn.mockReset();
  mockLayout = DatabaseViewLayout.Grid;
  mockFilters = [];
  mockSorts = [];
  actions = createWidgetActions();
  renameWidgetView = jest.fn().mockResolvedValue(true);
  flow = createAddWidgetFlowStore(() => undefined);
});

describe('WidgetSettingsHost', () => {
  it('opens docked to the widget box, 300px wide, with the "View settings" header', async () => {
    render(<Harness />);
    const host = await openHost();

    // WP06 §1.6: the same dock as the add flow's panels (jsdom has no width: the box ends at 0, room on the right).
    expect(host.getAttribute('data-side')).toBe('right');
    expect(host.getAttribute('data-align')).toBe('start');
    // `tokens.json` `geometry.popover`: `widgetSettingsWidth` and `radius`.
    expect(host.style.width).toBe('300px');
    expect(host.style.minWidth).toBe('300px');
    expect(host.style.borderRadius).toBe('10px');
    expect(host.className).toContain('max-h-[560px]');
    expect(host.textContent).toContain('View settings');
    expect(within(host).getByTestId('dashboard-widget-settings-close').getAttribute('aria-label')).toBe('Close');
    // Its trigger is a zero-size anchor portaled into the widget box's top-right corner.
    const anchor = screen.getByTestId('dashboard-widget').querySelector('[aria-haspopup="menu"]') as HTMLElement;

    expect(anchor.getAttribute('class')).toContain('right-0 top-0 h-0 w-0');
  });

  it('opens on the left of a widget at the right edge of the window', async () => {
    render(<Harness />);
    const box = screen.getByTestId('dashboard-widget');

    box.getBoundingClientRect = () => ({
      right: window.innerWidth - 20,
      left: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const host = await openHost();

    await waitFor(() => expect(host.getAttribute('data-side')).toBe('left'));
  });

  it('holds the widget name in its header and renames the view from it (WP05)', async () => {
    render(<Harness />);
    const host = await openHost();
    const input = within(host).getByTestId<HTMLInputElement>('dashboard-widget-view-name-input');

    expect(input.value).toBe('Tasks Grid');
    fireEvent.change(input, { target: { value: 'Pipeline board' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameWidgetView).toHaveBeenCalledWith('w1', 'Pipeline board', { name: 'Tasks Grid', doc: mockWidgetDoc });
    // The host stays open.
    expect(screen.getByTestId('dashboard-widget-settings')).toBeTruthy();
  });

  it('keeps itself open on the Escape that reverts the name', async () => {
    render(<Harness />);
    const host = await openHost();
    const input = within(host).getByTestId<HTMLInputElement>('dashboard-widget-view-name-input');

    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Typo' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Tasks Grid');
    expect(screen.getByTestId('dashboard-widget-settings')).toBeTruthy();
    expect(renameWidgetView).not.toHaveBeenCalled();
  });

  it('goes back to the New view panel when the add flow opened it (Edit chart)', async () => {
    const dispatch = jest.spyOn(flow, 'dispatch');

    flow.dispatch({ type: 'start', placement: { type: 'new_row' }, widgetId: 'w1', spec: 'chart', refused: null });
    flow.dispatch({ type: 'created', viewId: 'v1' });
    flow.dispatch({ type: 'pick_layout', layout: DatabaseViewLayout.Chart });
    flow.dispatch({ type: 'edit_chart' });
    render(<Harness />);
    const host = await openHost();

    fireEvent.click(within(host).getByTestId('dashboard-widget-settings-back'));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'back' });
    expect(flow.getState().kind).toBe('configuring');
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-settings')).toBeNull());
  });

  it('offers no back button when it was not opened by the add flow', async () => {
    render(<Harness />);
    const host = await openHost();

    expect(within(host).queryByTestId('dashboard-widget-settings-back')).toBeNull();
  });

  it('lists the view settings rows, Filter, Sort and Open pages in, then the Source', async () => {
    mockFilters = [{ id: 'f1' }, { id: 'f2' }];
    mockSorts = [{ id: 's1', fieldId: 'status' }];
    render(<Harness />);
    const host = await openHost();

    // WP13 §3.8: "Open pages in ›" sits after Sort, before the divider and Source.
    expect(rowIds(host)).toEqual([
      'settings-row-properties',
      'settings-row-layout',
      'settings-row-group',
      'dashboard-widget-settings-filter',
      'dashboard-widget-settings-sort',
      'dashboard-widget-settings-open-pages-in',
      'dashboard-widget-settings-source',
    ]);
    expect(within(host).getByTestId('dashboard-widget-settings-filter').textContent).toContain('2');
    expect(within(host).getByTestId('dashboard-widget-settings-sort').textContent).toContain('Status');
    expect(within(host).getByTestId('dashboard-widget-settings-source').textContent).toContain('Projects');
  });

  it('draws "Source ›" like a submenu row: name, trailing source and a 16px chevron', async () => {
    render(<Harness />);
    const host = await openHost();
    const source = within(host).getByTestId('dashboard-widget-settings-source');
    const parts = Array.from(source.querySelectorAll('[data-parity-id]')).map((part) =>
      part.getAttribute('data-parity-id')
    );

    expect(parts).toEqual([
      'dash-widget-settings-row__label',
      'dash-widget-settings-row__value',
      'dash-widget-settings-row__chevron',
    ]);
    const chevron = source.querySelector('[data-parity-id="dash-widget-settings-row__chevron"]') as Element;

    expect(source.lastElementChild).toBe(chevron);
    expect(chevron.getAttribute('class')).toContain('!h-4 !w-4');
    // A trailing value is secondary text beside the chevron and the parts of a row are 8px apart.
    expect(host.className).toContain('[&_[data-slot=dropdown-menu-sub-trigger]>.ml-auto+svg]:!ml-0');
    expect(host.className).toContain('[&_[role=menuitem]>.ml-auto]:!text-text-secondary');
    expect(host.className).toContain('[&_[role=menuitem]]:!gap-2');
  });

  it('leaves Sort out where the widget cannot sort (a chart)', async () => {
    mockLayout = DatabaseViewLayout.Chart;
    render(<Harness />);
    const host = await openHost();

    expect(rowIds(host)).toEqual([
      'settings-row-properties',
      'settings-row-layout',
      'settings-row-chart',
      'dashboard-widget-settings-filter',
      'dashboard-widget-settings-source',
    ]);
  });

  it('shows the resolved "Open pages in" value of the widget\'s view, Side peek while none is stored', async () => {
    render(<Harness />);
    let host = await openHost();

    expect(within(host).getByTestId('dashboard-widget-settings-open-pages-in').textContent).toContain('Open pages in');
    expect(within(host).getByTestId('dashboard-widget-settings-open-pages-in').textContent).toContain('Side peek');
    fireEvent.click(within(host).getByTestId('dashboard-widget-settings-close'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-settings')).toBeNull());

    mockOpenPagesIn = 'center_peek';
    host = await openHost();
    expect(within(host).getByTestId('dashboard-widget-settings-open-pages-in').textContent).toContain('Center peek');
  });

  it('changes the source from the Source row', async () => {
    render(<Harness />);
    const host = await openHost();

    fireEvent.click(within(host).getByTestId('dashboard-widget-settings-source'));
    expect(actions.changeView).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the Settings tool', 'real'],
    ['the tool attached to the widget (settingsToolRef)', 'ref'],
    ['the tool in its slot of the box', 'slot'],
  ] as const)('closes from its round close button and gives the focus back to %s', async (_name, tool) => {
    render(<Harness tool={tool} />);
    const host = await openHost();

    fireEvent.click(within(host).getByTestId('dashboard-widget-settings-close'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-settings')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('dashboard-widget-settings-button'));
  });

  it('leaves the focus in the panel the Source row handed over to', async () => {
    const panel = document.createElement('input');

    panel.setAttribute('data-testid', 'source-panel-search');
    jest.mocked(actions.changeView).mockImplementation(() => {
      // Settings › Source docks its panel in the same commit, and the panel focuses its search.
      document.body.appendChild(panel);
      panel.focus();
    });
    render(<Harness />);
    const host = await openHost();

    fireEvent.click(within(host).getByTestId('dashboard-widget-settings-source'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-settings')).toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(panel);
    panel.remove();
  });

  it.each([
    ['the Settings tool', 'real'],
    ['the tool attached to the widget (settingsToolRef)', 'ref'],
    ['the tool in its slot of the box', 'slot'],
  ] as const)('leaves a press on %s to the tool, which toggles the host itself', async (_name, toolKind) => {
    render(<Harness tool={toolKind} />);
    await openHost();
    // Radix starts listening for outside presses a tick after the host opened.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const tool = screen.getByTestId('dashboard-widget-settings-button');

    // Not an outside press: otherwise the press would close the host and the click reopen it.
    fireEvent.pointerDown(tool);
    expect(screen.getByTestId('dashboard-widget-settings')).toBeTruthy();
    fireEvent.click(tool);
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-settings')).toBeNull());
  });

  it('closes on a press anywhere else', async () => {
    render(<Harness tool='ref' />);
    await openHost();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    fireEvent.pointerDown(screen.getByTestId('elsewhere'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-settings')).toBeNull());
  });

  it('shows the Source row alone while the view has no layout yet', async () => {
    mockLayout = null;
    render(<Harness />);
    const host = await openHost();

    expect(rowIds(host)).toEqual(['dashboard-widget-settings-source']);
  });

  it('does not exist outside Edit mode', () => {
    render(<Harness editing={false} />);

    act(() => screen.getByTestId('dashboard-widget-settings-button').click());
    expect(screen.queryByTestId('dashboard-widget-settings')).toBeNull();
  });
});
