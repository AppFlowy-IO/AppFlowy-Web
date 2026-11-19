import { fireEvent, render, screen } from '@testing-library/react';

import { Error as WriterError } from '@/components/chat/components/ai-writer/error';
import { AssistantMessage } from '@/components/chat/components/chat-messages/assistant-message';
import { ERROR_CODE_NO_LIMIT } from '@/components/chat/lib/const';

let mockOfficialHosted = false;
let mockError = { code: ERROR_CODE_NO_LIMIT, message: 'The server AI allowance has been exhausted' };
const mockFetchAnswerStream = jest.fn();
const mockTranslate = (key: string) => key;
const mockBusy = { answerApplying: false, questionSending: false };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/components/app/app.hooks', () => ({ useIsOfficialHosted: () => mockOfficialHosted }));
jest.mock('@/components/chat/writer/context', () => ({
  useWriterContext: () => ({ error: mockError, rewrite: jest.fn() }),
}));
jest.mock('@appflowyinc/editor', () => ({ EditorProvider: () => null }));
jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => ({
    fetchAnswerStream: mockFetchAnswerStream,
    regenerateAnswer: jest.fn(),
    ...mockBusy,
  }),
}));
jest.mock('@/components/chat/provider/messages-provider', () => ({
  useChatMessagesContext: () => ({ getMessage: () => undefined, getQuestionId: () => 1 }),
}));
// OutputLayout.Flex and OutputContent.TEXT: the automatic text format.
const mockAnswerFormat = { output_layout: 4, output_content: 0 };

jest.mock('@/components/chat/provider/response-format-provider', () => ({
  useMessageResponseFormatContext: () => ({ resolveAnswerFormat: () => mockAnswerFormat }),
}));
jest.mock('@/components/chat/provider/suggestions-provider', () => ({
  useSuggestionsContext: () => ({ getMessageSuggestions: () => undefined }),
}));
jest.mock('../answer-md', () => ({ AnswerMd: () => null }));
jest.mock('../message-actions', () => ({ MessageActions: () => null }));
jest.mock('../message-suggestions', () => ({ MessageSuggestions: () => null }));
jest.mock('../message-checkbox', () => ({ __esModule: true, default: () => null }));
jest.mock('../message-sources', () => ({ useResolvedMessageSources: () => [], ResolvedMessageSources: () => null }));

beforeEach(() => {
  mockOfficialHosted = false;
  mockBusy.answerApplying = false;
  mockBusy.questionSending = false;
  mockFetchAnswerStream.mockClear();
  mockError = { code: ERROR_CODE_NO_LIMIT, message: 'The server AI allowance has been exhausted' };
  mockFetchAnswerStream.mockImplementation(async () => {
    throw mockError;
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it.each(['answerApplying', 'questionSending'] as const)('blocks Retry while %s is active', async (busyFlag) => {
  mockFetchAnswerStream.mockRejectedValue(new Error('Temporary failure'));
  const { rerender } = render(<AssistantMessage id={2} isHovered={false} />);
  const retry = await screen.findByTestId<HTMLButtonElement>('chat-answer-retry');

  mockBusy[busyFlag] = true;
  rerender(<AssistantMessage id={2} isHovered={false} />);
  expect(retry.disabled).toBe(true);
  fireEvent.click(retry);
  expect(mockFetchAnswerStream).toHaveBeenCalledTimes(1);

  mockBusy[busyFlag] = false;
  rerender(<AssistantMessage id={2} isHovered={false} />);
  expect(retry.disabled).toBe(false);
  fireEvent.click(retry);
  expect(mockFetchAnswerStream).toHaveBeenCalledTimes(2);
  await screen.findByTestId('chat-answer-retry');
});

it.each(['writer', 'chat'])(
  'preserves self-hosted %s quota guidance and only shows the upgrade on official cloud',
  async (surface) => {
    const view = surface === 'writer' ? <WriterError /> : <AssistantMessage id={2} isHovered={false} />;
    const { rerender } = render(view);

    expect(await screen.findByText('This workspace has reached its AI response limit.')).toBeTruthy();
    expect(screen.queryByText(/responseLimit/)).toBeNull();

    mockOfficialHosted = true;
    rerender(surface === 'writer' ? <WriterError /> : <AssistantMessage id={2} isHovered={false} />);
    expect(
      screen.getByText(surface === 'writer' ? 'chat.writer.errors.responseLimit' : 'chat.errors.responseLimit')
    ).toBeTruthy();
  }
);

it.each(['writer', 'chat'])(
  'uses neutral fallback copy for a self-hosted %s error without a message',
  async (surface) => {
    mockError.message = '';
    render(surface === 'writer' ? <WriterError /> : <AssistantMessage id={2} isHovered={false} />);

    expect(await screen.findByText('This workspace has reached its AI response limit.')).toBeTruthy();
    expect(screen.queryByText(/responseLimit/)).toBeNull();
  }
);
