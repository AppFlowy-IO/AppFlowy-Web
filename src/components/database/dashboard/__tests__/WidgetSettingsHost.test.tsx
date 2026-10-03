import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';

import { DatabaseViewLayout } from '@/application/types';

import { DashboardSourcesContext } from '../DashboardContext';
import { WidgetSettingsTool } from '../widget-tool-buttons/WidgetSettingsTool';
import { WidgetContext, WidgetContextValue } from '../WidgetContext';
import { WidgetSettingsHost } from '../WidgetSettingsHost';

import { createWidgetActions, createWidgetContextValue } from './dashboardTestHarness';

let mockLayout: DatabaseViewLayout | null = DatabaseViewLayout.Grid;
let mockFilters: { id: string }[] = [];
let mockSorts: { id: string; fieldId: string }[] = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs/database.type'),
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

jest.mock('../WidgetConditionsPopover', () => ({
  WidgetFiltersBody: () => <div data-testid='filters-body' />,
  WidgetSortsBody: () => <div data-testid='sorts-body' />,
}));

let actions = createWidgetActions();

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

  return (
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
  mockLayout = DatabaseViewLayout.Grid;
  mockFilters = [];
  mockSorts = [];
  actions = createWidgetActions();
});

describe('WidgetSettingsHost', () => {
  it('opens beside the widget box, 300px wide, with the "View settings" header', async () => {
    render(<Harness />);
    const host = await openHost();

    expect(host.getAttribute('data-side')).toBe('right');
    expect(host.getAttribute('data-align')).toBe('start');
    // `tokens.json` `geometry.popover`: `widgetSettingsWidth` and `radius`.
    expect(host.style.width).toBe('300px');
    expect(host.style.minWidth).toBe('300px');
    expect(host.style.borderRadius).toBe('10px');
    expect(host.className).toContain('max-h-[560px]');
    expect(host.textContent).toContain('View settings');
    expect(within(host).getByTestId('dashboard-widget-settings-close').getAttribute('aria-label')).toBe('Close');
    // Its trigger is portaled into the widget box, which anchors it.
    expect(screen.getByTestId('dashboard-widget').querySelector('[aria-haspopup="menu"]')).not.toBeNull();
  });

  it('lists the view settings rows, Filter and Sort, then the Source', async () => {
    mockFilters = [{ id: 'f1' }, { id: 'f2' }];
    mockSorts = [{ id: 's1', fieldId: 'status' }];
    render(<Harness />);
    const host = await openHost();

    expect(rowIds(host)).toEqual([
      'settings-row-properties',
      'settings-row-layout',
      'settings-row-group',
      'dashboard-widget-settings-filter',
      'dashboard-widget-settings-sort',
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
