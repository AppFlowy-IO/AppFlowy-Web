import { fireEvent, render, screen } from '@testing-library/react';

import { InlineCommentComposer } from '../InlineCommentComposer';

jest.mock('@mui/material', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const cancelPendingComment = jest.fn();
const submitPendingComment = jest.fn().mockResolvedValue(undefined);

jest.mock('../InlineCommentContext', () => ({
  useInlineCommentContext: () => ({
    cancelPendingComment,
    mutatingCommentIds: new Set(),
    pendingComment: {
      selection: {
        blockId: 'block-1',
        quotedText: 'selected text',
        range: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 8 },
        },
      },
      rect: { top: 20, right: 100, bottom: 40, left: 20 },
    },
    submitPendingComment,
  }),
}));

describe('InlineCommentComposer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits with Enter while Shift+Enter remains a newline action', () => {
    render(<InlineCommentComposer />);
    const input = screen.getByTestId('inline-comment-input');

    fireEvent.change(input, { target: { value: 'Review this' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(submitPendingComment).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submitPendingComment).toHaveBeenCalledWith('Review this');
  });

  it('dismisses with Escape or an outside pointer press', () => {
    const { unmount } = render(<InlineCommentComposer />);

    fireEvent.keyDown(screen.getByTestId('inline-comment-input'), { key: 'Escape' });
    expect(cancelPendingComment).toHaveBeenCalledTimes(1);

    unmount();
    render(<InlineCommentComposer />);
    fireEvent.pointerDown(document.body);
    expect(cancelPendingComment).toHaveBeenCalledTimes(2);
  });
});
