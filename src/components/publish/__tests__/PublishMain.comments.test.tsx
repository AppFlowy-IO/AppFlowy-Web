import { render, screen } from '@testing-library/react';

import type { PublishedPageSnapshot } from '@/application/publish-snapshot/types';
import PublishMain from '@/components/publish/PublishMain';

let mockCommentEnabled: boolean | undefined;

jest.mock('@/application/publish', () => ({
  usePublishContext: () => ({ commentEnabled: mockCommentEnabled }),
}));

jest.mock('@/components/global-comment', () => ({
  GlobalCommentProvider: () => <div data-testid='comment-panel' />,
}));

jest.mock('@/components/publish-render/PublishSnapshotView', () => ({
  PublishSnapshotView: () => <div data-testid='published-page' />,
}));

jest.mock('@/components/publish/comment', () => ({
  shouldDisableFixedGlobalCommentInput: () => false,
}));

const snapshot = {} as PublishedPageSnapshot;

describe('PublishMain comment visibility', () => {
  it('shows the comment panel when comments are enabled', () => {
    mockCommentEnabled = true;

    render(<PublishMain snapshot={snapshot} isTemplate={false} />);

    expect(screen.getByTestId('comment-panel')).toBeTruthy();
  });

  it('does not show the comment panel when comments are disabled', () => {
    mockCommentEnabled = false;

    render(<PublishMain snapshot={snapshot} isTemplate={false} />);

    expect(screen.queryByTestId('comment-panel')).toBeNull();
  });
});
