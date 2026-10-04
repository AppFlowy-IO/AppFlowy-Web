import { render } from '@testing-library/react';

import RichTextCellContent from '@/components/database/components/cell/text/rich-text/RichTextCellContent';

import { Leaf } from '../Leaf';

jest.mock('@/components/editor/components/leaf/formula/FormulaLeaf', () => () => null);
jest.mock('@/components/editor/components/leaf/mention/MentionLeaf', () => () => null);
jest.mock('@/components/editor/components/leaf/reference/InlineReference', () => ({
  InlineReference: () => null,
}));
jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentLeafContextOptional: () => null,
}));
// Only static runs are drawn here; the chip renderer brings an editor with it.
jest.mock('@/components/database/components/cell/text/rich-text/RichTextCellDocument', () => ({
  __esModule: true,
  default: () => null,
}));

const FLAGS = ['bold', 'italic', 'underline', 'strikethrough', 'code'] as const;
const COLORS: Record<string, string>[] = [
  {},
  { font_color: '0xffff0000' },
  { font_color: '0xffff0000', af_text_color: 'text-color-14' },
  { bg_color: '#00ff00' },
  { bg_color: '#00ff00', af_background_color: 'appflowy_them_color_tint1' },
  { font_color: 'rgba(1, 2, 3, 0.5)', bg_color: '0xff00ff00' },
];

/** Every combination of the registered marks a run can carry. */
function combinations() {
  const marks: Record<string, unknown>[] = [];

  for (let mask = 0; mask < 1 << FLAGS.length; mask++) {
    const flags = Object.fromEntries(FLAGS.filter((_, index) => mask & (1 << index)).map((flag) => [flag, true]));

    COLORS.forEach((colors) => marks.push({ ...flags, ...colors }));
  }

  return marks;
}

function leafMarkup(marks: Record<string, unknown>) {
  const leaf = { text: 'x', ...marks };
  const { container, unmount } = render(
    <Leaf attributes={{ 'data-slate-leaf': true }} leaf={leaf} text={leaf}>
      x
    </Leaf>
  );
  const span = container.firstElementChild as HTMLElement;
  const markup = { className: span.className, style: span.getAttribute('style'), html: span.innerHTML };

  unmount();
  return markup;
}

function staticMarkup(marks: Record<string, unknown>) {
  const { container, unmount } = render(
    <RichTextCellContent rowId='row-1' delta={[{ insert: 'x', attributes: marks }]} text='x' />
  );
  const span = container.querySelector('[data-rich-text-cell-line] > span') as HTMLElement;
  const markup = { className: span.className, style: span.getAttribute('style'), html: span.innerHTML };

  unmount();
  return markup;
}

describe('registered mark mapping (rich text spec R25)', () => {
  it.each(combinations().map((marks) => [JSON.stringify(marks), marks] as const))(
    'draws %s the same in the document leaf and the static cell renderer',
    (_name, marks) => {
      expect(staticMarkup(marks)).toEqual(leafMarkup(marks));
    }
  );

  it('never draws preserved attributes (R13)', () => {
    const { container } = render(
      <RichTextCellContent
        rowId='row-1'
        delta={[{ insert: 'x', attributes: { bold: true }, preserved: { font_size: 40, font_family: 'Comic' } }]}
        text='x'
      />
    );

    expect(container.innerHTML).not.toMatch(/font|40|Comic/);
  });
});
