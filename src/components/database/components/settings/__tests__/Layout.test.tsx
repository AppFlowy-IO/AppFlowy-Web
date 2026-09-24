import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { DatabaseViewLayout } from '@/application/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import Layout from '../Layout';

const mockUpdateLayout = jest.fn();
let mockCreationEnabled = false;

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  get EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED() {
    return mockCreationEnabled;
  },
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/application/database-yjs', () => ({ useDatabaseViewId: () => 'view-id' }));
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
    jest.clearAllMocks();
    mockUpdateLayout.mockReset();
  });

  it('hides Timeline conversion when web creation is disabled', async () => {
    await openLayout(DatabaseViewLayout.Grid);

    expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`)).toBeNull();
  });

  it('keeps the current Timeline label and selected option without rewriting its layout', async () => {
    const trigger = await openLayout(DatabaseViewLayout.Timeline);
    const currentOption = screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`);

    expect(trigger.textContent).toContain('Timeline');
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

  it('shows a connection message when Chart conversion is rejected without changing the selected layout', async () => {
    const message = 'Connect to the internet to create Form or Chart views.';

    mockUpdateLayout.mockRejectedValueOnce(new Error(message));
    await openLayout(DatabaseViewLayout.Grid);
    fireEvent.click(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Chart}`));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(mockUpdateLayout).toHaveBeenCalledTimes(1);
    expect(mockUpdateLayout).toHaveBeenCalledWith(DatabaseViewLayout.Chart);
  });
});
