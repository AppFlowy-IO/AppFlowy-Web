import { fireEvent, render, screen } from '@testing-library/react';

import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';

const mockAddFilter = jest.fn();
const mockAddSort = jest.fn();
const mockOpenFilter = jest.fn();
const mockExpand = jest.fn();

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Person: 7, Rollup: 10 },
  useFiltersSelector: () => [],
  useReadOnly: () => false,
  useSortsSelector: () => [],
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddFilter: () => mockAddFilter,
  useAddSort: () => mockAddSort,
}));

jest.mock('@/components/database/components/conditions/context', () => ({
  useConditionsContext: () => ({ setOpenFilterId: mockOpenFilter, setExpanded: mockExpand }),
}));

jest.mock('@/components/database/components/conditions/PropertiesMenu', () => ({
  __esModule: true,
  default: ({ children, onSelect }: { children: React.ReactNode; onSelect: (id: string) => void }) => (
    <>
      {children}
      <button onClick={() => onSelect('native-verification')}>Verification</button>
    </>
  ),
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
  beforeEach(() => jest.clearAllMocks());

  it('creates a native Verification rule and opens that rule identity', () => {
    mockAddFilter.mockReturnValue('native-rule');
    render(<FiltersButton />);
    fireEvent.click(screen.getByText('Verification'));
    expect(mockAddFilter).toHaveBeenCalledWith('native-verification');
    expect(mockOpenFilter).toHaveBeenCalledWith('native-rule');
  });

  it('creates a Verification sort in the ordinary native list', () => {
    render(<SortsButton />);
    fireEvent.click(screen.getByText('Verification'));
    expect(mockAddSort).toHaveBeenCalledWith('native-verification');
  });
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
