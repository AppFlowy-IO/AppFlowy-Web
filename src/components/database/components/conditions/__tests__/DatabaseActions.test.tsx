import { render, screen } from '@testing-library/react';

import { useDatabaseContext, useDatabaseViewLayout } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';

import { DatabaseActions } from '../DatabaseActions';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.fn(),
  useDatabaseViewLayout: jest.fn(),
}));

jest.mock('@/components/database/components/conditions/context', () => ({
  useConditionsContext: () => ({}),
}));

jest.mock('@/components/database/components/conditions/FiltersButton', () => ({
  __esModule: true,
  default: () => <div data-testid='filters-button' />,
}));

jest.mock('@/components/database/components/conditions/SortsButton', () => ({
  __esModule: true,
  default: () => <div data-testid='sorts-button' />,
}));

jest.mock('@/components/database/components/settings/Settings', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/template', () => ({
  DatabaseTemplateButton: () => <button data-testid='database-template-button'>New</button>,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseDatabaseViewLayout = useDatabaseViewLayout as jest.MockedFunction<typeof useDatabaseViewLayout>;

describe('DatabaseActions template support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({ isDocumentBlock: false } as ReturnType<typeof useDatabaseContext>);
  });

  it.each([
    ['grid', DatabaseViewLayout.Grid],
    ['board', DatabaseViewLayout.Board],
    ['calendar', DatabaseViewLayout.Calendar],
    ['chart', DatabaseViewLayout.Chart],
    ['list', DatabaseViewLayout.List],
    ['gallery', DatabaseViewLayout.Gallery],
  ])('renders the template New button in the %s layout', (_name, layout) => {
    mockUseDatabaseViewLayout.mockReturnValue(layout);

    render(<DatabaseActions />);

    expect(screen.getByTestId('database-template-button')).toBeTruthy();
  });

  it('keeps sorting limited to the grid layout', () => {
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Board);

    const { rerender } = render(<DatabaseActions />);

    expect(screen.queryByTestId('sorts-button')).toBeNull();

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Grid);
    rerender(<DatabaseActions />);

    expect(screen.getByTestId('sorts-button')).toBeTruthy();
  });
});
