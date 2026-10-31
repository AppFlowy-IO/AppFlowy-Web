import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import en from '@/@types/translations/en.json';
import type { DatabaseContextState } from '@/application/database-yjs/context';
import type { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import type { ChartDrillTarget } from '@/application/database-yjs/drill-query';
import { OPEN_PAGES_IN_KEY } from '@/application/database-yjs/open-pages-in';
import { UIVariant, YjsDatabaseKey } from '@/application/types';
import { DashboardFiltersContext, DashboardFiltersContextValue } from '@/components/database/dashboard/DashboardContext';

import { ChartDrillDialog } from '../ChartDrillDialog';

import {
  contextOf,
  createDrillFixture,
  DatabaseWrapper,
  DrillFixture,
  selectFilterPlain,
  toYFilter,
} from './drillTestFixture';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

// English copy from en.json, with i18next's `_one` / `_other` plurals and `{{x}}` interpolation.
jest.mock('react-i18next', () => {
  const translations = jest.requireActual('@/@types/translations/en.json');
  const lookup = (key: string) =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], translations);
  const t = (key: string, options: Record<string, unknown> = {}) => {
    const count = options.count as number | undefined;
    const plural = count === undefined ? undefined : lookup(`${key}_${count === 1 ? 'one' : 'other'}`);
    const text = (plural ?? lookup(key) ?? options.defaultValue ?? key) as string;

    return typeof text === 'string'
      ? text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''))
      : key;
  };

  return { useTranslation: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

let mockForceLoading = false;

jest.mock('../useDrillRows', () => {
  const actual = jest.requireActual('../useDrillRows');

  return {
    useDrillRows: (args: Parameters<typeof actual.useDrillRows>[0]) =>
      mockForceLoading ? { rows: undefined, loading: true } : actual.useDrillRows(args),
  };
});

const BLOCKER: ChartDrillTarget = { xKey: 'o_blocker', xLabel: 'Blocker', xIsEmpty: false, rowIds: ['r1', 'r2'] };

function renderDrill({
  fixture = createDrillFixture(),
  target = BLOCKER,
  title = 'Blocker',
  context = {},
  globals,
}: {
  fixture?: DrillFixture;
  target?: ChartDrillTarget;
  title?: string;
  context?: Partial<DatabaseContextState>;
  globals?: DashboardGlobalFilter[];
} = {}) {
  const onClose = jest.fn();
  const navigateToRow = jest.fn();
  const navigateToView = jest.fn().mockResolvedValue(undefined);
  const value = contextOf(fixture, {
    navigateToRow,
    navigateToView,
    getViewIdFromDatabaseId: jest.fn().mockResolvedValue('container'),
    loadViewMeta: jest.fn().mockImplementation(async (viewId: string) => ({
      view_id: viewId,
      name: 'Bug Tracker',
      extra: { is_database_container: true },
    })),
    ...context,
  });
  const dialog = <ChartDrillDialog onClose={onClose} target={target} title={title} />;
  const tree = (
    <DatabaseWrapper value={value}>
      {globals ? (
        <DashboardFiltersContext.Provider
          value={{ effectiveGlobalFilters: globals } as unknown as DashboardFiltersContextValue}
        >
          {dialog}
        </DashboardFiltersContext.Provider>
      ) : (
        dialog
      )}
    </DatabaseWrapper>
  );

  return { ...render(tree), onClose, navigateToRow, navigateToView, fixture };
}

const drill = () => screen.getByTestId('chart-drilldown');
// Radix opens a dropdown on Enter (jsdom has no PointerEvent for its pointerdown).
const openMore = () => fireEvent.keyDown(screen.getByTestId('chart-drilldown-more'), { key: 'Enter' });
const rowTitles = () =>
  within(drill())
    .queryAllByTestId('drill-row-title')
    .map((element) => element.textContent);

beforeEach(() => {
  mockForceLoading = false;
  window.innerWidth = 1440;
});

describe('ChartDrillDialog', () => {
  it('is a dialog named "Table data preview" with the title and the row count', async () => {
    renderDrill();

    expect(drill().getAttribute('role')).toBe('dialog');
    expect(drill().getAttribute('aria-label')).toBe(en.chart.drilldown.ariaLabel);
    expect(screen.getByTestId('chart-drilldown-title').textContent).toBe('Blocker');
    await waitFor(() => expect(screen.getByTestId('chart-drilldown-count').textContent).toBe('2 rows'));
    expect(rowTitles()).toEqual(['Login fails on Safari', 'Crash on photo upload']);
  });

  it('counts a single matching row as "1 row"', async () => {
    const fixture = createDrillFixture();

    renderDrill({
      fixture,
      target: { xKey: 'o_doing', xLabel: 'Doing', xIsEmpty: false, rowIds: ['r2'] },
      title: 'Doing',
    });
    // The chart groups by Severity: point it at Status for this case.
    act(() => {
      (fixture.view.get('layout_settings' as never) as unknown as Map<string, Map<string, unknown>>)
        .get('3')
        ?.set('x_field_id', 'status');
    });
    await waitFor(() => expect(screen.getByTestId('chart-drilldown-count').textContent).toBe('1 row'));
  });

  it('draws the 800×496 box with the drill-down shadow and ring and focuses Dismiss', () => {
    renderDrill();

    expect(drill().style.width).toBe('800px');
    expect(drill().style.height).toBe('496px');
    expect(drill().style.maxWidth).toBe('calc(100vw - 32px)');
    expect(drill().style.maxHeight).toBe('calc(100vh - 32px)');
    expect(drill().style.borderRadius).toBe('12px');
    expect(drill().className).toContain('shadow-dash-drilldown');
    expect(drill().getAttribute('data-parity-id')).toBe('dash-drilldown');
    expect(document.activeElement).toBe(screen.getByTestId('chart-drilldown-dismiss'));
  });

  it('toggles the search input; Esc clears the query, then collapses it, and never closes the dialog', async () => {
    const { onClose } = renderDrill();

    fireEvent.click(screen.getByTestId('chart-drilldown-search'));
    const input = screen.getByTestId<HTMLInputElement>('chart-drilldown-search-input');

    expect(input.style.width).toBe('200px');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'token' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(screen.getByTestId('chart-drilldown-search-input')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('chart-drilldown-search-input')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('chart-drilldown-search'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Esc when nothing inside handles it', () => {
    const { onClose } = renderDrill();

    fireEvent.keyDown(screen.getByTestId('chart-drilldown-dismiss'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "No results" with Clear search when the search matches nothing', async () => {
    renderDrill();
    await waitFor(() => expect(rowTitles()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('chart-drilldown-search'));
    fireEvent.change(screen.getByTestId('chart-drilldown-search-input'), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByTestId('drill-empty').textContent).toContain('No results'));
    fireEvent.click(screen.getByTestId('drill-clear-search'));
    await waitFor(() => expect(rowTitles()).toHaveLength(2));
  });

  it('shows "No data" when the category has no rows and nothing narrows them', async () => {
    renderDrill({
      target: { xKey: '__empty__', xLabel: 'No Severity', xIsEmpty: true, rowIds: [] },
      title: 'No Severity',
    });
    await waitFor(() => expect(screen.getByTestId('drill-empty').textContent).toBe('No data'));
    expect(screen.queryByTestId('drill-clear-search')).toBeNull();
  });

  it('offers Save as view and Open {database} to writers', async () => {
    renderDrill();
    openMore();
    const menu = await screen.findByTestId('drill-more-menu');

    expect(within(menu).getByTestId('drill-menu-save-as-view').textContent).toContain('Save as view…');
    await waitFor(() =>
      expect(within(menu).getByTestId('drill-menu-open-database').textContent).toBe('Open Bug Tracker')
    );
  });

  it('offers only Open {database} to readers', async () => {
    renderDrill({ context: { readOnly: true, canWrite: false } });
    openMore();
    const menu = await screen.findByTestId('drill-more-menu');

    expect(within(menu).queryByTestId('drill-menu-save-as-view')).toBeNull();
    expect(within(menu).getByTestId('drill-menu-open-database')).toBeTruthy();
  });

  it('has no ··· on a published page', () => {
    renderDrill({ context: { readOnly: true, variant: UIVariant.Publish } });

    expect(screen.queryByTestId('chart-drilldown-more')).toBeNull();
  });

  it('opens the source database (closing first) from the menu', async () => {
    const { onClose, navigateToView } = renderDrill();

    openMore();
    const menu = await screen.findByTestId('drill-more-menu');

    await waitFor(() =>
      expect(within(menu).getByTestId('drill-menu-open-database').textContent).toBe('Open Bug Tracker')
    );
    fireEvent.click(within(menu).getByTestId('drill-menu-open-database'));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(navigateToView).toHaveBeenCalledWith('container'));
  });

  it('disables Save as view with a tooltip for the row-set fallback', async () => {
    renderDrill({ target: { ...BLOCKER, subGroupKey: 'o_new', subGroupLabel: 'New' } });
    expect(screen.getByTestId('drill-chip').getAttribute('data-chip-kind')).toBe('rows');
    expect(screen.getByTestId('drill-chip').textContent).toBe('Selected rows (2)');
    openMore();
    const menu = await screen.findByTestId('drill-more-menu');
    const item = within(menu).getByTestId('drill-menu-save-as-view');

    expect(item.getAttribute('data-disabled')).not.toBeNull();
    fireEvent.pointerMove(within(menu).getByTestId('drill-menu-save-as-view-disabled'), { pointerType: 'mouse' });
    await waitFor(() =>
      expect(screen.getAllByText(en.chart.drilldown.cannotSaveSelectedRows).length).toBeGreaterThan(0)
    );
  });

  it('calls onClose from Dismiss', () => {
    const { onClose } = renderDrill();

    fireEvent.click(screen.getByTestId('chart-drilldown-dismiss'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows 6 static skeleton rows while loading', () => {
    mockForceLoading = true;
    renderDrill();

    expect(screen.getAllByTestId('drill-skeleton-row')).toHaveLength(6);
    expect(screen.queryByTestId('chart-drilldown-count')).toBeNull();
  });

  it('shows OPEN on hover or keyboard focus only, and opens the record from OPEN, a click and Enter', async () => {
    const { navigateToRow, onClose } = renderDrill();

    await waitFor(() => expect(rowTitles()).toHaveLength(2));
    const open = screen.getByTestId('drill-row-open-r1');

    expect(open.className).toContain('hidden');
    expect(open.className).toContain('group-hover/drill-row:flex');
    expect(open.textContent).toBe('OPEN');
    fireEvent.click(open);
    expect(navigateToRow).toHaveBeenLastCalledWith('r1', undefined, { source: 'drilldown' });
    fireEvent.click(screen.getByTestId('drill-row-r2'));
    expect(navigateToRow).toHaveBeenLastCalledWith('r2', undefined, { source: 'drilldown' });
    fireEvent.keyDown(screen.getByTestId('drill-row-r1'), { key: 'Enter' });
    expect(navigateToRow).toHaveBeenLastCalledWith('r1', undefined, { source: 'drilldown' });
    expect(navigateToRow).toHaveBeenCalledTimes(3);
    // Peeks stack above the drill-down: it stays open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves between rows with ↑/↓', async () => {
    renderDrill();
    await waitFor(() => expect(rowTitles()).toHaveLength(2));
    const grid = screen.getByRole('grid');

    expect(grid.getAttribute('aria-rowcount')).toBe('3');
    act(() => screen.getByTestId('drill-row-r1').focus());
    fireEvent.keyDown(screen.getByTestId('drill-row-r1'), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('drill-row-r2')));
  });

  it('closes before a record opens as a full page', async () => {
    const fixture = createDrillFixture();

    fixture.view.set(OPEN_PAGES_IN_KEY, 'full_page');
    const { navigateToRow, onClose } = renderDrill({ fixture });

    await waitFor(() => expect(rowTitles()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('drill-row-r1'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateToRow).toHaveBeenCalledWith('r1', undefined, { source: 'drilldown' });
  });

  it('lists the columns with the primary field first', async () => {
    renderDrill();
    await waitFor(() =>
      expect(screen.getAllByTestId('drill-column-header').map((header) => header.textContent)).toEqual([
        'Name',
        'Status',
        'Severity',
        'Component',
      ])
    );
  });

  it('shows the category as a read-only pill and the drill filters as editable chips', async () => {
    renderDrill();
    const category = await screen.findByText('Severity: Blocker');
    const pill = category.closest('[data-testid="drill-chip"]') as HTMLElement;

    expect(pill.getAttribute('data-chip-kind')).toBe('category');
    expect(pill.tagName).toBe('SPAN');
    expect(pill.closest('button')).toBeNull();
    expect(pill.style.height).toBe('24px');
    expect(pill.style.borderRadius).toBe('12px');
  });

  it('starts from the widget filters as editable pill chips, then + Filter', async () => {
    const fixture = createDrillFixture();

    (fixture.view.get(YjsDatabaseKey.filters) as unknown as Y.Array<unknown>).push([
      toYFilter(selectFilterPlain('f-status', 'status', 'o_new')),
    ]);
    renderDrill({ fixture });
    const chip = await screen.findByTestId('database-filter-condition');
    const wrapper = chip.closest('[data-testid="drill-chip"]') as HTMLElement;

    expect(wrapper.getAttribute('data-chip-kind')).toBe('filter');
    expect(chip.getAttribute('data-variant')).toBe('pill');
    expect(chip.textContent).toContain('Status');
    expect(chip.querySelector('[data-testid="filter-chip-chevron"]')).not.toBeNull();
    expect(chip.getAttribute('data-parity-id')).toBe('dash-drilldown-chip');
    // Chips, then the category pill, then + Filter.
    const bar = screen.getByTestId('drill-filter-bar');
    const kinds = Array.from(bar.querySelectorAll('[data-testid="drill-chip"]')).map((element) =>
      element.getAttribute('data-chip-kind')
    );

    expect(kinds).toEqual(['filter', 'category']);
    expect(bar.lastElementChild?.getAttribute('data-testid')).toBe('drill-add-filter');
    await waitFor(() => expect(rowTitles()).toEqual(['Login fails on Safari']));
  });

  it('lets a reader edit the drill chips (nothing is saved)', async () => {
    const fixture = createDrillFixture();

    (fixture.view.get(YjsDatabaseKey.filters) as unknown as Y.Array<unknown>).push([
      toYFilter(selectFilterPlain('f-status', 'status', 'o_new')),
    ]);
    renderDrill({ fixture, context: { readOnly: true, canWrite: false } });
    const chip = await screen.findByTestId('database-filter-condition');

    expect(chip.getAttribute('aria-readonly')).toBe('false');
    expect(screen.getByTestId('drill-add-filter')).toBeTruthy();
  });

  it('shows the dashboard filters of this database as read-only chips with "From dashboard filter"', async () => {
    renderDrill({
      globals: [
        {
          id: 'gf1',
          name: '',
          fieldType: FieldType.SingleSelect,
          condition: 0,
          content: 'o_mobile',
          targets: { 'bug-tracker': 'component' },
        } as unknown as DashboardGlobalFilter,
        {
          id: 'gf2',
          name: 'Elsewhere',
          fieldType: FieldType.SingleSelect,
          condition: 0,
          content: 'x',
          targets: { 'other-db': 'f' },
        } as unknown as DashboardGlobalFilter,
      ],
    });
    const chips = (await screen.findAllByTestId('drill-chip')).filter(
      (chip) => chip.getAttribute('data-chip-kind') === 'global'
    );

    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe('Component: Mobile');
    expect(chips[0].querySelector('[data-testid="filter-chip-chevron"]')).toBeNull();
    expect(chips[0].closest('button')).toBeNull();
    fireEvent.focus(chips[0]);
    await waitFor(() => expect(screen.getAllByText(en.chart.drilldown.fromDashboardFilter).length).toBeGreaterThan(0));
  });

  it('shows no category pill for the Number chart', async () => {
    renderDrill({ target: { xKey: '', xLabel: 'Overdue', xIsEmpty: false, rowIds: ['r1'] }, title: 'Overdue' });
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    expect(screen.queryAllByTestId('drill-chip')).toHaveLength(0);
  });
});

describe('ChartDrillDialog in a mobile context', () => {
  it('fills a full-height sheet named "Table data preview", OPEN always visible, a tap opens the record', async () => {
    window.innerWidth = 390;
    const { navigateToRow, onClose } = renderDrill();
    const sheet = screen.getByTestId('mobile-sheet');

    expect(sheet.getAttribute('data-sheet')).toBe('drilldown');
    expect(sheet.getAttribute('data-size')).toBe('full');
    expect(sheet.getAttribute('aria-label')).toBe(en.chart.drilldown.ariaLabel);
    expect(screen.getByTestId('mobile-sheet-title').textContent).toBe('Blocker');
    await waitFor(() => expect(rowTitles()).toHaveLength(2));
    const open = screen.getByTestId('drill-row-open-r1');

    expect(open.className).not.toContain('hidden');
    fireEvent.click(screen.getByTestId('drill-row-r1'));
    // A phone opens records full screen: the sheet closes first.
    expect(onClose).toHaveBeenCalled();
    expect(navigateToRow).toHaveBeenCalledWith('r1', undefined, { source: 'drilldown' });
  });
});
