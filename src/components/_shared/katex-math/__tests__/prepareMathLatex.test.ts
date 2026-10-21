import { renderToString } from 'katex';

import { prepareMathLatex } from '../prepareMathLatex';

// Ported from Flutter test/unit_test/math_equation/math_equation_test.dart.
// Assert renderability rather than Flutter's array encoding: KaTeX natively
// supports these environments, so source syntax and equation tags stay intact.
const examples = [
  String.raw`\begin{equation}\begin{split}f(x)&=x^2\\&=x\cdot x\end{split}\end{equation}`,
  String.raw`\begin{align*}a&b\\c&d\end{align*}`,
  String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`,
  String.raw`\begin{cases}x&x\ge 0\\-x&x<0\end{cases}`,
  String.raw`\begin{align}y&=mx+b\\y&=ax^2+bx+c\end{align}`,
  String.raw`\begin{cases}x^2&\text{if }x\ge0\\-x&\text{if }x<0\end{cases}`,
  String.raw`\begin{matrix}1&0\\0&1\end{matrix}`,
  String.raw`\begin{array}{|c|c|}a&b\\\hline c&d\end{array}`,
  String.raw`\begin{matrix}1&0\\0&1`,
  '\\begin{align}\na &= b + c \\\\\nd &= e\n\\end{align}',
  String.raw`\begin{multline}x+y\\z\end{multline}`,
  '\\begin{bmatrix}\n1 & 2 & 3\n4 & 5 & 6\n7 & 8 & 9',
  '\\begin{pmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{pmatrix}',
  String.raw`\begin{aligned}a&=b\\c&=d+e+f\end{aligned}`,
  'E=mc^2\np=mv',
  '\\begin{cases}\nA&XXX\\\\\nB&XXX\\\\\nC&\n\\begin{cases}\nD&XXX\\\\\nE&XXX\n\\end{cases}\\\\\nF&XXX\n\\end{cases}',
  'y = mx + b \\\\ \n  = kx + c \\\\ \n  = ax + d',
  String.raw`\begin{align*}\exist e \in G \; \forall x \in G&:\quad e\cdot x = x \tag{1}\end{align*}`,
];

describe('Flutter math equation examples', () => {
  it.each(examples.map((source, i) => [i + 1, source]))('renders example %s', (_i, source) => {
    expect(renderToString(prepareMathLatex(source as string), { displayMode: true, throwOnError: true })).toContain(
      'katex'
    );
  });
  it('preserves custom arrays', () => expect(prepareMathLatex(examples[7])).toBe(examples[7]));
  it('preserves source when already valid', () => expect(prepareMathLatex(examples[1])).toBe(examples[1]));
  it('surfaces malformed LaTeX instead of silently discarding it', () => {
    expect(() => renderToString(prepareMathLatex(String.raw`\bc`), { throwOnError: true })).toThrow(
      'Undefined control sequence'
    );
  });
});
