/** Desktop accepts unfinished environments and literal newlines in equation blocks.
 * KaTeX supports AMS environments natively, so retain them (and their tags) rather
 * than applying Flutter's renderer-specific conversion to arrays.
 */
export function prepareMathLatex(source: string): string {
  const stack: string[] = [];

  for (const token of source.matchAll(/\\(begin|end)\s*\{([\w*]+)\}/g)) {
    if (token[1] === 'begin') stack.push(token[2]);
    else if (stack[stack.length - 1] === token[2]) stack.pop();
  }

  let tex =
    source +
    stack
      .reverse()
      .map((name) => `\n\\end{${name}}`)
      .join('');
  const lines = tex
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());

  tex = lines
    .map((line, i) => {
      const next = lines[i + 1];

      if (!next) return line;
      const directive = /^\s*\\(?:begin|end)/;

      return line + (!directive.test(line) && !directive.test(next) && !/(?:\\\\|\\cr)$/.test(line) ? ' \\\\ ' : '\n');
    })
    .join('')
    .trim();
  // multline is supported by Flutter's converter but not by KaTeX.
  tex = tex.replace(/\\(begin|end)\{multline\*?\}/g, '\\$1{gathered}');
  if (!/\\begin\s*\{/.test(tex) && tex.includes('\\\\')) {
    tex = `\\begin{array}{l}${tex}\\end{array}`;
  }

  return tex;
}
