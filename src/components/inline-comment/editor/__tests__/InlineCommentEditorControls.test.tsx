import { fireEvent, render, screen } from '@testing-library/react';
import { Range } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';

import { InlineCommentEditorControls } from '../InlineCommentEditorControls';

const mockEditor = { selection: null } as unknown as YjsEditor;
const mockStartComment = jest.fn();
const mockToastError = jest.fn();
const mockToDOMRange = jest.fn();
const mockToSlateRange = jest.fn();

jest.mock('@mui/material', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

jest.mock('slate-react', () => ({
  ReactEditor: {
    toDOMRange: (...args: unknown[]) => mockToDOMRange(...args),
    toSlateRange: (...args: unknown[]) => mockToSlateRange(...args),
  },
  useSlate: () => mockEditor,
}));

jest.mock('@/assets/icons/toolbar_add_comment.svg', () => ({
  ReactComponent: () => <span />,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentComposeOptional: () => ({
    active: true,
    isEditorRegistered: (editor: YjsEditor) => editor === mockEditor,
    startComment: (...args: unknown[]) => mockStartComment(...args),
  }),
}));

jest.mock('../anchors', () => ({
  getInlineCommentSelection: (_editor: YjsEditor, range: Range) => ({
    blockId: 'block-1',
    quotedText: 'Review me',
    range,
  }),
}));

describe('InlineCommentEditorControls', () => {
  const selectedRange: Range = {
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [0, 0], offset: 9 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartComment.mockReturnValue(true);
    mockToSlateRange.mockReturnValue(selectedRange);
    mockToDOMRange.mockReturnValue({
      getBoundingClientRect: () => ({ height: 20, left: 100, top: 80, width: 90 }),
    });
    jest.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
    } as Selection);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('explains why a read-only selection cannot be commented on when permission is denied', () => {
    render(<InlineCommentEditorControls canComment={false} />);

    const trigger = screen.getByTestId('inline-comment-readonly-trigger').querySelector('button');

    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('inlineComment.permissionDenied')).not.toBeNull();
    fireEvent.click(trigger as HTMLButtonElement);
    expect(mockToastError).toHaveBeenCalledWith('inlineComment.permissionDenied');
    expect(mockStartComment).not.toHaveBeenCalled();
  });

  it('starts a comment from a permitted read-only selection', () => {
    render(<InlineCommentEditorControls canComment={true} />);

    const trigger = screen.getByTestId('inline-comment-readonly-trigger').querySelector('button');

    fireEvent.click(trigger as HTMLButtonElement);
    expect(mockStartComment).toHaveBeenCalledWith(mockEditor, selectedRange);
  });
});
