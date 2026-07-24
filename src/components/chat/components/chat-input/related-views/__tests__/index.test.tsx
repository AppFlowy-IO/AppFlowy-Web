import { act, fireEvent, render, screen } from '@testing-library/react';

import { RelatedViews } from '@/components/chat/components/chat-input/related-views';
import { ViewLayout } from '@/components/chat/types';

import type { ReactNode } from 'react';

const updateChatSettings = jest.fn().mockResolvedValue(undefined);
const refreshRagScope = jest.fn();
const registerChatSettingsFlush = jest.fn((_flush: () => Promise<void>) => jest.fn());
const mockMessagesContext = {
  chatSettings: {
    name: 'Chat',
    rag_ids: ['row-id'],
    metadata: {},
    full_workspace: false,
    web_search_enabled: false,
  },
  updateChatSettings,
  registerChatSettingsFlush,
  questionSending: false,
  ragScopeState: {
    status: 'ready',
    parentView: {
      view_id: 'parent-id',
      name: 'Parent',
      icon: null,
      layout: ViewLayout.Document,
      extra: { is_space: false },
      children: [],
      is_private: false,
    },
    scopedSettings: null,
  },
  refreshRagScope,
};

jest.mock('lodash-es/debounce', () => ({
  __esModule: true,
  default: (callback: (...args: unknown[]) => unknown) => {
    let pendingArgs: unknown[] | undefined;
    const debounced = (...args: unknown[]) => {
      pendingArgs = args;
    };

    debounced.cancel = () => {
      pendingArgs = undefined;
    };

    debounced.flush = () => {
      if (!pendingArgs) return;

      const args = pendingArgs;

      pendingArgs = undefined;
      return callback(...args);
    };

    return debounced;
  },
}));

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => (
    <div>
      <button data-testid='open-popover' onClick={() => onOpenChange(true)} />
      <button data-testid='close-popover' onClick={() => onOpenChange(false)} />
      {children}
    </div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/chat/components/ui/search-input', () => ({
  SearchInput: () => null,
}));

jest.mock('@/components/chat/components/chat-input/related-views/spaces', () => ({
  Spaces: ({ spaces, onToggle }: { spaces: Array<{ name: string }>; onToggle: (view: unknown) => void }) => (
    <button onClick={() => onToggle(spaces[0])}>Toggle source</button>
  ),
}));

jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => mockMessagesContext,
}));

describe('RelatedViews persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockMessagesContext.questionSending = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes a pending selection on unmount and retains opaque RAG sources', () => {
    const { unmount } = render(<RelatedViews />);

    expect(screen.getByTestId('chat-input-related-views').textContent).toContain('1');
    fireEvent.click(screen.getByText('Toggle source'));
    expect(screen.getByTestId('chat-input-related-views').textContent).toContain('2');
    expect(updateChatSettings).not.toHaveBeenCalled();

    unmount();

    expect(updateChatSettings).toHaveBeenCalledWith({
      rag_ids: ['parent-id', 'row-id'],
      full_workspace: false,
    });
  });

  it('registers a flush that persists the latest selection before submit', async () => {
    render(<RelatedViews />);
    fireEvent.click(screen.getByText('Toggle source'));

    const flush = registerChatSettingsFlush.mock.calls[0][0];

    await act(async () => {
      await flush();
    });

    expect(updateChatSettings).toHaveBeenCalledWith({
      rag_ids: ['parent-id', 'row-id'],
      full_workspace: false,
    });
  });

  it('does not schedule a source update after question submission begins', () => {
    mockMessagesContext.questionSending = true;
    const { unmount } = render(<RelatedViews />);

    fireEvent.click(screen.getByText('Toggle source'));
    unmount();

    expect(updateChatSettings).not.toHaveBeenCalled();
  });

  it('does not refresh from an obsolete open after the popover closes', async () => {
    let resolveWrite: () => void = () => undefined;
    const write = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });

    updateChatSettings.mockImplementationOnce(() => write);
    render(<RelatedViews />);
    fireEvent.click(screen.getByText('Toggle source'));
    fireEvent.click(screen.getByTestId('open-popover'));
    fireEvent.click(screen.getByTestId('close-popover'));

    await act(async () => {
      resolveWrite();
      await write;
    });

    expect(refreshRagScope).not.toHaveBeenCalled();
  });
});
