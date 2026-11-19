import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import HumanQuestion from '@/components/chat/components/chat-messages/human-question';

const mockEditQuestion = jest.fn();
const mockSetEditingQuestionId = jest.fn();
let mockEditingQuestionId: number | null = null;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({ currentUser: { uuid: 'me' } }),
}));
jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => ({
    editQuestion: mockEditQuestion,
    editingQuestionId: mockEditingQuestionId,
    setEditingQuestionId: mockSetEditingQuestionId,
    answerApplying: false,
    questionSending: false,
  }),
}));
jest.mock('@/components/chat/components/chat-messages/generated-image', () => ({
  GeneratedImage: ({ url }: { url: string }) => <img alt='attachment' data-testid='attachment-image' src={url} />,
}));
jest.mock('@/utils/download', () => ({ openFileUrl: jest.fn() }));

const fetchMember = jest.fn().mockResolvedValue({ uuid: 'me', name: 'Nathan', email: '', avatar: '' });

beforeEach(() => {
  mockEditQuestion.mockReset();
  mockSetEditingQuestionId.mockReset();
  mockEditingQuestionId = null;
});

describe('HumanQuestion', () => {
  it('shows attachments as previews and keeps the markers out of the text', async () => {
    render(
      <HumanQuestion
        id={5}
        userId='me'
        fetchMember={fetchMember}
        content={
          '[IMAGE:https://cloud/api/file_storage/ws/v1/blob/chat/a.png] [FILE:https://cloud/f/notes.pdf]\nWhat is in these?'
        }
      />
    );

    expect(screen.getByText('What is in these?')).toBeTruthy();
    expect(screen.getByTestId('attachment-image').getAttribute('src')).toBe(
      'https://cloud/api/file_storage/ws/v1/blob/chat/a.png'
    );
    expect(screen.getByText('notes.pdf')).toBeTruthy();
    expect(screen.queryByText(/\[IMAGE:/)).toBeNull();
    await waitFor(() => expect(fetchMember).toHaveBeenCalledWith('me'));
  });

  it('enters edit mode from the button and resends with attachments preserved', async () => {
    mockEditingQuestionId = 5;
    render(
      <HumanQuestion
        id={5}
        userId='me'
        fetchMember={fetchMember}
        content={'[IMAGE:https://cloud/api/file_storage/ws/v1/blob/chat/a.png]\nOld question'}
      />
    );

    const input = screen.getByTestId('chat-question-edit-input');

    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe('Old question'));
    fireEvent.change(input, { target: { value: 'New question' } });
    fireEvent.click(screen.getByTestId('chat-question-edit-save'));

    await waitFor(() =>
      expect(mockEditQuestion).toHaveBeenCalledWith(
        5,
        '[IMAGE:https://cloud/api/file_storage/ws/v1/blob/chat/a.png]\nNew question'
      )
    );
  });

  it('does not offer editing for other people\'s questions', () => {
    render(<HumanQuestion id={7} userId='someone-else' fetchMember={fetchMember} content='Theirs' />);

    expect(screen.queryByTestId('chat-question-edit')).toBeNull();
  });

  it('ignores an edit request for a question someone else asked', () => {
    mockEditingQuestionId = 7;
    render(<HumanQuestion id={7} userId='someone-else' fetchMember={fetchMember} content='Theirs' />);

    expect(screen.queryByTestId('chat-question-edit-input')).toBeNull();
    expect(screen.getByText('Theirs')).toBeTruthy();
  });
});
