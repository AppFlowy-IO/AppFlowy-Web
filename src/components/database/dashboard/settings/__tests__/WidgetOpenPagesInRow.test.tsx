import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { OPEN_PAGES_IN_KEY } from '@/application/database-yjs/open-pages-in';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import {
  CHART_VIEW_ID,
  contextOf,
  createDrillFixture,
  DatabaseWrapper,
  DrillFixture,
} from '@/components/database/chart/drill/__tests__/drillTestFixture';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { WidgetOpenPagesInRow } from '../WidgetOpenPagesInRow';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

function renderRow(fixture: DrillFixture, layout: DatabaseViewLayout | null = DatabaseViewLayout.Grid) {
  return render(
    <DatabaseWrapper value={contextOf(fixture)}>
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <button type='button'>Settings</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-testid='host'>
          <WidgetOpenPagesInRow layout={layout} viewId={CHART_VIEW_ID} />
        </DropdownMenuContent>
      </DropdownMenu>
    </DatabaseWrapper>
  );
}

async function openSubmenu() {
  const row = screen.getByTestId('dashboard-widget-settings-open-pages-in');

  act(() => row.focus());
  fireEvent.keyDown(row, { key: 'ArrowRight' });
  return screen.findByTestId('dashboard-widget-settings-open-pages-in-menu');
}

const checked = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitemradio')
    .filter((item) => item.getAttribute('aria-checked') === 'true')
    .map((item) => item.getAttribute('data-testid'));

describe('WidgetOpenPagesInRow', () => {
  it('offers the three options with the check on Side peek while nothing is stored', async () => {
    renderRow(createDrillFixture({ chart: false }));
    const row = screen.getByTestId('dashboard-widget-settings-open-pages-in');

    expect(row.textContent).toContain('Open pages in');
    expect(row.textContent).toContain('Side peek');
    const menu = await openSubmenu();

    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.getAttribute('data-testid'))
    ).toEqual(['open-pages-in-option-side_peek', 'open-pages-in-option-center_peek', 'open-pages-in-option-full_page']);
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent)
    ).toEqual(['Side peek', 'Center peek', 'Full page']);
    expect(checked(menu)).toEqual(['open-pages-in-option-side_peek']);
  });

  it('checks the stored value, and an unknown one reads as the default', async () => {
    const fixture = createDrillFixture({ chart: false });

    fixture.view.set(OPEN_PAGES_IN_KEY, 'full_page');
    const { unmount } = renderRow(fixture);

    expect(checked(await openSubmenu())).toEqual(['open-pages-in-option-full_page']);
    unmount();
    fixture.view.set(OPEN_PAGES_IN_KEY, 'bogus');
    renderRow(fixture);
    expect(checked(await openSubmenu())).toEqual(['open-pages-in-option-side_peek']);
    // Never rewritten by reading it.
    expect(fixture.view.get(OPEN_PAGES_IN_KEY)).toBe('bogus');
  });

  it('writes only open_pages_in when an option is chosen', async () => {
    const fixture = createDrillFixture({ chart: false });

    renderRow(fixture);
    const before = fixture.view.get(YjsDatabaseKey.name);

    fireEvent.click(within(await openSubmenu()).getByTestId('open-pages-in-option-center_peek'));
    expect(fixture.view.get(OPEN_PAGES_IN_KEY)).toBe('center_peek');
    expect(fixture.view.get(YjsDatabaseKey.name)).toBe(before);
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-widget-settings-open-pages-in').textContent).toContain('Center peek')
    );
  });

  it('is hidden for a chart (and while the layout is unknown)', () => {
    const fixture = createDrillFixture();
    const { unmount } = renderRow(fixture, DatabaseViewLayout.Chart);

    expect(screen.queryByTestId('dashboard-widget-settings-open-pages-in')).toBeNull();
    unmount();
    renderRow(fixture, null);
    expect(screen.queryByTestId('dashboard-widget-settings-open-pages-in')).toBeNull();
  });
});
