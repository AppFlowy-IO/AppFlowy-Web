import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createEditor, Descendant, Node, Transforms } from 'slate';
import { Editable, ReactEditor, RenderLeafProps, Slate, withReact } from 'slate-react';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

import translations from '@/@types/translations/en.json';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { SelectionToolbar } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar';

import { InlineReference } from '../InlineReference';
import { parseInlineReference } from '../utils';

const mockT = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], translations);
const mockLocalState = { decorateState: {}, addDecorate: jest.fn(), removeDecorate: jest.fn() };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('smooth-scroll-into-view-if-needed', () => ({ __esModule: true, default: jest.fn(async () => undefined) }));
jest.mock('@/components/chat', () => ({ useAIWriter: () => ({ assistantType: undefined }) }));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorLocalState: () => mockLocalState }));
jest.mock('@/components/editor/components/toolbar/selection-toolbar/ToolbarActions', () => ({ __esModule: true, default: () => <span>Formatting actions</span> }));
jest.mock('@/components/editor/components/toolbar/selection-toolbar/utils', () => ({ getSelectionPosition: () => ({ top: 10, left: 10, width: 20, height: 20 }) }));

function fixture({ readOnly = false, source = 'The search button and shortcut are not functioning properly.', referenceInNotes = false } = {}) {
  const editor = Object.assign(withReact(createEditor()), { isElementReadOnly: () => false });
  const value: Descendant[] = [{
    blockId: 'meeting', type: BlockType.AIMeetingBlock, data: { selected_tab_index: 0 },
    children: [
      { blockId: 'summary', type: BlockType.AIMeetingSummaryBlock, children: [{ blockId: 'summary-p', type: BlockType.Paragraph, children: [{ text: 'Fix search ' }, { text: '^', reference: { blockIds: ['speech'], number: 3 } }] }] },
      { blockId: 'notes', type: BlockType.AIMeetingNotesBlock, children: [{ blockId: 'note', type: BlockType.Paragraph, children: [{ text: 'Check the shortcut.' }] }] },
      { blockId: 'transcript', type: BlockType.AIMeetingTranscriptionBlock, children: [{ blockId: 'speaker', type: BlockType.AIMeetingSpeakerBlock, data: { timestamp: 403 }, children: [{ blockId: 'speech', type: BlockType.Paragraph, children: [{ text: source }] }] }] },
    ],
  }];

  if (referenceInNotes) {
    const [summary, notes] = (value[0] as Element).children as Element[];

    (notes.children[0]).children = (summary.children[0]).children;
    (summary.children[0]).children = [{ text: '' }];
  }

  const renderLeaf = ({ attributes, children, leaf, text }: RenderLeafProps) => {
    const reference = parseInlineReference(leaf.reference);

    return <span {...attributes}>{reference ? <InlineReference reference={reference} text={text}>{children}</InlineReference> : children}</span>;
  };

  const view = render(
    <Slate editor={editor} initialValue={value}>
      <Editable readOnly={readOnly} renderLeaf={renderLeaf} renderElement={({ attributes, children, element }) => <div {...attributes} data-test-block={element.blockId}>{children}</div>} />
      <SelectionToolbar />
    </Slate>
  );

  return { ...view, editor };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(CustomEditor, 'setBlockData').mockImplementation(jest.fn());
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 0; });
  // Popper requires a laid-out anchor. JSDOM has no layout engine.
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, top: 10, left: 10, bottom: 30, right: 30, width: 20, height: 20, toJSON: () => ({}) });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

