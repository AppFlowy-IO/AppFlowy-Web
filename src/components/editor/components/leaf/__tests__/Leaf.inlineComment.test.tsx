import { render } from '@testing-library/react';

import { Leaf } from '../Leaf';

jest.mock('@/components/editor/components/leaf/formula/FormulaLeaf', () => () => null);
jest.mock('@/components/editor/components/leaf/href', () => ({ Href: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/editor/components/leaf/mention/MentionLeaf', () => () => null);
jest.mock('@/components/editor/components/leaf/reference/InlineReference', () => ({
  InlineReference: () => null,
}));

jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentLeafContextOptional: () => ({
    active: true,
    focusedCommentId: 'comment-1',
    openCommentFromAnchor: jest.fn(),
  }),
}));

describe('Leaf inline comment styling', () => {
  it.each([
    ['bg_color', '#112233'],
    ['af_background_color', '#445566'],
  ])('renders the focused comment fill over %s', (backgroundKey, backgroundValue) => {
    const leaf = {
      text: 'commented',
      [backgroundKey]: backgroundValue,
      'comment-ids': ['comment-1'],
    };
    const { container } = render(
      <Leaf
        attributes={{ 'data-slate-leaf': true }}
        leaf={leaf}
        text={leaf}
      >
        commented
      </Leaf>
    );
    const span = container.querySelector('[data-inline-comment-ids="comment-1"]') as HTMLElement;

    expect(span.classList.contains('bg-color')).toBe(true);
    expect(span.style.backgroundColor).toBe('rgba(255, 193, 7, 0.38)');
  });
});
