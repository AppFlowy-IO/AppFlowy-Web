import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { DatabaseViewLayout } from '@/application/types';
import { AddViewButton } from '@/components/database/components/tabs/AddViewButton';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockAddView = jest.fn();
const mockEnsureCanAuthor = jest.fn();
const mockToastError = jest.fn();
let mockCanAuthor: boolean | null = true;

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddDatabaseView: () => mockAddView,
}));

jest.mock('@/components/database/form/useCanAuthorFormView', () => ({
  useCanAuthorFormView: () => ({
    canAuthor: mockCanAuthor,
    isLoading: mockCanAuthor === null,
    ensureCanAuthor: mockEnsureCanAuthor,
  }),
}));

jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    mockCanAuthor = true;
    mockEnsureCanAuthor.mockResolvedValue(true);
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
        <AddViewButton onViewAdded={onViewAdded} />
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
        <AddViewButton onViewAdded={onViewAdded} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('add-gallery-view-button'));

    expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.Gallery, 'gallery.menuName');
    await waitFor(() => expect(onViewAdded).toHaveBeenCalledWith('gallery-view-id'));
  });

  it('waits for an unknown Form entitlement before deciding whether to create', async () => {
    let resolveEntitlement!: (allowed: boolean) => void;
    const entitlement = new Promise<boolean>((resolve) => {
      resolveEntitlement = resolve;
    });
    const onViewAdded = jest.fn();

    mockCanAuthor = null;
    mockEnsureCanAuthor.mockReturnValue(entitlement);
    mockAddView.mockResolvedValue('form-view-id');
    render(
      <MemoryRouter>
        <AddViewButton onViewAdded={onViewAdded} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('add-form-view-option'));

    expect(mockEnsureCanAuthor).toHaveBeenCalledTimes(1);
    expect(mockAddView).not.toHaveBeenCalled();

    resolveEntitlement(true);

    await waitFor(() => {
      expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.Form, 'form.menuName');
      expect(onViewAdded).toHaveBeenCalledWith('form-view-id');
    });
  });

  it('does not treat a failed plan check as a confirmed Free workspace', async () => {
    mockCanAuthor = null;
    mockEnsureCanAuthor.mockResolvedValue(null);
    render(
      <MemoryRouter>
        <AddViewButton onViewAdded={jest.fn()} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('add-form-view-option'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Could not verify your workspace plan. Please try again.',
      );
    });
    expect(mockAddView).not.toHaveBeenCalled();
  });
});
