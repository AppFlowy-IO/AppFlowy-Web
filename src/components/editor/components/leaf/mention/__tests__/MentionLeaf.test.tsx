import { render, screen } from '@testing-library/react';

import { MentionType } from '@/application/types';

import MentionLeaf from '../MentionLeaf';

const mockMentionDatabase = jest.fn(({ title }: { title?: string }) => (
  <span data-testid='mention-database'>{title}</span>
));
const mockMentionPage = jest.fn(() => <span data-testid='mention-page' />);

jest.mock('slate-react', () => ({
  useReadOnly: () => false,
  useSlateStatic: () => ({ isElementReadOnly: () => false }),
}));

jest.mock('@/components/editor/components/leaf/leaf.hooks', () => ({
  useLeafSelected: () => ({ isSelected: false, select: jest.fn(), isCursorBefore: false }),
}));

jest.mock('@/components/editor/components/leaf/mention/MentionDatabase', () => ({
  __esModule: true,
  default: (props: { title?: string }) => mockMentionDatabase(props),
}));

jest.mock('@/components/editor/components/leaf/mention/MentionPage', () => ({
  __esModule: true,
  default: () => mockMentionPage(),
}));

jest.mock('@/components/editor/components/leaf/mention/MentionDate', () => () => null);
jest.mock('@/components/editor/components/leaf/mention/MentionExternalLink', () => () => null);
jest.mock('@/components/editor/components/leaf/mention/MentionPerson', () => ({ MentionPerson: () => null }));

describe('MentionLeaf database references', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a titled database reference without requiring a row id', () => {
    render(
      <MentionLeaf
        mention={{
          type: MentionType.PageRef,
          page_id: 'database-view-id',
          database_id: 'database-id',
          database_view_id: 'database-view-id',
          data: { title: 'Project tracker' },
        }}
        text={{ text: '' }}
      >
        {' '}
      </MentionLeaf>
    );

    expect(screen.getByTestId('mention-database').textContent).toBe('Project tracker');
    expect(screen.queryByTestId('mention-page')).toBeNull();
  });

  it('keeps legacy title-less database references on the page renderer', () => {
    render(
      <MentionLeaf
        mention={{
          type: MentionType.PageRef,
          page_id: 'database-view-id',
          database_id: 'database-id',
          database_view_id: 'database-view-id',
        }}
        text={{ text: '' }}
      >
        {' '}
      </MentionLeaf>
    );

    expect(screen.getByTestId('mention-page')).toBeTruthy();
    expect(screen.queryByTestId('mention-database')).toBeNull();
  });
});