describe('real Slate summary source popover', () => {
  it('clears text selection and closes the formatting toolbar when a source is opened', async () => {
    const { editor } = fixture();
    const range = { anchor: { path: [0, 0, 0, 0], offset: 0 }, focus: { path: [0, 0, 0, 0], offset: 3 } };

    act(() => {
      ReactEditor.focus(editor);
      Transforms.select(editor, range);
      const domSelection = window.getSelection()!;

      domSelection.removeAllRanges();
      domSelection.addRange(ReactEditor.toDOMRange(editor, range));
    });
    await waitFor(() => expect(screen.getByTestId('selection-toolbar').style.opacity).toBe('1'));
    const sourceButton = screen.getByRole('button', { name: 'View sources' });

    fireEvent.mouseDown(sourceButton);
    fireEvent.mouseUp(sourceButton);
    fireEvent.click(sourceButton);
    expect(await screen.findByText('06:43')).toBeTruthy();
    await waitFor(() => expect(editor.selection).toBeNull());
    expect(window.getSelection()?.isCollapsed).toBe(true);
    await waitFor(() => expect(screen.getByTestId('selection-toolbar').style.opacity).toBe('0'));
    expect(sourceButton.classList.contains('bg-fill-content-hover')).toBe(true);
    expect(sourceButton.classList.contains('bg-fill-list-active')).toBe(false);
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
    fireEvent.click(sourceButton);
    await waitFor(() => expect(sourceButton.getAttribute('aria-expanded')).toBe('false'));
    expect(sourceButton.classList.contains('bg-fill-content-hover')).toBe(false);
  });

  it('shows source number, transcript time, full source text, and a 360px scrolling limit', async () => {
    const source = 'A long transcript paragraph. '.repeat(100);
    const { container } = fixture({ source });

    fireEvent.click(screen.getByRole('button', { name: 'View sources' }));
    expect(await screen.findByText('06:43')).toBeTruthy();
    const popup = document.querySelector('.ai-meeting-reference-popover')!;

    expect(within(popup as HTMLElement).getByText(source.trim())).toBeTruthy();
    expect(popup.classList.contains('max-h-[360px]')).toBe(true);
    expect(popup.classList.contains('overflow-y-auto')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /06:43/ }));
    expect(CustomEditor.setBlockData).toHaveBeenCalledWith(expect.anything(), 'meeting', { selected_tab_index: 2 });
    expect(smoothScrollIntoViewIfNeeded).toHaveBeenCalledWith(container.querySelector('[data-test-block="speech"]'), expect.objectContaining({ block: 'center' }));
    expect(container.querySelector('[data-test-block="speech"]')?.classList.contains('highlight-block')).toBe(true);
  });

  it('jumps to the transcript in read-only mode without changing the document', async () => {
    const { container } = fixture({ readOnly: true });
    const switched = jest.fn();

    container.addEventListener('ai-meeting-switch-tab', switched);
    fireEvent.click(screen.getByRole('button', { name: 'View sources' }));
    fireEvent.click(await screen.findByRole('button', { name: /06:43/ }));
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ detail: { tabKey: 'transcript' } }));
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
    expect(smoothScrollIntoViewIfNeeded).toHaveBeenCalled();
  });

  it('navigates to the correct Transcript index when Summary is empty and the reference is in Notes', async () => {
    fixture({ referenceInNotes: true });
    fireEvent.click(screen.getByRole('button', { name: 'View sources' }));
    fireEvent.click(await screen.findByRole('button', { name: /06:43/ }));
    expect(CustomEditor.setBlockData).toHaveBeenCalledWith(expect.anything(), 'meeting', { selected_tab_index: 2 });
  });

  it('updates an open source preview when the transcript changes', async () => {
    const { editor } = fixture();

    fireEvent.click(screen.getByRole('button', { name: 'View sources' }));
    await screen.findByRole('button', { name: /06:43/ });
    act(() => { Transforms.insertText(editor, 'Updated: ', { at: { path: [0, 2, 0, 0, 0], offset: 0 } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: /06:43 Updated:/ })).toBeTruthy());
    expect(Node.string(editor.children[0])).toContain('Updated: ');
  });

  it('marks a deleted source instead of displaying an unrelated paragraph', async () => {
    const { editor } = fixture();

    act(() => { Transforms.removeNodes(editor, { at: [0, 2, 0] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Source deleted' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Source deleted' }));
    expect(await screen.findByText('Source was deleted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /06:43/ })).toBeNull();
  });
});
