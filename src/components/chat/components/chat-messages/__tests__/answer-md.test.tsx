import { render, waitFor } from '@testing-library/react';

import { AnswerMd } from '@/components/chat/components/chat-messages/answer-md';
import type { ResolvedMessageSource } from '@/components/chat/components/chat-messages/message-sources';

const mockApplyMarkdown = jest.fn();

jest.mock('@appflowyinc/editor', () => ({
  Editor: () => <div data-testid='answer-editor' />,
  useEditor: () => ({ applyMarkdown: mockApplyMarkdown }),
}));

describe('AnswerMd', () => {
  beforeEach(() => {
    mockApplyMarkdown.mockClear();
  });

  it('applies citation-resolved markdown to the editor', async () => {
    const sources: ResolvedMessageSource[] = [
      {
        metadata: {
          citation_id: 'W2',
          id: 'https://example.com/kanban',
          name: 'https://example.com/kanban',
          source: 'web',
          title: 'Kanban Guide',
        },
        label: 'Kanban Guide',
      },
    ];

    render(<AnswerMd mdContent='Use a pull system [W2].' sources={sources} />);

    await waitFor(() => expect(mockApplyMarkdown).toHaveBeenCalledWith('Use a pull system 【Kanban Guide】.'));
  });
});
