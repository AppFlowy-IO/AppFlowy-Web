import type { Root, RootContent } from 'mdast';

/** Flutter also imports these display delimiters, including math-like bare brackets. */
function alternateMathMatches(source: string) {
  return [...source.matchAll(/\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\[([^[\]]+)\]/g)].filter((match) => {
    let slashes = 0;

    for (let i = match.index! - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
    if (slashes % 2) return false;
    const formula = match[1] ?? match[2] ?? match[3];

    return formula.trim() && (match[3] === undefined || /\\|[_^]\{|[a-zA-Z0-9]\s*[+*/=-]\s*[a-zA-Z0-9]|\^\d/.test(formula));
  });
}

export function hasMathMarkdown(source: string): boolean {
  return /(^|[^\\$])\$\$[\s\S]+?\$\$(?!\$)/m.test(source) ||
    /(^|[^\\$])\$[^$\n]+\$(?!\$)/m.test(source) || alternateMathMatches(source).length > 0;
}

/**
 * Normalize Flutter's extra delimiters before Markdown consumes TeX escapes.
 * Use the initial AST to protect code, links, HTML, and existing dollar math.
 * Formula bodies stay byte-for-byte intact, including newlines and backslashes.
 */
export function normalizeMathMarkdown(source: string, tree: Root): string {
  const matches = alternateMathMatches(source);

  if (!matches.length) return source;
  const protectedSpans: { start: number; end: number }[] = [];
  const protectedTypes = new Set(['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'definition', 'html', 'math', 'inlineMath']);
  const visit = (node: Root | RootContent) => {
    if (protectedTypes.has(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;

      if (start !== undefined && end !== undefined) protectedSpans.push({ start, end });
    } else if ('children' in node) node.children.forEach(visit);
  };

  visit(tree);
  let normalized = '';
  let cursor = 0;

  for (const match of matches) {
    const start = match.index!;
    const end = start + match[0].length;

    if (protectedSpans.some((span) => start < span.end && end > span.start)) continue;
    normalized += source.slice(cursor, start) + '$$' + (match[1] ?? match[2] ?? match[3]) + '$$';
    cursor = end;
  }

  return normalized + source.slice(cursor);
}

/** Pasting a complete Markdown equation into its TeX input omits the wrappers. */
export function unwrapMathMarkdown(source: string): string {
  const trimmed = source.trim();
  const dollar = trimmed.match(/^(\${1,2})([\s\S]+?)\1$/);

  if (dollar && !dollar[2].includes('$')) return dollar[2].trim();
  const alternate = alternateMathMatches(trimmed);

  if (alternate.length === 1 && alternate[0][0] === trimmed) {
    const match = alternate[0];

    return (match[1] ?? match[2] ?? match[3]).trim();
  }

  return source;
}
