import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';

import { ChatInput } from '@/components/chat/components/chat-input';
import { ResponseFormatProvider } from '@/components/chat/provider/response-format-provider';
import { OutputContent, OutputLayout } from '@/components/chat/types/request';

const mockSubmitQuestion = jest.fn();
const mockUploadFile = jest.fn();
const mockTranslate = (key: string) => key;
const mockHandlers = {
  submitQuestion: mockSubmitQuestion,
  cancelAnswerStream: jest.fn(),
  answerApplying: false,
  questionSending: false,
  chatSettings: null,
  updateChatSettings: jest.fn(),
  registerChatSettingsFlush: jest.fn(() => jest.fn()),
  refreshRagScope: jest.fn(),
  ragScopeState: { status: 'ready' },
  setEditingQuestionId: jest.fn(),
};

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('lodash-es/debounce', () => ({ __esModule: true, default: jest.requireActual('lodash/debounce') }));
jest.mock('@/application/services/js-services/http/http_api', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));
jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({ chatId: 'chat', workspaceId: 'ws', currentUser: { uuid: 'me' } }),
}));
jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => mockHandlers,
}));
jest.mock('@/components/chat/provider/messages-provider', () => ({
  useChatMessagesContext: () => ({ messageIds: [], getMessage: jest.fn() }),
}));
jest.mock('@/components/chat/provider/suggestions-provider', () => ({
  useSuggestionsContext: () => ({ getMessageSuggestions: jest.fn() }),
}));
jest.mock('@/components/chat/provider/prompt-modal-provider', () => ({
  usePromptModal: () => ({
    openModal: jest.fn(),
    updateCurrentPromptId: jest.fn(),
    reloadDatabasePrompts: jest.fn(),
  }),
}));
jest.mock('@/components/chat/components/chat-input/model-selector', () => ({ ModelSelector: () => null }));
jest.mock('@/components/chat/components/chat-input/prompt-modal', () => ({ PromptModal: () => null }));
jest.mock('@/components/chat/components/chat-input/chat-settings', () => ({ ChatSettingsButton: () => null }));
jest.mock('@/components/chat/components/chat-input/image-options', () => ({ ImageOptionsButton: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

const revokeObjectURL = jest.fn();
const image = (name: string) => new File(['image'], name, { type: 'image/png' });
const view = () => (
  <ResponseFormatProvider>
    <ChatInput />
  </ResponseFormatProvider>
);

async function attach(name: string) {
  await act(async () => {
    fireEvent.drop(screen.getByTestId('chat-input-container'), { dataTransfer: { files: [image(name)] } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHandlers.questionSending = false;
  mockSubmitQuestion.mockReset().mockResolvedValue(undefined);
  mockUploadFile.mockReset().mockImplementation((_ws: string, _chat: string, file: File) =>
    Promise.resolve(`https://cloud/blob/${file.name}`)
  );
  Object.assign(URL, {
    createObjectURL: jest.fn((file: File) => `blob:${file.name}`),
    revokeObjectURL,
  });
});

afterEach(() => jest.restoreAllMocks());

describe('ChatInput submission', () => {
  it('refreshes the source scope when the picker opens with @', async () => {
    render(view());

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox'), { key: '@' });
    });

    expect(screen.getByTestId('chat-related-views-popover')).toBeTruthy();
    expect(mockHandlers.refreshRagScope).toHaveBeenCalledTimes(1);
  });

  it.each(['text/plain', 'text/uri-list'])('preserves native %s drops in the textarea', (type) => {
    render(view());
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');
    const dataTransfer = { files: [], types: [type], getData: () => 'Dragged text or link' };
    const dragOver = createEvent.dragOver(input, { dataTransfer });
    const drop = createEvent.drop(input, { dataTransfer });

    fireEvent(input, dragOver);
    fireEvent(input, drop);

    expect(dragOver.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('clears an accepted draft and releases its attachment preview', async () => {
    render(view());
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.change(input, { target: { value: 'First question' } });
    await attach('first.png');
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-input-send'));
    });

    expect(mockSubmitQuestion).toHaveBeenCalledWith('[IMAGE:https://cloud/blob/first.png]\nFirst question', {
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.TEXT,
    });
    expect(input.value).toBe('');
    expect(screen.queryByTestId('chat-attachment-chip')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first.png');
  });

  it.each(['uploading', 'ready'])(
    'keeps newer text and a newer %s attachment when the earlier send is accepted',
    async (status) => {
      const submission = deferred<void>();
      const nextUpload = deferred<string>();

      mockSubmitQuestion.mockReturnValueOnce(submission.promise);
      const { rerender } = render(view());
      const input = screen.getByRole<HTMLTextAreaElement>('textbox');

      fireEvent.change(input, { target: { value: 'First question' } });
      await attach('first.png');
      fireEvent.click(screen.getByTestId('chat-input-send'));
      expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);

      mockHandlers.questionSending = true;
      rerender(view());
      fireEvent.change(input, { target: { value: 'Next question draft' } });
      mockUploadFile.mockReturnValueOnce(nextUpload.promise);
      await attach('next.png');
      if (status === 'ready') {
        await act(async () => nextUpload.resolve('https://cloud/blob/next.png'));
      }

      await act(async () => submission.resolve());

      expect(input.value).toBe('Next question draft');
      expect(screen.getAllByTestId('chat-attachment-chip')).toHaveLength(1);
      expect(screen.getByTestId('chat-attachment-chip').textContent).toContain('next.png');
      expect(screen.getByTestId('chat-attachment-chip').getAttribute('data-status')).toBe(status);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:first.png');
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:next.png');

      await act(async () => nextUpload.resolve('https://cloud/blob/next.png'));
      mockHandlers.questionSending = false;
      rerender(view());
      await act(async () => {
        fireEvent.click(screen.getByTestId('chat-input-send'));
      });
      expect(mockSubmitQuestion).toHaveBeenLastCalledWith(
        '[IMAGE:https://cloud/blob/next.png]\nNext question draft',
        expect.anything()
      );
    }
  );

  it('keeps a draft retyped with the same text while a send is pending', async () => {
    const submission = deferred<void>();

    mockSubmitQuestion.mockReturnValueOnce(submission.promise);
    render(view());
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.change(input, { target: { value: 'Question' } });
    fireEvent.click(screen.getByTestId('chat-input-send'));
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: 'Question' } });
    await act(async () => submission.resolve());

    expect(input.value).toBe('Question');
  });

  it('keeps the draft and attachment when submission is rejected', async () => {
    const submission = deferred<void>();

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSubmitQuestion.mockReturnValueOnce(submission.promise);
    render(view());
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.change(input, { target: { value: 'Question' } });
    await attach('first.png');
    fireEvent.click(screen.getByTestId('chat-input-send'));
    await act(async () => submission.reject(new Error('Submission failed')));

    expect(input.value).toBe('Question');
    expect(screen.getByTestId('chat-attachment-chip').textContent).toContain('first.png');
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
