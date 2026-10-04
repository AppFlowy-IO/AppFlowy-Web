import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEditor, Editor, Transforms } from 'slate';
import { RenderLeafProps, withReact } from 'slate-react';

import type { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';

import RichTextCellContent from '../RichTextCellContent';
import { richTextToSlateValue, slateValueToRichText, withRichTextCell } from '../rich-text-slate';

const mockOpenUrl = jest.fn();
const mockDocumentLoaded = jest.fn();

jest.mock('@/utils/url', () => ({
  ...jest.requireActual('@/utils/url'),
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => ({}) }));
// The renderer of mentions and equations (a Slate editor) loads on first use.
jest.mock('../RichTextCellDocument', () => {
  mockDocumentLoaded();
  return jest.requireActual('../RichTextCellDocument');
});
// Chips render through the document's leaves; "boom" stands in for content
// a renderer chokes on.
jest.mock('@/components/editor/components/leaf/Leaf', () => ({
  Leaf: ({ attributes, children, leaf, text }: RenderLeafProps) => {
    if (text.text.includes('boom')) throw new Error('cannot render');
    return (
      <span
        {...attributes}
        className={leaf.formula ? 'formula-inline' : undefined}
        data-mention={leaf.mention ? true : undefined}
      >
        {children}
      </span>
    );
  },
}));

const formatted: RichTextDelta = [
  { insert: 'Bold', attributes: { bold: true, italic: true } },
  { insert: ' red', attributes: { font_color: '0xffff0000', bg_color: '0xff00ff00' } },
  { insert: ' code', attributes: { code: true } },
  { insert: ' link', attributes: { href: 'https://appflowy.io', underline: true } },
];

function clipboardData(values: Record<string, string> = {}): DataTransfer {
  return {
    getData: (type: string) => values[type] ?? '',
    setData: (type: string, value: string) => {
      values[type] = value;
    },
  } as DataTransfer;
}

function pasteIntoCell(clipboard: DataTransfer) {
  const editor = withRichTextCell(withReact(createEditor()));

  editor.children = richTextToSlateValue([]);
  Transforms.select(editor, Editor.end(editor, []));
  editor.insertData(clipboard);
  return slateValueToRichText(editor.children);
}

describe('RichTextCellContent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockOpenUrl.mockReset();
    document.getSelection()?.removeAllRanges();
  });

  // React adds its own document listeners with the first root.
  beforeEach(() => {
    render(<div />);
  });

  function selectionListeners() {
    const addListener = jest.spyOn(document, 'addEventListener');

    return () => addListener.mock.calls.filter(([type]) => type === 'selectionchange').length;
  }

  it('draws formatting the way document leaves do, without an editor per cell or its code', () => {
    const listeners = selectionListeners();
    const { container } = render(<RichTextCellContent rowId='row-1' delta={formatted} text='Bold red code link' />);

    // Each editor would track every selection change of the page.
    expect(listeners()).toBe(0);
    expect(container.querySelector('[data-slate-editor]')).toBeNull();
    // Nothing was loaded for it: such a cell shows at once.
    expect(mockDocumentLoaded).not.toHaveBeenCalled();

    expect(container.querySelector('strong em')?.textContent).toBe('Bold');

    const red = container.querySelector('.text-color.bg-color') as HTMLElement;

    expect(red.textContent).toBe(' red');
    expect(red.style.color).toBe('rgb(255, 0, 0)');
    expect(red.style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(container.querySelector('.bg-border-primary')?.textContent).toBe(' code');
    expect(container.querySelector('[data-rich-text-cell-line]')?.className).toContain('whitespace-nowrap');

    expect(container.querySelector('.href-link u')?.textContent).toBe(' link');
  });

  it('opens a link without the click reaching the cell', () => {
    const onCellClick = jest.fn();

    render(
      <div onClick={onCellClick}>
        <RichTextCellContent rowId='row-1' delta={formatted} text='Bold red code link' />
      </div>
    );
    fireEvent.click(screen.getByText('link'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://appflowy.io', '_blank');
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it.each(['forward', 'backward'])('copies a %s selection with marks and links into another cell', (direction) => {
    const { container } = render(<RichTextCellContent rowId='row-1' delta={formatted} text='Bold red code link' />);
    const line = container.querySelector('[data-rich-text-cell-line]')!;
    const start = line.querySelector('strong em')!.firstChild!;
    const end = line.querySelector('.href-link u')!.firstChild!;
    const selection = document.getSelection()!;

    if (direction === 'backward') {
      selection.setBaseAndExtent(end, 4, start, 1);
    } else {
      selection.setBaseAndExtent(start, 1, end, 4);
    }

    const clipboard = clipboardData();

    expect(fireEvent.copy(start.parentElement!, { clipboardData: clipboard })).toBe(false);
    expect(clipboard.getData('text/plain')).toBe('old red code lin');
    const expected = [{ ...formatted[0], insert: 'old' }, formatted[1], formatted[2], { ...formatted[3], insert: ' lin' }];

    expect(pasteIntoCell(clipboard)).toEqual(expected);
    // Browsers may strip custom MIME formats while retaining the HTML carrier.
    expect(pasteIntoCell(clipboardData({ 'text/html': clipboard.getData('text/html') }))).toEqual(expected);
    expect(line.querySelector('[data-slate-editor]')).toBeNull();
  });

  it('copies full static content with Unicode and empty lines, excluding private attributes', () => {
    const delta: RichTextDelta = [
      {
        insert: '👋 one\n\ntwo',
        attributes: { bold: true, 'comment-ids': ['private-comment'] },
        preserved: { font_family: 'private-font' },
      },
      { insert: ' <link>', attributes: { href: 'https://appflowy.io?a=1&b=2', strikethrough: true } },
    ];
    const { container } = render(<RichTextCellContent rowId='row-1' delta={delta} text='👋 one\n\ntwo <link>' wrap />);
    const line = container.querySelector('[data-rich-text-cell-line]')!;
    const range = document.createRange();

    range.selectNodeContents(line);
    document.getSelection()!.addRange(range);
    const clipboard = clipboardData();

    fireEvent.copy(line, { clipboardData: clipboard });
    expect(clipboard.getData('text/plain')).toBe('👋 one\n\ntwo <link>');
    expect(pasteIntoCell(clipboard)).toEqual([
      { insert: '👋 one\n\ntwo', attributes: { bold: true } },
      delta[1],
    ]);
    expect(clipboard.getData('text/html')).toContain('&lt;link&gt;');
    expect(decodeURIComponent(window.atob(clipboard.getData('application/x-slate-fragment')))).not.toContain('private');
  });

  it.each(['collapsed', 'cross-cell', 'other-cell'])("leaves a %s selection's native clipboard alone", (kind) => {
    const { container } = render(
      <>
        <RichTextCellContent rowId='row-1' delta={formatted} text='Bold red code link' />
        <div data-testid='outside'>Outside</div>
      </>
    );
    const line = container.querySelector('[data-rich-text-cell-line]')!;
    const inside = line.querySelector('strong em')!.firstChild!;
    const outside = screen.getByTestId('outside').firstChild!;
    const selection = document.getSelection()!;

    selection.setBaseAndExtent(
      kind === 'other-cell' ? outside : inside,
      0,
      kind === 'collapsed' ? inside : outside,
      kind === 'collapsed' ? 0 : 4
    );
    const clipboard = clipboardData({ 'text/plain': 'Native selection' });

    expect(fireEvent.copy(line, { clipboardData: clipboard })).toBe(true);
    expect(clipboard.getData('text/plain')).toBe('Native selection');
    expect(clipboard.getData('application/x-slate-fragment')).toBe('');
  });

  it('keeps the document renderers (in a read-only editor) for mentions and equations', async () => {
    const listeners = selectionListeners();
    const { container } = render(
      <RichTextCellContent
        rowId='row-1'
        delta={[{ insert: 'Area ' }, { insert: '$', attributes: { formula: 'a^2' } }]}
        text='Area a^2'
        wrap
      />
    );

    // The cell reads as its plain text until the renderers have loaded.
    expect(screen.getByTestId('rich-text-cell-content').textContent).toBe('Area a^2');
    expect(container.querySelector('[data-slate-editor]')).toBeNull();

    await waitFor(() => expect(container.querySelector('[data-slate-editor]')).not.toBeNull());
    expect(mockDocumentLoaded).toHaveBeenCalledTimes(1);
    expect(listeners()).toBe(1);
    expect(container.querySelector('.formula-inline')).not.toBeNull();
    expect(container.querySelector('[data-rich-text-cell-line]')?.className).toContain('whitespace-pre-wrap');
  });

  it.each(['mention', 'formula'])('normalizes stored %s runs before rendering their leaves', async (atom) => {
    const attributes =
      atom === 'mention'
        ? { mention: { type: 'person', person_id: 'ada', person_name: 'Ada' } }
        : { formula: 'x^2' };
    const { container } = render(
      <RichTextCellContent rowId='row-1' delta={[{ insert: '$$ literal @👋', attributes }]} text='Fallback' />
    );

    await waitFor(() => expect(container.querySelector('[data-slate-editor]')).not.toBeNull());
    const atoms = container.querySelectorAll(atom === 'mention' ? '[data-mention]' : '.formula-inline');

    expect(Array.from(atoms, (node) => node.textContent)).toEqual(['$', '$', '@']);
    expect(container.querySelector('[data-slate-editor]')?.textContent).toBe('$$ literal @👋');
  });

  it("shows the cell's plain text when its content cannot be rendered", async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(
      <RichTextCellContent
        rowId='row-1'
        delta={[{ insert: 'boom ' }, { insert: '$', attributes: { formula: 'x' } }]}
        text='boom x'
      />
    );

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.getByTestId('rich-text-cell-content').textContent).toBe('boom x');
    expect(container.querySelector('[data-slate-editor]')).toBeNull();
  });
});
