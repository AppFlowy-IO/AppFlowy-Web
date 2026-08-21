import { render, waitFor } from '@testing-library/react';

import { EmptyMessages } from '@/components/chat/components/chat-messages/empty-messages';

const mockSubmitQuestion = jest.fn().mockResolvedValue(undefined);
const mockUpdateChatSettings = jest.fn().mockResolvedValue(undefined);
let mockScopeStatus: 'loading' | 'ready' = 'loading';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => ({
    chatSettings: {
      metadata: { initial_prompt: 'Ask after validation' },
    },
    submitQuestion: mockSubmitQuestion,
    updateChatSettings: mockUpdateChatSettings,
    ragScopeState: { status: mockScopeStatus },
  }),
}));

describe('EmptyMessages initial prompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScopeStatus = 'loading';
  });

  it('waits for the authoritative RAG scope before submitting', async () => {
    const { rerender } = render(<EmptyMessages />);

    expect(mockSubmitQuestion).not.toHaveBeenCalled();

    mockScopeStatus = 'ready';
    rerender(<EmptyMessages />);

    await waitFor(() => expect(mockSubmitQuestion).toHaveBeenCalledWith('Ask after validation'));
    expect(mockUpdateChatSettings).toHaveBeenCalledWith({
      metadata: {
        initial_prompt: 'Ask after validation',
        initial_prompt_consumed: true,
      },
    });
  });
});
