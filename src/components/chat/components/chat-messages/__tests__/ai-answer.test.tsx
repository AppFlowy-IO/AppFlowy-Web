import { fireEvent, render, screen } from '@testing-library/react';

import { AIAnswer } from '@/components/chat/components/chat-messages/ai-answer';
import { ResponseFormatProvider, useResponseFormatContext } from '@/components/chat/provider/response-format-provider';
import { OutputContent, OutputLayout } from '@/components/chat/types/request';

const mockEmptySources: never[] = [];
const mockRegenerateAnswer = jest.fn();
const mockHandlers = { regenerateAnswer: mockRegenerateAnswer };
const mockAnswerRender = jest.fn(
  ({ mdContent, onRegenerateImage }: { mdContent: string; onRegenerateImage: () => void }) => (
    <button onClick={onRegenerateImage}>{mdContent}</button>
  )
);

jest.mock('@/components/chat/chat/context', () => ({ useChatContext: () => ({ chatId: 'chat' }) }));
jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => mockHandlers,
}));
jest.mock('@/components/chat/provider/messages-provider', () => ({
  useChatMessagesContext: () => ({ getQuestionId: (answerId: number) => answerId === 87 ? 1 : answerId - 1 }),
}));
jest.mock('@/components/chat/components/chat-messages/message-sources', () => ({
  useResolvedMessageSources: () => mockEmptySources,
  ResolvedMessageSources: () => null,
}));
jest.mock('@/components/chat/components/chat-messages/answer-md', () => ({
  AnswerMd: (props: { mdContent: string; onRegenerateImage: () => void }) => mockAnswerRender(props),
}));
jest.mock('@/components/chat/components/chat-messages/message-actions', () => ({ MessageActions: () => null }));
jest.mock('@/components/chat/components/chat-messages/message-checkbox', () => ({ __esModule: true, default: () => null }));

function DraftPrompt() {
  const { imageOptions, setImageOptions } = useResponseFormatContext();

  return (
    <input
      aria-label='Image prompt'
      value={imageOptions.customImagePrompt}
      onChange={(event) => setImageOptions({ customImagePrompt: event.target.value })}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

describe('AIAnswer', () => {
  it('regenerates the linked question when an edited answer has a nonconsecutive ID', () => {
    render(
      <ResponseFormatProvider>
        <AIAnswer id={87} content='Replacement answer' isHovered={false} />
      </ResponseFormatProvider>
    );

    fireEvent.click(screen.getByText('Replacement answer'));
    expect(mockRegenerateAnswer).toHaveBeenCalledWith(1, {
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.TEXT,
    });
  });

  it('keeps historical answer trees unchanged while typing an image prompt', () => {
    const view = (firstAnswer = 'Answer 0') => (
      <ResponseFormatProvider>
        <DraftPrompt />
        {Array.from({ length: 25 }, (_, index) => (
          <AIAnswer
            key={index}
            id={index * 2 + 2}
            content={index === 0 ? firstAnswer : `Answer ${index}`}
            isHovered={false}
          />
        ))}
      </ResponseFormatProvider>
    );
    const { rerender } = render(view());

    expect(mockAnswerRender).toHaveBeenCalledTimes(25);
    fireEvent.change(screen.getByLabelText('Image prompt'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Image prompt'), { target: { value: 'xy' } });
    expect(mockAnswerRender).toHaveBeenCalledTimes(25);

    fireEvent.click(screen.getByText('Answer 0'));
    expect(mockRegenerateAnswer).toHaveBeenCalledWith(1, {
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.TEXT,
    });

    // Content changes must still reach the renderer after draft edits.
    rerender(view('Updated answer'));
    expect(screen.getByText('Updated answer')).toBeTruthy();
  });
});
