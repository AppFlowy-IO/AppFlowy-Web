import { FormulaError, SourcePosition } from './errors';

export type TokenKind = 'number' | 'string' | 'ident' | 'punct' | 'eof';

export interface Token {
  kind: TokenKind;
  /** Raw text for identifiers/punctuation; decoded text for strings; source text for numbers. */
  value: string;
  position: SourcePosition;
  /** Offset one past the last character. */
  end: number;
}

const PUNCTUATION = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '(',
  ')',
  '[',
  ']',
  ',',
  '.',
  '?',
  ':',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '!',
];

function isIdentStart(ch: string) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string) {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string) {
  return ch >= '0' && ch <= '9';
}

/** Tokenizes a formula. Whitespace and block comments (slash-star ... star-slash) are skipped. */
export function tokenize(source: string, allowIncomplete = false): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let lineStart = 0;

  const position = (): SourcePosition => ({ offset, line, column: offset - lineStart + 1 });
  const advance = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      if (source[offset] === '\n') {
        line += 1;
        lineStart = offset + 1;
      }

      offset += 1;
    }
  };

  while (offset < source.length) {
    const ch = source[offset];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    if (ch === '/' && source[offset + 1] === '*') {
      const start = position();
      const close = source.indexOf('*/', offset + 2);

      if (close === -1) {
        if (allowIncomplete) return tokens;
        throw new FormulaError('Unterminated comment', start);
      }

      advance(close + 2 - offset);
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(source[offset + 1] ?? ''))) {
      const start = position();
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
      const raw = match?.[0] ?? ch;

      advance(raw.length);
      tokens.push({ kind: 'number', value: raw, position: start, end: offset });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = position();
      const quote = ch;
      let value = '';

      advance();
      for (;;) {
        if (offset >= source.length) {
          if (allowIncomplete) return tokens;
          throw new FormulaError('Unterminated string', start);
        }

        const current = source[offset];

        if (current === quote) {
          advance();
          break;
        }

        if (current === '\\') {
          const next = source[offset + 1];

          if (next === undefined) {
            if (allowIncomplete) return tokens;
            throw new FormulaError('Unterminated string', start);
          }

          const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" };

          // Unknown escapes keep their backslash, so regex classes like "\w" survive.
          value += escapes[next] ?? `\\${next}`;
          advance(2);
          continue;
        }

        value += current;
        advance();
      }

      tokens.push({ kind: 'string', value, position: start, end: offset });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = position();
      let end = offset;

      while (end < source.length && isIdentPart(source[end])) end += 1;
      const value = source.slice(offset, end);

      advance(end - offset);
      tokens.push({ kind: 'ident', value, position: start, end: offset });
      continue;
    }

    const punct = PUNCTUATION.find((candidate) => source.startsWith(candidate, offset));

    if (punct) {
      const start = position();

      advance(punct.length);
      tokens.push({ kind: 'punct', value: punct, position: start, end: offset });
      continue;
    }

    if (allowIncomplete) {
      tokens.push({ kind: 'punct', value: ch, position: position(), end: offset + 1 });
      advance();
      continue;
    }

    throw new FormulaError(`Unexpected character "${ch}"`, position());
  }

  tokens.push({ kind: 'eof', value: '', position: position(), end: offset });
  return tokens;
}
