import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import { AddViewButton } from '@/components/database/components/tabs/AddViewButton';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockAddView = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddDatabaseView: () => mockAddView,
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
    mockAddView.mockResolvedValue('list-view-id');
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(300);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates an enabled List view and selects it', async () => {
    const onViewAdded = jest.fn();

    render(<AddViewButton onViewAdded={onViewAdded} />);
    fireEvent.click(screen.getByTestId('add-list-view-button'));

    expect(mockAddView).toHaveBeenCalledWith(DatabaseViewLayout.List, 'list.menuName');
    await waitFor(() => expect(onViewAdded).toHaveBeenCalledWith('list-view-id'));
  });
});
