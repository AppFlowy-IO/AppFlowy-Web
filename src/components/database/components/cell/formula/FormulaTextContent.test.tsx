import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server.node';

import { FormulaTextStyle } from '@/application/database-yjs/fields/formula';

import { FormulaTextContent } from './FormulaTextContent';

const colors = [
  ['gray', 19],
  ['brown', 2],
  ['orange', 3],
  ['yellow', 5],
  ['green', 9],
  ['blue', 12],
  ['purple', 15],
  ['pink', 18],
  ['red', 1],
] as const;

const styleCases: Array<{ token: FormulaTextStyle; inlineStyle: string | null; className?: string }> = [
  { token: 'b', inlineStyle: 'font-weight:bold' },
  { token: 'i', inlineStyle: 'font-style:italic' },
  { token: 'u', inlineStyle: 'text-decoration-line:underline' },
  { token: 's', inlineStyle: 'text-decoration-line:line-through' },
  { token: 'c', inlineStyle: null, className: 'rounded-100 bg-fill-secondary font-mono' },
  ...colors.map(([token, palette]) => ({ token, inlineStyle: `color:var(--palette-text-color-${palette})` })),
  ...colors.map(([color, palette]) => ({
    token: `${color}_background` as FormulaTextStyle,
    inlineStyle: `background-color:var(--palette-bg-color-${palette})`,
  })),
];

describe('FormulaTextContent', () => {
  it.each(styleCases)(
    'renders only $token on the complete styled run and leaves its neighbor plain',
    ({ token, inlineStyle, className }) => {
      // JSDOM drops color assignments containing CSS variables. Check the exact
      // emitted span styles here; Playwright verifies their resolved theme colors.
      const markup = renderToStaticMarkup(
        <FormulaTextContent
          text={'91 / 90'}
          runs={[
            { text: '91', styles: [token] },
            { text: ' / 90', styles: [] },
          ]}
        />
      );
      const document = new DOMParser().parseFromString(markup, 'text/html');
      const spans = document.querySelectorAll('body > span > span');

      expect(document.body.textContent).toBe('91 / 90');
      expect(spans).toHaveLength(2);
      expect(spans[0].textContent).toBe('91');
      expect(spans[0].getAttribute('style')).toBe(inlineStyle);
      expect(spans[0].getAttribute('class')).toBe(className ?? null);
      expect(spans[1].textContent).toBe(' / 90');
      expect(spans[1].getAttribute('style')).toBeNull();
      expect(spans[1].getAttribute('class')).toBeNull();
    }
  );

  it('combines all formats with independent foreground and explicit background', () => {
    const markup = renderToStaticMarkup(
      <FormulaTextContent
        text={'91'}
        runs={[{ text: '91', styles: ['b', 'i', 'u', 's', 'c', 'red', 'blue_background'] }]}
      />
    );
    const document = new DOMParser().parseFromString(markup, 'text/html');
    const span = document.querySelector('body > span > span');

    expect(span?.textContent).toBe('91');
    expect(span?.getAttribute('style')).toBe(
      'font-weight:bold;font-style:italic;color:var(--palette-text-color-1);background-color:var(--palette-bg-color-12);text-decoration-line:underline line-through'
    );
    expect(span?.getAttribute('class')).toBe('rounded-100 bg-fill-secondary font-mono');
  });

  it('clears every format on an existing run and when switching to a plain result', () => {
    const { container, rerender } = render(
      <FormulaTextContent
        text={'91 / 90'}
        runs={[
          { text: '91', styles: ['b', 'i', 'u', 's', 'c'] },
          { text: ' / 90', styles: [] },
        ]}
      />
    );
    const styled = screen.getByText('91');

    expect(styled.style.fontWeight).toBe('bold');
    expect(styled.style.fontStyle).toBe('italic');
    expect(styled.style.textDecorationLine).toBe('underline line-through');
    expect(styled.className).toBe('rounded-100 bg-fill-secondary font-mono');

    rerender(
      <FormulaTextContent
        text={'91 / 90'}
        runs={[
          { text: '91', styles: [] },
          { text: ' / 90', styles: ['i'] },
        ]}
      />
    );
    expect(screen.getByText('91')).toBe(styled);
    expect(styled.style.cssText).toBe('');
    expect(styled.className).toBe('');
    expect(screen.getByText('/ 90').style.fontStyle).toBe('italic');

    rerender(<FormulaTextContent text={'90'} />);
    expect(container.textContent).toBe('90');
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });
});
