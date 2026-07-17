import { fireEvent, render, screen } from '@testing-library/react';

import { SearchAIOverview } from '@/components/app/search/SearchAIOverview';

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
  it('passes the raw row RAG ID together with its database owner', () => {
    const onAskAI = jest.fn();

    render(
      <SearchAIOverview
        askingAI={false}
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
});
