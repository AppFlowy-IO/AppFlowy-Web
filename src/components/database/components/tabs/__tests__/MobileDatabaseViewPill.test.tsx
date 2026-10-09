import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseViewLayout, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { MobileDatabaseViewPill } from '@/components/database/components/tabs/MobileDatabaseViewPill';

const mockAddView = jest.fn();
const mockStartCheckout = jest.fn();
const mockGetAction = jest.fn();


jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddDatabaseView: () => mockAddView,
}));

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContext: () => ({ workspaceId: 'workspace-id' }),
}));

// Even where a Dashboard could be created, the phone's list never offers it.
jest.mock('@/components/app/hooks/useDashboardCreationGate', () => ({
  useDashboardCreationGate: () => ({ available: true, disabledReason: undefined }),
}));

jest.mock('@/components/app/hooks/useDatabaseViewCreation', () => ({
  useDatabaseViewCreation: () => ({
    getAction: mockGetAction,
    checkCreation: (layout: ViewLayout) => mockGetAction(layout).type === 'create',
    startCheckout: mockStartCheckout,
  }),
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: ({ view }: { view: { layout: number } }) => <span data-layout={view.layout} data-testid='page-icon' />,
}));

jest.mock('@/components/_shared/view-icon', () => ({
  ViewIcon: () => <span data-testid='layout-icon' />,
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const count = options?.count;
      const template =
        (count === 1 ? options?.defaultValue_one : count !== undefined ? options?.defaultValue_other : undefined) ??
        options?.defaultValue ??
        key;

      return String(template).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

function createViews() {
  const doc = new Y.Doc();
  const views: Y.Map<YDatabaseView> = doc.getMap('views');
  const add = (id: string, name: string, layout: DatabaseViewLayout) => {
    const view = new Y.Map() as YDatabaseView;

    views.set(id, view);
    view.set(YjsDatabaseKey.name, name);
    view.set(YjsDatabaseKey.layout, layout);
    return view;
  };

  return {
    views,
    grid: add('view-grid', 'Grid', DatabaseViewLayout.Grid),
    board: add('view-board', 'Board', DatabaseViewLayout.Board),
    dashboard: add('view-dashboard', 'Dashboard', DatabaseViewLayout.Dashboard),
  };
}

const VIEW_IDS = ['view-grid', 'view-board', 'view-dashboard'];

function renderPill({
  readOnly = false,
  selectedViewId = 'view-dashboard',
  setSelectedViewId = jest.fn(),
  onViewAdded = jest.fn(),
}: {
  readOnly?: boolean;
  selectedViewId?: string;
  setSelectedViewId?: jest.Mock;
  onViewAdded?: jest.Mock;
} = {}) {
  const created = createViews();

  render(
    <MobileDatabaseViewPill
      databasePageId='view-grid'
      onViewAdded={onViewAdded}
      readOnly={readOnly}
      selectedViewId={selectedViewId}
      setSelectedViewId={setSelectedViewId}
      viewIds={VIEW_IDS}
      views={created.views}
    />
  );
  return created;
}

const pill = () => screen.getByTestId('database-view-pill');
const items = () => within(screen.getByTestId('mobile-sheet')).getAllByTestId('mobile-sheet-item');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAction.mockReturnValue({ type: 'create' });
  mockStartCheckout.mockReset();
});

describe('MobileDatabaseViewPill', () => {
  it("shows the selected view's icon and name with a chevron, in the Flutter pill's box", () => {
    renderPill();

    expect(screen.getByTestId('database-view-pill-name').textContent).toBe('Dashboard');
    expect(within(pill()).getByTestId('page-icon').getAttribute('data-layout')).toBeTruthy();
    expect(pill().querySelector('svg')).toBeTruthy();
    for (const name of ['max-w-[200px]', 'rounded-[12px]', 'pl-3', 'pr-2', 'py-2', 'text-sm', 'font-medium']) {
      expect(pill().className).toContain(name);
    }
  });

  it('follows a rename of the selected view', () => {
    const { dashboard } = renderPill();

    act(() => {
      dashboard.set(YjsDatabaseKey.name, 'KPIs');
    });
    expect(screen.getByTestId('database-view-pill-name').textContent).toBe('KPIs');
  });

  it('lists the views in a "{count} views" sheet with a check on the selected one, and switches', async () => {
    const setSelectedViewId = jest.fn();

    renderPill({ setSelectedViewId });
    fireEvent.click(pill());

    const sheet = screen.getByTestId('mobile-sheet');

    expect(sheet.getAttribute('data-sheet')).toBe('views');
    expect(within(sheet).getByTestId('mobile-sheet-title').textContent).toBe('3 views');
    expect(items().map((item) => item.getAttribute('data-item-id'))).toEqual([...VIEW_IDS, 'new-view']);
    expect(items().map((item) => item.textContent)).toEqual(['Grid', 'Board', 'Dashboard', 'New view']);
    const checked = items().filter((item) => within(item).queryByTestId('view-pill-check'));

    expect(checked.map((item) => item.getAttribute('data-item-id'))).toEqual(['view-dashboard']);

    fireEvent.click(items()[1]);
    expect(setSelectedViewId).toHaveBeenCalledWith('view-board');
    await waitFor(() => expect(screen.queryByTestId('mobile-sheet')).toBeNull());
  });

  it('lists the layouts without Dashboard for "+ New view", with a back to the views, and creates one', async () => {
    const onViewAdded = jest.fn();

    mockAddView.mockResolvedValue('new-list-view');
    renderPill({ onViewAdded });
    fireEvent.click(pill());
    fireEvent.click(items()[items().length - 1]);

    expect(within(screen.getByTestId('mobile-sheet')).getByTestId('mobile-sheet-title').textContent).toBe('New view');
    const labels = items().map((item) => item.textContent);

    expect(labels).toEqual([
      'grid.menuName',
      'board.menuName',
      'calendar.menuName',
      'Timeline',
      'chart.menuName',
      'Form builder',
      'list.menuName',
      'gallery.menuName',
      'feed.menuName',
    ]);
    expect(labels).not.toContain('Dashboard');
    expect(items().some((item) => item.getAttribute('data-item-id') === `layout-${DatabaseViewLayout.Dashboard}`)).toBe(
      false
    );

    // Back to the views.
    fireEvent.click(screen.getByTestId('mobile-sheet-back'));
    expect(within(screen.getByTestId('mobile-sheet')).getByTestId('mobile-sheet-title').textContent).toBe('3 views');

    fireEvent.click(items()[items().length - 1]);
    fireEvent.click(items().find((item) => item.textContent === 'list.menuName')!);
    expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.List, 'list.menuName');
    await waitFor(() => expect(onViewAdded).toHaveBeenCalledWith('new-list-view'));
    expect(screen.queryByTestId('mobile-sheet')).toBeNull();
  });

  it('blocks unavailable Chart creation while ordinary layouts remain usable', () => {
    mockGetAction.mockImplementation((layout: ViewLayout) =>
      layout === ViewLayout.Chart ? { type: 'disabled', reason: 'Reconnect to create a Chart.' } : { type: 'create' }
    );
    renderPill();
    fireEvent.click(pill());
    fireEvent.click(items().at(-1)!);
    const chart = items().find((item) => item.getAttribute('data-item-id') === `layout-${DatabaseViewLayout.Chart}`)!;
    const list = items().find((item) => item.getAttribute('data-item-id') === `layout-${DatabaseViewLayout.List}`)!;

    expect(chart.hasAttribute('disabled')).toBe(true);
    expect(list.hasAttribute('disabled')).toBe(false);
    fireEvent.click(chart);
    expect(mockAddView).not.toHaveBeenCalled();
  });

  it('keeps the Pro checkout progress in the sheet and never creates a denied Chart', async () => {
    let finishCheckout!: () => void;

    mockGetAction.mockImplementation((layout: ViewLayout) =>
      layout === ViewLayout.Chart ? { type: 'upgrade', requiresPro: true, reason: 'Requires Pro' } : { type: 'create' }
    );
    mockStartCheckout.mockReturnValue(new Promise<void>((resolve) => { finishCheckout = resolve; }));
    renderPill();
    fireEvent.click(pill());
    fireEvent.click(items().at(-1)!);
    const chart = items().find((item) => item.getAttribute('data-item-id') === `layout-${DatabaseViewLayout.Chart}`)!;

    expect(within(chart).getByLabelText('Pro')).toBeTruthy();
    fireEvent.click(chart);
    expect(mockStartCheckout).toHaveBeenCalledTimes(1);
    expect(mockStartCheckout).toHaveBeenCalledWith(ViewLayout.Chart);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(items().every((item) => item.hasAttribute('disabled'))).toBe(true);
    expect(mockAddView).not.toHaveBeenCalled();
    await act(async () => finishCheckout());
    await waitFor(() => expect(screen.queryByTestId('mobile-sheet')).toBeNull());
  });

  it('offers readers the views but no "+ New view"', () => {
    renderPill({ readOnly: true });
    fireEvent.click(pill());

    expect(items().map((item) => item.getAttribute('data-item-id'))).toEqual(VIEW_IDS);
  });
});
