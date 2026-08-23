import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { YjsEditor } from '@/application/slate-yjs';

import { InlineCommentAction, useInlineCommentActionEnabled } from '../InlineCommentAction';

let mockCurrentEditor = {} as YjsEditor;
let mockRegisteredEditor: YjsEditor | null = mockCurrentEditor;
let mockCanComment = true;
const mockForceShow = jest.fn();
const mockStartComment = jest.fn();
const mockToastError = jest.fn();

jest.mock('slate-react', () => ({
  useSlate: () => mockCurrentEditor,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

jest.mock('@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton', () => ({
  __esModule: true,
  default: ({ tooltip, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }) => (
    <button data-tooltip={tooltip} {...props}>
      {children}
    </button>
  ),
}));

jest.mock('@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks', () => ({
  useSelectionToolbarContext: () => ({ forceShow: mockForceShow }),
}));

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ canComment: mockCanComment }),
}));

jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentComposeOptional: () => ({
    active: true,
    isEditorRegistered: (editor: YjsEditor) => editor === mockRegisteredEditor,
    startComment: (...args: unknown[]) => mockStartComment(...args),
  }),
}));

describe('useInlineCommentActionEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentEditor = {} as YjsEditor;
    mockRegisteredEditor = mockCurrentEditor;
    mockCanComment = true;
    mockStartComment.mockReturnValue(true);
  });

  it('is disabled when another editor owns the inline-comment provider', () => {
    mockRegisteredEditor = {} as YjsEditor;

    const { result } = renderHook(() => useInlineCommentActionEnabled());

    expect(result.current).toBe(false);
  });

  it('is enabled for the registered editor when commenting is allowed', () => {
    const { result } = renderHook(() => useInlineCommentActionEnabled());

    expect(result.current).toBe(true);
  });

  it('keeps the permission-denied action visible and explains why it cannot start', () => {
    mockCanComment = false;

    const { result } = renderHook(() => useInlineCommentActionEnabled());

    expect(result.current).toBe(true);
    render(<InlineCommentAction />);

    const action = screen.getByTestId('inline-comment-toolbar-action');

    expect(action.hasAttribute('aria-disabled')).toBe(false);
    expect(action.getAttribute('aria-label')).toBe('inlineComment.permissionDenied');
    expect(action.getAttribute('data-tooltip')).toBe('inlineComment.permissionDenied');
    fireEvent.click(action);
    expect(mockToastError).toHaveBeenCalledWith('inlineComment.permissionDenied');
    expect(mockStartComment).not.toHaveBeenCalled();
  });

  it('explains that a selection spanning unsupported blocks cannot be commented on', () => {
    render(<InlineCommentAction selectionSupported={false} />);

    const action = screen.getByTestId('inline-comment-toolbar-action');

    expect(action.getAttribute('data-tooltip')).toBe('inlineComment.unsupportedSelection');
    fireEvent.click(action);
    expect(mockToastError).toHaveBeenCalledWith('inlineComment.unsupportedSelection');
    expect(mockStartComment).not.toHaveBeenCalled();
  });

  it('reports a stale selection when the provider cannot start the composer', () => {
    mockStartComment.mockReturnValue(false);
    render(<InlineCommentAction />);

    fireEvent.click(screen.getByTestId('inline-comment-toolbar-action'));
    expect(mockToastError).toHaveBeenCalledWith('inlineComment.unsupportedSelection');
  });

  it('shows the comment label without a keyboard shortcut', () => {
    render(<InlineCommentAction />);

    expect(screen.getByTestId('inline-comment-toolbar-action').getAttribute('data-tooltip')).toBe(
      'inlineComment.addComment'
    );
  });
});
