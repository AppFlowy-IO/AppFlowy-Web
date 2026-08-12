import { renderHook } from '@testing-library/react';

import { YjsEditor } from '@/application/slate-yjs';

import { useInlineCommentActionEnabled } from '../InlineCommentAction';

let mockCurrentEditor = {} as YjsEditor;
let mockRegisteredEditor: YjsEditor | null = mockCurrentEditor;
let mockCanComment = true;

jest.mock('slate-react', () => ({
  useSlate: () => mockCurrentEditor,
}));

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ canComment: mockCanComment }),
}));

jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentComposeOptional: () => ({
    active: true,
    isEditorRegistered: (editor: YjsEditor) => editor === mockRegisteredEditor,
  }),
}));

describe('useInlineCommentActionEnabled', () => {
  beforeEach(() => {
    mockCurrentEditor = {} as YjsEditor;
    mockRegisteredEditor = mockCurrentEditor;
    mockCanComment = true;
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
});
