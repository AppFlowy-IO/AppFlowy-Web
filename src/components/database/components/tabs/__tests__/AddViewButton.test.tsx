import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';

import { DatabaseViewLayout } from '@/application/types';
import { AddViewButton } from '@/components/database/components/tabs/AddViewButton';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockAddView = jest.fn();
let mockExperimentalDatabaseViewCreationEnabled = false;

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  get EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED() {
    return mockExperimentalDatabaseViewCreationEnabled;
  },
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddDatabaseView: () => mockAddView,
}));

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContext: () => ({ workspaceId: 'workspace-id' }),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'form.builderName' ? 'Form builder' : key),
  }),
}));

jest.mock('@/components/_shared/view-icon', () => ({
  ViewIcon: () => null,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    loading: _loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: () => null,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('AddViewButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: false },
    });
    mockExperimentalDatabaseViewCreationEnabled = false;
    mockAddView.mockResolvedValue('list-view-id');
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(300);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows one Pro upgrade message when the Free form quota is reached', async () => {
    const onViewAdded = jest.fn();
    const onAfterAddView = jest.fn();

    mockExperimentalDatabaseViewCreationEnabled = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockAddView.mockRejectedValueOnce({ code: 1076, message: 'Form limit reached' });
    render(
      <MemoryRouter>
        <AddViewButton databasePageId='database-page-id' onAfterAddView={onAfterAddView} onViewAdded={onViewAdded} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('add-form-view-option'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Upgrade this workspace to Pro to use this feature or increase its limits.'
    ));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(onViewAdded).not.toHaveBeenCalled();
    expect(onAfterAddView).toHaveBeenCalledTimes(1);
  });

  it('shows the server plan error and finishes loading without selecting a new view', async () => {
    const onViewAdded = jest.fn();
    const onAfterAddView = jest.fn();
    const message = 'Creating a Timeline view requires an active Pro plan for this workspace.';

    mockExperimentalDatabaseViewCreationEnabled = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockAddView.mockRejectedValueOnce({ code: 1090, message });
    render(
      <MemoryRouter>
        <AddViewButton
          databasePageId='database-page-id'
          onAfterAddView={onAfterAddView}
          onViewAdded={onViewAdded}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('add-timeline-view-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(onViewAdded).not.toHaveBeenCalled();
    expect(onAfterAddView).toHaveBeenCalledTimes(1);
  });

  it('creates an enabled List view and selects it', async () => {
    const onViewAdded = jest.fn();

    render(
      <MemoryRouter>
        <AddViewButton databasePageId='database-page-id' onViewAdded={onViewAdded} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('add-list-view-button'));

    expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.List, 'list.menuName');
    await waitFor(() => expect(onViewAdded).toHaveBeenCalledWith('list-view-id'));
  });

  it('creates an enabled Gallery view and selects it', async () => {
    const onViewAdded = jest.fn();

    mockAddView.mockResolvedValue('gallery-view-id');
    render(
      <MemoryRouter>
        <AddViewButton databasePageId='database-page-id' onViewAdded={onViewAdded} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('add-gallery-view-button'));

    expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.Gallery, 'gallery.menuName');
    await waitFor(() => expect(onViewAdded).toHaveBeenCalledWith('gallery-view-id'));
  });

  it('creates a Feed view and selects it', async () => {
    const onViewAdded = jest.fn();

    mockAddView.mockResolvedValue('feed-view-id');
    render(
      <MemoryRouter>
        <AddViewButton databasePageId='database-page-id' onViewAdded={onViewAdded} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('add-feed-view-button'));

    expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.Feed, 'feed.menuName');
    await waitFor(() => expect(onViewAdded).toHaveBeenCalledWith('feed-view-id'));
  });

  it('completes with the latest same-database callbacks and preserves concurrently added view IDs', async () => {
    let resolveAdd!: (viewId: string) => void;
    const committedViewIds: string[][] = [];
    const initialViewIds = ['view-a'];
    const concurrentViewIds = ['view-a', 'concurrent-view'];
    const initialOnViewAdded = jest.fn((viewId: string) => committedViewIds.push([...initialViewIds, viewId]));
    const latestOnViewAdded = jest.fn((viewId: string) => committedViewIds.push([...concurrentViewIds, viewId]));
    const initialOnAfterAddView = jest.fn();
    const latestOnAfterAddView = jest.fn();
    const createPending = new Promise<string>((resolve) => {
      resolveAdd = resolve;
    });
    const rendered = render(
      <MemoryRouter>
        <AddViewButton
          databasePageId='database-page-id'
          onAfterAddView={initialOnAfterAddView}
          onViewAdded={initialOnViewAdded}
        />
      </MemoryRouter>
    );

    mockAddView.mockReturnValue(createPending);
    fireEvent.click(screen.getByTestId('add-list-view-button'));

    rendered.rerender(
      <MemoryRouter>
        <AddViewButton
          databasePageId='database-page-id'
          onAfterAddView={latestOnAfterAddView}
          onViewAdded={latestOnViewAdded}
        />
      </MemoryRouter>
    );

    await act(async () => resolveAdd('list-view-id'));

    await waitFor(() => expect(latestOnViewAdded).toHaveBeenCalledWith('list-view-id'));
    expect(initialOnViewAdded).not.toHaveBeenCalled();
    expect(committedViewIds).toEqual([['view-a', 'concurrent-view', 'list-view-id']]);
    expect(latestOnAfterAddView).toHaveBeenCalledTimes(1);
    expect(initialOnAfterAddView).not.toHaveBeenCalled();
    expect(screen.getByTestId('add-view-button').hasAttribute('disabled')).toBe(false);
  });

  it('cancels completion callbacks when the database page changes', async () => {
    let resolveAdd!: (viewId: string) => void;
    const createPending = new Promise<string>((resolve) => {
      resolveAdd = resolve;
    });
    const initialOnViewAdded = jest.fn();
    const initialOnAfterAddView = jest.fn();
    const nextOnViewAdded = jest.fn();
    const nextOnAfterAddView = jest.fn();
    const rendered = render(
      <MemoryRouter>
        <AddViewButton
          databasePageId='database-page-a'
          onAfterAddView={initialOnAfterAddView}
          onViewAdded={initialOnViewAdded}
        />
      </MemoryRouter>
    );

    mockAddView.mockReturnValue(createPending);
    fireEvent.click(screen.getByTestId('add-list-view-button'));

    rendered.rerender(
      <MemoryRouter>
        <AddViewButton
          databasePageId='database-page-b'
          onAfterAddView={nextOnAfterAddView}
          onViewAdded={nextOnViewAdded}
        />
      </MemoryRouter>
    );

    await act(async () => resolveAdd('stale-list-view-id'));

    expect(initialOnViewAdded).not.toHaveBeenCalled();
    expect(initialOnAfterAddView).not.toHaveBeenCalled();
    expect(nextOnViewAdded).not.toHaveBeenCalled();
    expect(nextOnAfterAddView).not.toHaveBeenCalled();
  });

  it('hides Form and Timeline while experimental database view creation is disabled on web', () => {
    render(
      <MemoryRouter>
        <AddViewButton databasePageId='database-page-id' onViewAdded={jest.fn()} />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('add-form-view-option')).toBeNull();
    expect(screen.queryByTestId('add-timeline-view-button')).toBeNull();
    expect(screen.getByTestId('add-list-view-button')).toBeTruthy();
    expect(mockAddView).not.toHaveBeenCalled();
  });

  it('creates a Form without checking a workspace subscription once form creation is enabled', async () => {
    const onViewAdded = jest.fn();

    mockExperimentalDatabaseViewCreationEnabled = true;
    mockAddView.mockResolvedValue('form-view-id');
    render(
      <MemoryRouter>
        <AddViewButton databasePageId='database-page-id' onViewAdded={onViewAdded} />
      </MemoryRouter>
    );

    const formOption = screen.getByTestId('add-form-view-option');

    expect(formOption.hasAttribute('disabled')).toBe(false);
    expect(formOption.textContent).toBe('Form builder');
    fireEvent.click(formOption);

    await waitFor(() => {
      expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.Form, 'Form builder');
      expect(onViewAdded).toHaveBeenCalledWith('form-view-id');
    });
  });
});
