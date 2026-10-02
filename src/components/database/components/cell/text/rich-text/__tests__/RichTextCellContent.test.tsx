import { fireEvent, render, screen } from '@testing-library/react';
import { RenderLeafProps } from 'slate-react';

import type { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';

import RichTextCellContent from '../RichTextCellContent';

const mockOpenUrl = jest.fn();

jest.mock('@/utils/url', () => ({
  ...jest.requireActual('@/utils/url'),
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => ({}) }));
// Chips render through the document's leaves; "boom" stands in for content
// a renderer chokes on.
jest.mock('@/components/editor/components/leaf/Leaf', () => ({
  Leaf: ({ attributes, children, leaf, text }: RenderLeafProps) => {
    if (text.text.includes('boom')) throw new Error('cannot render');
    return (
      <span {...attributes} className={leaf.formula ? 'formula-inline' : undefined}>
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

describe('RichTextCellContent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockOpenUrl.mockReset();
  });

  // React adds its own document listeners with the first root.
  beforeEach(() => {
    render(<div />);
  });

  function selectionListenersAddedBy(renderCells: () => void) {
    const addListener = jest.spyOn(document, 'addEventListener');

    renderCells();
    return addListener.mock.calls.filter(([type]) => type === 'selectionchange').length;
  }

  it('draws formatting the way document leaves do, without an editor per cell', () => {
    let container: HTMLElement = document.body;
    const listeners = selectionListenersAddedBy(() => {
      container = render(<RichTextCellContent rowId='row-1' delta={formatted} text='Bold red code link' />).container;
    });

    // Each editor would track every selection change of the page.
    expect(listeners).toBe(0);
    expect(container.querySelector('[data-slate-editor]')).toBeNull();

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

  it('keeps the document renderers (in a read-only editor) for mentions and equations', () => {
    let container: HTMLElement = document.body;
    const listeners = selectionListenersAddedBy(() => {
      container = render(
        <RichTextCellContent
          rowId='row-1'
          delta={[{ insert: 'Area ' }, { insert: '$', attributes: { formula: 'a^2' } }]}
          text='Area a^2'
          wrap
        />
      ).container;
    });

    expect(listeners).toBe(1);
    expect(container.querySelector('[data-slate-editor]')).not.toBeNull();
    expect(container.querySelector('.formula-inline')).not.toBeNull();
    expect(container.querySelector('[data-rich-text-cell-line]')?.className).toContain('whitespace-pre-wrap');
  });

  it("shows the cell's plain text when its content cannot be rendered", () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <RichTextCellContent
        rowId='row-1'
        delta={[{ insert: 'boom ' }, { insert: '$', attributes: { formula: 'x' } }]}
        text='boom x'
      />
    );
    expect(screen.getByTestId('rich-text-cell-content').textContent).toBe('boom x');
  });
});
