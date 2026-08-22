import { fireEvent, render, screen } from '@testing-library/react';

import { InlineCommentComposer } from '../InlineCommentComposer';

const mockPortal = jest.fn(({ children }: { children: React.ReactNode; container?: HTMLElement }) => children);

jest.mock('@mui/material', () => ({
  Portal: (props: { children: React.ReactNode; container?: HTMLElement }) => mockPortal(props),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const cancelPendingComment = jest.fn();
const submitPendingComment = jest.fn().mockResolvedValue(undefined);
let mockMutatingCommentIds = new Set<string>();

jest.mock('../InlineCommentContext', () => ({
  useInlineCommentStatus: () => ({ mutatingCommentIds: mockMutatingCommentIds }),
  useInlineCommentCompose: () => ({
    cancelPendingComment,
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
    mockMutatingCommentIds = new Set();
  });

  it('renders the compact desktop compose menu', () => {
    render(<InlineCommentComposer />);

    expect(mockPortal).toHaveBeenCalledWith(expect.not.objectContaining({ container: expect.anything() }));
    expect(screen.getByTestId('inline-comment-input').getAttribute('placeholder')).toBe('inlineComment.writeComment');
    // Desktop's compose menu is a single input row: no quote preview, no cancel.
    expect(screen.queryByText('selected text')).toBeNull();
    expect(screen.queryByText('button.cancel')).toBeNull();
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

  it('shows a loading indicator while the comment is being submitted', () => {
    mockMutatingCommentIds = new Set(['new']);
    render(<InlineCommentComposer />);

    const submitButton = screen.getByTestId('inline-comment-submit');

    expect(submitButton.getAttribute('aria-busy')).toBe('true');
    expect(submitButton.disabled).toBe(true);
    expect(screen.queryByTestId('inline-comment-submit-loading')).not.toBeNull();
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
