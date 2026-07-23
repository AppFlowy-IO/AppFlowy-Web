import { fireEvent, render, screen } from '@testing-library/react';

import { SearchAIOverview } from '@/components/app/search/SearchAIOverview';

const mockAnswerMd = jest.fn(({ mdContent }: { mdContent: string }) => (
  <div data-testid='ai-overview-markdown'>{mdContent}</div>
));

jest.mock('@appflowyinc/editor', () => ({
  EditorProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/chat/components/chat-messages/answer-md', () => ({
  AnswerMd: (props: { mdContent: string }) => mockAnswerMd(props),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useToView: () => jest.fn(),
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: () => null,
}));

describe('SearchAIOverview', () => {
  beforeEach(() => {
    mockAnswerMd.mockClear();
  });

  it('renders the complete overview with the shared Markdown editor', () => {
    render(
      <SearchAIOverview
        askingAI={false}
        canAskFollowUp={false}
        loading={false}
        query='revenue'
        summary={{ content: '# Revenue\n\n**Increased.**' }}
        sources={[]}
        onAskAI={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(mockAnswerMd).toHaveBeenCalledWith({
      mdContent: '# Revenue\n\n**Increased.**',
    });
    expect(screen.getByTestId('ai-overview-markdown')).toBeTruthy();
  });

  it('passes the raw row RAG ID together with its database owner', () => {
    const onAskAI = jest.fn();

    render(
      <SearchAIOverview
        askingAI={false}
        canAskFollowUp={true}
        loading={false}
        query='revenue'
        summary={{ content: 'Revenue increased.' }}
        sources={[
          {
            id: 'row-id',
            name: 'Revenue database',
            targetViewId: 'database-view-id',
            ragId: 'row-id',
            ownerViewId: 'database-view-id',
            ownerDatabaseId: 'database-id',
          },
        ]}
        onAskAI={onAskAI}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('Ask follow-up'));

    expect(onAskAI).toHaveBeenCalledWith([
      {
        ragId: 'row-id',
        ownerViewId: 'database-view-id',
        ownerDatabaseId: 'database-id',
      },
    ]);
  });

  it('does not offer a follow-up when cited sources cannot be routed safely', () => {
    render(
      <SearchAIOverview
        askingAI={false}
        canAskFollowUp={false}
        loading={false}
        query='revenue'
        summary={{ content: 'Revenue increased.' }}
        sources={[]}
        onAskAI={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.queryByText('Ask follow-up')).toBeNull();
  });
});
