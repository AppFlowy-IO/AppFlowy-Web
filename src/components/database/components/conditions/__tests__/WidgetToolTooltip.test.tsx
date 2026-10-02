import { act, fireEvent, render, screen } from '@testing-library/react';

import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';

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
    ['Filter', <FiltersButton key='filter' presentation='popover' variant='widget' />, 'database-actions-filter'],
    ['Sort', <SortsButton key='sort' presentation='popover' variant='widget' />, 'database-actions-sort'],
  ])('keeps the %s tool tooltip closed when the focus comes back from its popover', (_label, tool, testId) => {
    render(tool);

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
