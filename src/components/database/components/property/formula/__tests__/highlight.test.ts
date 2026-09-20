import { highlightFormula } from '../highlight';

describe('highlightFormula', () => {
  it('covers every character of the source in order', () => {
    const source = 'if(prop("Done") and not empty(prop("Due")), "✓ " + format(1.5), "") /* note */';
    const segments = highlightFormula(source);

    expect(segments.map((segment) => segment.text).join('')).toBe(source);
  });

  it('classifies functions, keywords, literals, property references and comments', () => {
    const segments = highlightFormula('if(prop("Done") and true, 1.5, "x") /* c */');
    const kinds = Object.fromEntries(segments.filter((s) => s.kind !== 'plain').map((s) => [s.text, s.kind]));

    expect(kinds).toMatchObject({
      if: 'function',
      'prop("Done")': 'prop',
      and: 'keyword',
      true: 'keyword',
      '1.5': 'number',
      '"x"': 'string',
      '/* c */': 'comment',
      '(': 'operator',
      ',': 'operator',
    });
  });

  it('treats a name after a dot as a function and other bare names as variables', () => {
    const kinds = highlightFormula('let(x, 2, x.format())').filter((s) => s.kind !== 'plain' && s.kind !== 'operator');

    expect(kinds).toEqual([
      { text: 'let', kind: 'function' },
      { text: 'x', kind: 'variable' },
      { text: '2', kind: 'number' },
      { text: 'x', kind: 'variable' },
      { text: 'format', kind: 'function' },
    ]);
  });

  it('falls back to plain text while the source cannot be tokenized', () => {
    expect(highlightFormula('"unterminated')).toEqual([{ text: '"unterminated', kind: 'plain' }]);
    expect(highlightFormula('')).toEqual([]);
  });
});
