import { act, fireEvent, render, screen } from '@testing-library/react';

import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import { createWidgetContextValue } from '@/components/database/dashboard/__tests__/dashboardTestHarness';
import { WidgetFilterTool } from '@/components/database/dashboard/widget-tool-buttons/WidgetFilterTool';
import { WidgetSettingsTool } from '@/components/database/dashboard/widget-tool-buttons/WidgetSettingsTool';
import { WidgetSortTool } from '@/components/database/dashboard/widget-tool-buttons/WidgetSortTool';
import { WidgetContext } from '@/components/database/dashboard/WidgetContext';

// The real Radix tooltip: only its open-on-focus behavior is under test.
jest.mock('@/application/database-yjs', () => ({
  FieldType: { Person: 7, Rollup: 10 },
  useFiltersSelector: () => [],
  useConditionsReadOnly: () => false,
  useSortsSelector: () => [],
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddFilter: () => jest.fn(),
  useAddSort: () => jest.fn(),
}));

jest.mock('@/components/database/components/conditions/context', () => ({
  useConditionsContext: () => ({}),
}));

jest.mock('@/components/database/components/conditions/PropertiesMenu', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/dashboard/WidgetConditionsPopover', () => ({
  WidgetConditionsPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/sorts/utils', () => ({
  useRollupSortableIds: () => new Set<string>(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'grid.settings.filter': 'Filter',
        'grid.settings.sort': 'Sort',
      }[key] ?? key),
  }),
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }

    unobserve() {
      return undefined;
    }

    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
});

describe('Widget tool tooltips', () => {
  it.each([
    ['Filter', <WidgetFilterTool key='filter' />, 'database-actions-filter'],
    ['Sort', <WidgetSortTool key='sort' />, 'database-actions-sort'],
    // The Settings tool is the same button: the focus its settings host hands back opens no tooltip either.
    ['Settings', <WidgetSettingsTool key='settings' />, 'dashboard-widget-settings-button'],
  ])('keeps the %s tool tooltip closed when the focus comes back from its popover', (_label, tool, testId) => {
    render(<WidgetContext.Provider value={createWidgetContextValue({ editing: true })}>{tool}</WidgetContext.Provider>);

    act(() => {
      screen.getByTestId(testId).focus();
    });

    expect(document.activeElement).toBe(screen.getByTestId(testId));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('still shows the standalone toolbar tooltip on focus', () => {
    render(<FiltersButton />);

    act(() => {
      fireEvent.focus(screen.getByTestId('database-actions-filter'));
    });

    expect(screen.getByRole('tooltip').textContent).toBe('Filter');
  });
});
