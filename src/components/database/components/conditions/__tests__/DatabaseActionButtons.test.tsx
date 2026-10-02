import { render, screen } from '@testing-library/react';

import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';

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

describe('Dashboard widget condition tools', () => {
  it.each([
    ['Filter', <FiltersButton key='filter' presentation='popover' variant='widget' />, 'database-actions-filter'],
    ['Sort', <SortsButton key='sort' presentation='popover' variant='widget' />, 'database-actions-sort'],
  ])('renders the %s tool as a quiet 24px button with a 16px glyph', (_label, action, testId) => {
    render(action);

    const button = screen.getByTestId(testId);

    for (const name of ['h-6', 'w-6', '!rounded-200', 'text-dash-tool-icon', '[&_svg]:h-4', '[&_svg]:w-4']) {
      expect(button.className).toContain(name);
    }

    expect(button.className).toContain('data-[active=true]:text-dash-edit-icon');
    expect(button.getAttribute('data-active')).toBe('false');
    expect(button.getAttribute('data-parity-id')).toBe(
      testId === 'database-actions-filter' ? 'dash-widget-tool-filter' : 'dash-widget-tool-sort'
    );
    // The toolbar's blue inline color is for standalone views only.
    expect(button.style.color).toBe('');
  });

  it.each([
    [
      'Filter',
      <FiltersButton editing key='filter' presentation='popover' variant='widget' />,
      'database-actions-filter',
    ],
    ['Sort', <SortsButton editing key='sort' presentation='popover' variant='widget' />, 'database-actions-sort'],
  ])('turns the %s tool accent in Edit mode', (_label, action, testId) => {
    render(action);

    expect(screen.getByTestId(testId).className).toContain('text-dash-edit-icon');
  });

  it('keeps the standalone toolbar buttons free of the widget attributes', () => {
    render(<FiltersButton compact />);

    expect(screen.getByTestId('database-actions-filter').hasAttribute('data-active')).toBe(false);
    expect(screen.getByTestId('database-actions-filter').hasAttribute('data-parity-id')).toBe(false);
  });
});
