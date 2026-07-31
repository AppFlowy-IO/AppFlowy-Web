import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import MessageSources, {
  getAppFlowySourceTarget,
  getMessageSourceLabel,
  getSafeWebSourceUrl,
} from '@/components/chat/components/chat-messages/message-sources';

const mockGetView = jest.fn();
const mockOpenView = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { sourceCount?: number }) =>
      key === 'chat.sources.label' ? `${options?.sourceCount ?? 0} sources` : key,
  }),
}));

jest.mock('@/components/chat/provider/view-loader-provider', () => ({
  useViewLoader: () => ({ getView: mockGetView }),
}));

jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({ onOpenView: mockOpenView }),
}));

describe('message sources', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers the web result title and keeps the URL as its target', () => {
    const source = {
      id: 'https://example.com/article',
      name: 'https://example.com/article',
      source: 'web',
      title: 'Example article',
      citation_id: 'W1',
    };

    expect(getMessageSourceLabel(source)).toBe('Example article');
    expect(getSafeWebSourceUrl(source)).toBe('https://example.com/article');
  });

  it('rejects unsafe web source protocols', () => {
    expect(
      getSafeWebSourceUrl({
        id: 'javascript:alert(1)',
        name: 'unsafe',
        source: 'web',
      })
    ).toBeNull();
  });

  it('keeps legacy source names when no title is available', () => {
    expect(
      getMessageSourceLabel({
        id: 'page-id',
        name: 'Roadmap',
        source: 'appflowy',
      })
    ).toBe('Roadmap');
  });

  it('renders a web source as a safe external link without loading a workspace view', () => {
    render(
      <MessageSources
        sources={[
          {
            id: 'https://example.com/article',
            name: 'https://example.com/article',
            source: 'web',
            title: 'Example article',
          },
        ]}
      />
    );

    const link = screen.getByRole('link', { name: 'Example article' });

    expect(link.getAttribute('href')).toBe('https://example.com/article');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(mockGetView).not.toHaveBeenCalled();
  });

  it('opens AppFlowy sources by object ID', async () => {
    mockGetView.mockResolvedValue({ name: 'Loaded roadmap' });
    render(
      <MessageSources
        sources={[
          {
            id: 'page-id',
            name: 'Roadmap',
            source: 'appflowy',
          },
        ]}
      />
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Loaded roadmap' })).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Loaded roadmap' }));
    expect(mockOpenView).toHaveBeenCalledWith('page-id');
  });

  it('opens cited database rows through their owning database view', async () => {
    const source = {
      id: 'row-document-id',
      name: 'Roadmap row',
      source: 'appflowy',
      title: 'Roadmap row',
      database_id: 'database-id',
      database_view_id: 'database-view-id',
      database_row_id: 'database-row-id',
    };

    expect(getAppFlowySourceTarget(source)).toEqual({
      viewId: 'database-view-id',
      rowId: 'database-row-id',
    });

    render(<MessageSources sources={[source]} />);

    expect(mockGetView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Roadmap row' }));
    expect(mockOpenView).toHaveBeenCalledWith('database-view-id', 'database-row-id');
  });
});
