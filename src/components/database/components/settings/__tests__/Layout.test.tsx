import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';

import { DatabaseViewLayout } from '@/application/types';
import Layout from '@/components/database/components/settings/Layout';

const mockUpdateLayout = jest.fn();
let mockIsDashboardWidget = false;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/application/constants', () => ({
  DASHBOARD_VIEW_ENABLED: true,
  TIMELINE_VIEW_ENABLED: true,
}));

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ isDashboardWidget: mockIsDashboardWidget }),
  useDatabaseViewId: () => 'view-id',
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateDatabaseLayout: () => mockUpdateLayout,
}));

jest.mock('@/assets/icons/layout.svg', () => ({
  ReactComponent: () => null,
}));

// Render the submenu inline so the options are reachable without driving Radix.
jest.mock('@/components/ui/dropdown-menu', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

  return {
    DropdownMenuItem: ({
      children,
      onSelect,
      'data-testid': testId,
    }: {
      children?: ReactNode;
      onSelect?: () => void;
      'data-testid'?: string;
    }) => (
      <button data-testid={testId} onClick={onSelect} type='button'>
        {children}
      </button>
    ),
    DropdownMenuItemTick: () => <span data-testid='layout-tick' />,
    DropdownMenuPortal: Passthrough,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => (
      <div data-testid='database-layout-settings-trigger'>{children}</div>
    ),
  };
});

describe('Layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDashboardWidget = false;
  });

  it('offers the Dashboard layout for a database view', () => {
    render(<Layout currentLayout={DatabaseViewLayout.Grid} />);

    const option = screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`);

    expect(option.textContent).toContain('Dashboard');
    fireEvent.click(option);
    expect(mockUpdateLayout).toHaveBeenCalledWith(DatabaseViewLayout.Dashboard);
  });

  it('shows the current Dashboard layout in the trigger', () => {
    render(<Layout currentLayout={DatabaseViewLayout.Dashboard} />);

    expect(screen.getByTestId('database-layout-settings-trigger').textContent).toContain('Dashboard');
  });

  it('hides the Dashboard layout inside a dashboard widget', () => {
    mockIsDashboardWidget = true;
    render(<Layout currentLayout={DatabaseViewLayout.Grid} />);

    expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`)).toBeNull();
    expect(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`)).toBeTruthy();
    expect(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Grid}`)).toBeTruthy();
  });
});
