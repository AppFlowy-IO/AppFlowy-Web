import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { DatabaseViewLayout } from '@/application/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import Layout from '../Layout';

const mockUpdateLayout = jest.fn();
const mockGetSubscriptions = jest.fn();
const timelineRequiresPro = 'Creating a Timeline view requires a Pro workspace.';
const dashboardRequiresPro = 'Creating a Dashboard view requires a Pro workspace.';
const mockReasonCalls: { enabled?: boolean; workspaceId?: string; requiresProMessage?: string }[] = [];
let mockCreationEnabled = false;
let mockIsDashboardWidget = false;
let mockRequiresPro = false;

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  get EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED() {
    return mockCreationEnabled;
  },
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({
    isDashboardWidget: mockIsDashboardWidget,
    getSubscriptions: mockGetSubscriptions,
    workspaceId: 'workspace-id',
  }),
  useDatabaseViewId: () => 'view-id',
}));
jest.mock('@/components/app/hooks/useTimelineCreationDisabledReason', () => ({
  useTimelineCreationDisabledReason: (
    getSubscriptions: unknown,
    options: { enabled?: boolean; workspaceId?: string; requiresProMessage?: string }
  ) => {
    mockReasonCalls.push(options);
    if (getSubscriptions !== mockGetSubscriptions || !mockRequiresPro) return undefined;
    return options.requiresProMessage ?? timelineRequiresPro;
  },
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateDatabaseLayout: () => mockUpdateLayout }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

async function openLayout(currentLayout: DatabaseViewLayout) {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Settings</DropdownMenuTrigger>
      <DropdownMenuContent>
        <Layout currentLayout={currentLayout} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const trigger = await screen.findByTestId('database-layout-settings-trigger');

  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  await screen.findByTestId(`database-layout-option-${DatabaseViewLayout.Grid}`);
  return trigger;
}

describe('database Layout', () => {
  beforeEach(() => {
    mockCreationEnabled = false;
    mockIsDashboardWidget = false;
    mockRequiresPro = false;
    mockReasonCalls.length = 0;
    jest.clearAllMocks();
    mockUpdateLayout.mockReset();
  });

  it('hides Timeline and Dashboard conversion when web creation is disabled', async () => {
    await openLayout(DatabaseViewLayout.Grid);

    expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`)).toBeNull();
    expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`)).toBeNull();
  });

  it('keeps the current Timeline label and selected option without rewriting its layout', async () => {
    const trigger = await openLayout(DatabaseViewLayout.Timeline);
    const currentOption = screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`);

    expect(trigger.textContent).toContain('Timeline');
    expect(currentOption.querySelector('[data-slot="dropdown-menu-tick"]')).not.toBeNull();
    fireEvent.click(currentOption);
    expect(mockUpdateLayout).not.toHaveBeenCalled();
  });

  it('keeps the current Dashboard label and selected option while creation is disabled', async () => {
    const trigger = await openLayout(DatabaseViewLayout.Dashboard);
    const currentOption = screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`);

    expect(trigger.textContent).toContain('Dashboard');
    expect(currentOption.querySelector('[data-slot="dropdown-menu-tick"]')).not.toBeNull();
    fireEvent.click(currentOption);
    expect(mockUpdateLayout).not.toHaveBeenCalled();
  });

  it('allows an existing Timeline to switch to a supported layout', async () => {
    await openLayout(DatabaseViewLayout.Timeline);
    fireEvent.click(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Grid}`));

    expect(mockUpdateLayout).toHaveBeenCalledWith(DatabaseViewLayout.Grid);
  });

  it('allows Timeline conversion when web creation is enabled', async () => {
    mockCreationEnabled = true;
    await openLayout(DatabaseViewLayout.Grid);
    fireEvent.click(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`));

    expect(mockUpdateLayout).toHaveBeenCalledWith(DatabaseViewLayout.Timeline);
  });

  it('allows Dashboard conversion when web creation is enabled', async () => {
    mockCreationEnabled = true;
    await openLayout(DatabaseViewLayout.Grid);
    const option = screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`);

    expect(option.textContent).toContain('Dashboard');
    fireEvent.click(option);
    expect(mockUpdateLayout).toHaveBeenCalledWith(DatabaseViewLayout.Dashboard);
  });

  it('never offers the Dashboard layout inside a dashboard widget', async () => {
    mockCreationEnabled = true;
    mockIsDashboardWidget = true;
    await openLayout(DatabaseViewLayout.Grid);

    expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`)).toBeNull();
    expect(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`)).toBeTruthy();
  });

  it('checks the workspace plan only while the layout menu is open', async () => {
    mockCreationEnabled = true;
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Settings</DropdownMenuTrigger>
        <DropdownMenuContent>
          <Layout currentLayout={DatabaseViewLayout.Grid} />
        </DropdownMenuContent>
      </DropdownMenu>
    );
    await screen.findByTestId('database-layout-settings-trigger');

    expect(mockReasonCalls.every(({ enabled }) => enabled === false)).toBe(true);
    fireEvent.keyDown(screen.getByTestId('database-layout-settings-trigger'), { key: 'ArrowRight' });
    await screen.findByTestId(`database-layout-option-${DatabaseViewLayout.Grid}`);
    expect(mockReasonCalls[mockReasonCalls.length - 2]).toEqual({ workspaceId: 'workspace-id', enabled: true });
    expect(mockReasonCalls[mockReasonCalls.length - 1]).toEqual({
      workspaceId: 'workspace-id',
      enabled: true,
      requiresProMessage: dashboardRequiresPro,
    });
  });

  it.each([
    [DatabaseViewLayout.Timeline, timelineRequiresPro],
    [DatabaseViewLayout.Dashboard, dashboardRequiresPro],
  ])('greys out conversion to layout %s with the Pro reason in a Free workspace', async (layout, message) => {
    mockCreationEnabled = true;
    mockRequiresPro = true;
    await openLayout(DatabaseViewLayout.Grid);
    const option = screen.getByTestId(`database-layout-option-${layout}`);

    expect(option.getAttribute('aria-disabled')).toBe('true');
    // The disabled item ignores pointer events; its wrapper must receive hover.
    fireEvent.pointerMove(option.parentElement!, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(message));
    fireEvent.click(option);
    expect(mockUpdateLayout).not.toHaveBeenCalled();
  });

  it('keeps the current Pro layout and other conversions available in a Free workspace', async () => {
    mockCreationEnabled = true;
    mockRequiresPro = true;
    await openLayout(DatabaseViewLayout.Dashboard);

    expect(
      screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`).hasAttribute('data-disabled')
    ).toBe(false);
    expect(
      screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`).getAttribute('aria-disabled')
    ).toBe('true');
    fireEvent.click(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Board}`));
    expect(mockUpdateLayout).toHaveBeenCalledWith(DatabaseViewLayout.Board);
  });

  it('shows a connection message when Chart conversion is rejected without changing the selected layout', async () => {
    const message = 'Connect to the internet to create Form or Chart views.';

    mockUpdateLayout.mockRejectedValueOnce(new Error(message));
    await openLayout(DatabaseViewLayout.Grid);
    fireEvent.click(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Chart}`));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(mockUpdateLayout).toHaveBeenCalledTimes(1);
    expect(mockUpdateLayout).toHaveBeenCalledWith(DatabaseViewLayout.Chart);
  });

  describe('in a mobile context (a 390px window)', () => {
    const initialWidth = window.innerWidth;

    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: initialWidth });
    });

    it('offers no Dashboard conversion, whatever the creation flag', async () => {
      mockCreationEnabled = true;
      await openLayout(DatabaseViewLayout.Grid);

      expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`)).toBeNull();
      expect(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`)).toBeTruthy();
      expect(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Board}`)).toBeTruthy();
    });

    it('still reads Dashboard for a Dashboard view', async () => {
      mockCreationEnabled = true;
      const trigger = await openLayout(DatabaseViewLayout.Dashboard);
      const currentOption = screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Dashboard}`);

      expect(trigger.textContent).toContain('Dashboard');
      expect(currentOption.querySelector('[data-slot="dropdown-menu-tick"]')).not.toBeNull();
    });
  });
});
