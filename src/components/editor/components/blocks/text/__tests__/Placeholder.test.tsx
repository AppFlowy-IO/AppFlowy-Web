import { render } from '@testing-library/react';
import type { Editor, Element } from 'slate';

import { BlockType } from '@/application/types';
import Placeholder from '../Placeholder';

const ACTIVE_PLACEHOLDER = "Type '/' to insert a block, or start typing";
const EMPTY_DOCUMENT_PLACEHOLDER = 'Enter a / to insert a block, or start typing';

const originalTextNode = {
  type: 'text',
  textId: 'original-text',
  children: [{ text: '' }],
} as unknown as Element;
const secondTextNode = {
  type: 'text',
  textId: 'second-text',
  children: [{ text: '' }],
} as unknown as Element;
const originalParagraph = {
  blockId: 'original-paragraph',
  type: BlockType.Paragraph,
  children: [originalTextNode],
} as unknown as Element;
const secondParagraph = {
  blockId: 'second-paragraph',
  type: BlockType.Paragraph,
  children: [secondTextNode],
} as unknown as Element;
const mockEditor = {
  children: [originalParagraph],
  selection: {
    anchor: { path: [0, 0, 0], offset: 0 },
    focus: { path: [0, 0, 0], offset: 0 },
  },
} as unknown as Editor;
const mockEditorDom = document.createElement('div');
const mockUseSelected = jest.fn();

const translations: Record<string, string> = {
  'cardDetails.notesPlaceholder': EMPTY_DOCUMENT_PLACEHOLDER,
  'editor.slashPlaceHolder': ACTIVE_PLACEHOLDER,
};
const mockT = (key: string) => translations[key] ?? key;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

jest.mock('slate', () => ({
  Editor: {
    above: (_editor: Editor, options: { at: number[]; match: (node: Element) => boolean }) => {
      const block = options.at[0] === 0 ? originalParagraph : secondParagraph;

      return options.match(block) ? [block, [options.at[0]]] : undefined;
    },
    isEditor: () => false,
  },
  Element: {
    isElement: () => true,
  },
  Range: {
    isCollapsed: () => true,
  },
}));

jest.mock('slate-react', () => ({
  ReactEditor: {
    findPath: (_editor: Editor, node: Element) => (node === originalTextNode ? [0, 0] : [1, 0]),
    toDOMNode: () => mockEditorDom,
  },
  useFocused: () => true,
  useSelected: () => mockUseSelected(),
  useSlate: () => mockEditor,
}));

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ readOnly: false }),
}));

function PlaceholderHarness({ showSecond }: { showSecond: boolean }) {
  return (
    <>
      <Placeholder node={originalTextNode} />
      {showSecond && <Placeholder node={secondTextNode} />}
    </>
  );
}

function visiblePlaceholders(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.text-placeholder'))
    .map((element) => element.getAttribute('data-placeholder') ?? '')
    .filter(Boolean);
}

describe('Placeholder', () => {
  beforeEach(() => {
    mockEditor.children = [originalParagraph];
    mockUseSelected.mockReset();
  });

  it('removes the empty-document placeholder after a second paragraph is added and selected', () => {
    mockUseSelected.mockReturnValueOnce(false);

    const { container, rerender } = render(<PlaceholderHarness showSecond={false} />);

    expect(visiblePlaceholders(container)).toEqual([EMPTY_DOCUMENT_PLACEHOLDER]);

    mockEditor.children = [originalParagraph, secondParagraph];
    mockUseSelected.mockReturnValueOnce(false).mockReturnValueOnce(true);
    rerender(<PlaceholderHarness showSecond />);

    expect(visiblePlaceholders(container)).toEqual([ACTIVE_PLACEHOLDER]);
  });
});
