import { render, screen } from '@testing-library/react';

import { Error as WriterError } from '@/components/chat/components/ai-writer/error';
import { AssistantMessage } from '@/components/chat/components/chat-messages/assistant-message';
import { ERROR_CODE_NO_LIMIT } from '@/components/chat/lib/const';

let mockOfficialHosted = false;
let mockError = { code: ERROR_CODE_NO_LIMIT, message: 'The server AI allowance has been exhausted' };
const mockFetchAnswerStream = jest.fn();
const mockTranslate = (key: string) => key;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/components/app/app.hooks', () => ({ useIsOfficialHosted: () => mockOfficialHosted }));
jest.mock('@/components/chat/writer/context', () => ({
  useWriterContext: () => ({ error: mockError, rewrite: jest.fn() }),
}));
jest.mock('@appflowyinc/editor', () => ({ EditorProvider: () => null }));
jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => ({ fetchAnswerStream: mockFetchAnswerStream }),
}));
jest.mock('@/components/chat/provider/messages-provider', () => ({
  useChatMessagesContext: () => ({ getMessage: () => undefined }),
}));
jest.mock('@/components/chat/provider/response-format-provider', () => ({ useResponseFormatContext: () => ({}) }));
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
  mockError = { code: ERROR_CODE_NO_LIMIT, message: 'The server AI allowance has been exhausted' };
  mockFetchAnswerStream.mockImplementation(async () => {
    throw mockError;
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it.each(['writer', 'chat'])(
  'preserves self-hosted %s quota guidance and only shows the upgrade on official cloud',
  async (surface) => {
    const view = surface === 'writer' ? <WriterError /> : <AssistantMessage id={2} isHovered={false} />;
    const { rerender } = render(view);

    expect(await screen.findByText(mockError.message)).toBeTruthy();
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

    expect(await screen.findByText('chat.errors.responseUnavailable')).toBeTruthy();
    expect(screen.queryByText(/responseLimit/)).toBeNull();
  }
);
