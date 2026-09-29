import { fireEvent, render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import Layout from '../Layout';

const mockUpdateLayout = jest.fn();
let mockCreationEnabled = false;
let mockSelfHosted = false;
let mockTimelineAllowed = true;

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  get EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED() {
    return mockCreationEnabled;
  },
}));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContext: () => ({ workspaceId: 'workspace' }) }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerHostingMode: () => mockSelfHosted ? 'self-hosted' : 'cloud' }));
jest.mock('@/components/app/hooks/useDatabaseViewCreation', () => ({ useDatabaseViewCreation: () => ({
  getAction: () => mockTimelineAllowed ? { type: 'create' } : { type: 'upgrade', reason: 'Requires Pro' },
}) }));
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
    mockSelfHosted = false;
    mockTimelineAllowed = true;
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

  it('hides hosted Form and Chart conversion while preserving the selected Chart', async () => {
    await openLayout(DatabaseViewLayout.Grid);
    expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Chart}`)).toBeNull();
    expect(screen.queryByTestId(`database-layout-option-${DatabaseViewLayout.Form}`)).toBeNull();
  });

  it('keeps an existing hosted Chart selected without creating another Chart', async () => {
    const trigger = await openLayout(DatabaseViewLayout.Chart);

    expect(trigger.textContent).toContain('chart.menuName');
    fireEvent.click(screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Chart}`));
    expect(mockUpdateLayout).not.toHaveBeenCalled();
  });

  it('blocks Timeline conversion when creation requires Pro', async () => {
    mockCreationEnabled = true;
    mockTimelineAllowed = false;
    await openLayout(DatabaseViewLayout.Grid);
    const timeline = screen.getByTestId(`database-layout-option-${DatabaseViewLayout.Timeline}`);

    expect(timeline.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(timeline);
    expect(mockUpdateLayout).not.toHaveBeenCalled();
  });

  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])('allows self-hosted conversion to %s', async (layout) => {
    mockCreationEnabled = true;
    mockSelfHosted = true;
    await openLayout(DatabaseViewLayout.Grid);
    fireEvent.click(screen.getByTestId(`database-layout-option-${layout}`));
    expect(mockUpdateLayout).toHaveBeenCalledWith(layout);
  });
});
