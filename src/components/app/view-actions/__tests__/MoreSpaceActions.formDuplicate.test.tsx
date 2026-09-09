import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import MoreSpaceActions from '@/components/app/view-actions/MoreSpaceActions';

import type { ReactNode } from 'react';

const mockDuplicate = jest.fn();
const mockGetView = jest.fn();
const mockToastError = jest.fn();

jest.mock('@/application/services/domains', () => ({
  PageService: {
    duplicate: (...args: unknown[]) => mockDuplicate(...args),
  },
}));

jest.mock('@/application/services/js-services/http/view-api', () => ({
  getView: (...args: unknown[]) => mockGetView(...args),
}));

jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({
    openDeleteSpaceModal: jest.fn(),
    openManageSpaceModal: jest.fn(),
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-id',
  useRefreshOutline: () => jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
    ...props
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
    [key: string]: unknown;
  }) => (
    <button
      data-testid={props['data-testid'] as string | undefined}
      disabled={disabled}
      onClick={onSelect}
      type='button'
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: () => <span data-testid='progress' />,
}));

function view(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

describe('MoreSpaceActions Form duplicate safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preflights the full subtree at depth 50 and blocks a Form absent from stale space metadata', async () => {
    const staleSpace = view('space-id', {
      extra: { is_space: true },
      children: [view('known-document')],
    });

    mockGetView.mockResolvedValue(
      view('space-id', {
        extra: { is_space: true },
        children: [
          view('deep-document', {
            children: [view('nested-form', { layout: ViewLayout.Form })],
          }),
        ],
      })
    );

    render(
      <MoreSpaceActions
        view={staleSpace}
        onClose={jest.fn()}
        canManageActions={false}
        canOpenManageActions
        isLoadingActions={false}
      />
    );

    fireEvent.click(screen.getByTestId('space-action-duplicate'));

    await waitFor(() => expect(mockGetView).toHaveBeenCalledWith('workspace-id', 'space-id', 50));
    expect(mockDuplicate).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      'This page contains a Form and cannot be duplicated yet because its Form settings would not be preserved.'
    );
  });
});
