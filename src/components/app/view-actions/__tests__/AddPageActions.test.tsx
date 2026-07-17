import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';

import type { ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockGetView = jest.fn();
const mockUpdateChatSettings = jest.fn();
const mockToView = jest.fn();
const mockOpenPageModal = jest.fn();
const mockChatRequest = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

jest.mock('sonner', () => ({
  toast: {
    dismiss: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(() => 'loading-toast-id'),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
  useAppOperations: () => ({ addPage: mockAddPage }),
  useCurrentWorkspaceId: () => 'workspace-id',
  useOpenPageModal: () => mockOpenPageModal,
  useToView: () => mockToView,
}));

jest.mock('@/components/chat/request', () => ({
  ChatRequest: function MockChatRequest(...args: unknown[]) {
    mockChatRequest(...args);
    return {
      getView: mockGetView,
      updateChatSettings: mockUpdateChatSettings,
    };
  },
}));

jest.mock('@/application/services/js-services/http', () => ({
  getAxiosInstance: () => ({}),
}));

jest.mock('@/components/_shared/view-icon', () => ({
  ViewIcon: () => null,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    ...props
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button
      data-testid={props['data-testid'] as string | undefined}
      disabled={disabled}
      onClick={onClick}
      type='button'
    >
      {children}
    </button>
  ),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function view(overrides: Partial<View> = {}): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

describe('AddPageActions AI chat context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddPage.mockResolvedValue({ view_id: 'chat-id' });
    mockUpdateChatSettings.mockResolvedValue(undefined);
    mockToView.mockResolvedValue(undefined);
  });

  it('starts with no RAG IDs when the parent is a space', async () => {
    const space = view({
      view_id: 'space-id',
      extra: { is_space: true },
      children: [view({ view_id: 'space-child-1' }), view({ view_id: 'space-child-2' })],
    });

    render(<AddPageActions view={space} />);
    fireEvent.click(screen.getByTestId('add-ai-chat-button'));

    await waitFor(() =>
      expect(mockUpdateChatSettings).toHaveBeenCalledWith({
        full_workspace: false,
        rag_ids: [],
      })
    );

    expect(mockAddPage).toHaveBeenCalledWith('space-id', {
      layout: ViewLayout.AIChat,
      name: 'menuAppHeader.defaultNewPageName',
      prev_view_id: 'space-child-2',
    });
    expect(mockGetView).not.toHaveBeenCalled();
    expect(mockToView).toHaveBeenCalledWith('chat-id');
  });

  it('uses only direct document child IDs when the parent is a page', async () => {
    const nestedDocument = view({ view_id: 'nested-document-id' });
    const directDocument = view({
      view_id: 'direct-document-id',
      children: [nestedDocument],
    });
    const directDatabase = view({
      view_id: 'direct-database-id',
      layout: ViewLayout.Grid,
    });
    const secondDirectDocument = view({ view_id: 'second-direct-document-id' });
    const page = view({
      view_id: 'page-id',
      children: [directDocument, directDatabase, secondDirectDocument],
    });

    mockGetView.mockResolvedValue(page);

    render(<AddPageActions view={page} />);
    fireEvent.click(screen.getByTestId('add-ai-chat-button'));

    await waitFor(() =>
      expect(mockUpdateChatSettings).toHaveBeenCalledWith({
        full_workspace: false,
        rag_ids: ['direct-document-id', 'second-direct-document-id'],
      })
    );

    const settings = mockUpdateChatSettings.mock.calls[0][0] as { rag_ids: string[] };

    expect(settings.rag_ids).not.toContain('page-id');
    expect(settings.rag_ids).not.toContain('nested-document-id');
    expect(settings.rag_ids).not.toContain('direct-database-id');
    expect(mockAddPage).toHaveBeenCalledWith('page-id', {
      layout: ViewLayout.AIChat,
      name: 'menuAppHeader.defaultNewPageName',
      prev_view_id: 'second-direct-document-id',
    });
    expect(mockGetView).toHaveBeenCalledWith('page-id');
    expect(mockToView).toHaveBeenCalledWith('chat-id');
  });
});
