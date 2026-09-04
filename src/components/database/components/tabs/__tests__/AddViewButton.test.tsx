import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { DatabaseViewLayout } from '@/application/types';
import { AddViewButton } from '@/components/database/components/tabs/AddViewButton';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockAddView = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddDatabaseView: () => mockAddView,
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
    mockAddView.mockResolvedValue('list-view-id');
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(300);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    fireEvent.click(screen.getByTestId('add-form-view-option'));

    rendered.rerender(
      <MemoryRouter>
        <AddViewButton
          databasePageId='database-page-id'
          onAfterAddView={latestOnAfterAddView}
          onViewAdded={latestOnViewAdded}
        />
      </MemoryRouter>
    );

    await act(async () => resolveAdd('form-view-id'));

    await waitFor(() => expect(latestOnViewAdded).toHaveBeenCalledWith('form-view-id'));
    expect(initialOnViewAdded).not.toHaveBeenCalled();
    expect(committedViewIds).toEqual([['view-a', 'concurrent-view', 'form-view-id']]);
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
    fireEvent.click(screen.getByTestId('add-form-view-option'));

    rendered.rerender(
      <MemoryRouter>
        <AddViewButton
          databasePageId='database-page-b'
          onAfterAddView={nextOnAfterAddView}
          onViewAdded={nextOnViewAdded}
        />
      </MemoryRouter>
    );

    await act(async () => resolveAdd('stale-form-view-id'));

    expect(initialOnViewAdded).not.toHaveBeenCalled();
    expect(initialOnAfterAddView).not.toHaveBeenCalled();
    expect(nextOnViewAdded).not.toHaveBeenCalled();
    expect(nextOnAfterAddView).not.toHaveBeenCalled();
  });

  it('creates a Form without checking a workspace subscription', async () => {
    const onViewAdded = jest.fn();

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
