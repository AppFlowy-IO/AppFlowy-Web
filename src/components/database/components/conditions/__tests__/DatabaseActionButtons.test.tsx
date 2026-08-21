import { render, screen } from '@testing-library/react';

import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Person: 7, Rollup: 10 },
  useFiltersSelector: () => [],
  useReadOnly: () => false,
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

jest.mock('@/components/database/components/sorts/utils', () => ({
  useRollupSortableIds: () => new Set<string>(),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

describe('Gallery compact condition actions', () => {
  it.each([
    ['Filter', <FiltersButton compact key='filter' />, 'database-actions-filter'],
    ['Sort', <SortsButton compact key='sort' />, 'database-actions-sort'],
  ])('renders the %s action as an accessible 24px button', (label, action, testId) => {
    render(action);

    const button = screen.getByTestId(testId);

    expect(button.getAttribute('aria-label')).toBe(label);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('h-6');
    expect(button.className).toContain('w-6');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
