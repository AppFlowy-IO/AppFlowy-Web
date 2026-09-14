import { tokenize } from '@/application/database-yjs/fields/formula/lexer';

export type HighlightKind = 'plain' | 'comment' | 'number' | 'string' | 'function' | 'keyword' | 'variable' | 'prop' | 'operator';

export interface HighlightSegment {
  text: string;
  kind: HighlightKind;
}

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'current', 'index']);

/**
 * Splits the source into contiguous segments covering every character (the
 * overlay must line up with the textarea), classifying tokens for colouring.
 * Falls back to a single plain segment while the source cannot be tokenized.
 */
export function highlightFormula(source: string): HighlightSegment[] {
  if (source === '') return [];
  let tokens;

  try {
    tokens = tokenize(source);
  } catch {
    return [{ text: source, kind: 'plain' }];
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  const pushGap = (until: number) => {
    if (until <= cursor) return;
    const gap = source.slice(cursor, until);

    segments.push({ text: gap, kind: gap.trimStart().startsWith('/*') ? 'comment' : 'plain' });
    cursor = until;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.kind === 'eof') break;
    pushGap(token.position.offset);

    // prop("Name") is rendered as one chip-like segment.
    const open = tokens[index + 1];
    const ref = tokens[index + 2];
    const close = tokens[index + 3];

    if (
      token.kind === 'ident' &&
      token.value === 'prop' &&
      open?.kind === 'punct' &&
      open.value === '(' &&
      ref?.kind === 'string' &&
      close?.kind === 'punct' &&
      close.value === ')'
    ) {
      segments.push({ text: source.slice(token.position.offset, close.end), kind: 'prop' });
      cursor = close.end;
      index += 3;
      continue;
    }

    let kind: HighlightKind = 'plain';

    switch (token.kind) {
      case 'number':
        kind = 'number';
        break;
      case 'string':
        kind = 'string';
        break;
      case 'punct':
        kind = 'operator';
        break;
      case 'ident': {
        const previous = tokens[index - 1];
        const next = tokens[index + 1];

        if (KEYWORDS.has(token.value)) kind = 'keyword';
        else if ((next?.kind === 'punct' && next.value === '(') || (previous?.kind === 'punct' && previous.value === '.')) {
          kind = 'function';
        } else kind = 'variable';

        break;
      }

      default:
        break;
    }

    segments.push({ text: source.slice(token.position.offset, token.end), kind });
    cursor = token.end;
  }

  pushGap(source.length);
  return segments;
}

export const HIGHLIGHT_CLASS: Record<HighlightKind, string> = {
  plain: '',
  comment: 'text-text-tertiary italic',
  number: 'text-[var(--formula-number,#6941B8)]',
  string: 'text-[var(--formula-string,#2F7D32)]',
  function: 'text-[var(--formula-function,#B5306A)]',
  keyword: 'text-[var(--formula-keyword,#1F5FB0)]',
  variable: 'text-text-primary',
  prop: 'rounded-[4px] bg-fill-secondary text-text-primary',
  operator: 'text-text-secondary',
};
