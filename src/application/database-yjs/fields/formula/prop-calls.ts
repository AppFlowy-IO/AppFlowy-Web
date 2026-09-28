import { tokenize } from './lexer';

/** A complete `prop("...")` call reading a property of this database. */
export interface FormulaPropCall {
  /** Offset of `prop`. */
  start: number;
  /** Offset one past the closing parenthesis. */
  end: number;
  /** Offset of the quoted argument's opening quote. */
  refStart: number;
  /** Offset one past the quoted argument's closing quote. */
  refEnd: number;
  /** The decoded argument: a property name or id. */
  ref: string;
}

/**
 * Every complete `prop("...")` call in `source` that reads a property of this
 * database, in order. The source is lexed as a whole, so strings and block
 * comments that span lines hide the calls inside them, and nothing after an
 * unclosed string or comment is a call. A call after a dot
 * (`current.prop("Status")`) reads a related row, not this database.
 *
 * This is the one reading of references: a draft is rewritten for renamed
 * properties through it, and the editor draws exactly these calls as tokens.
 */
export function findFormulaPropCalls(source: string): FormulaPropCall[] {
  if (!source.includes('prop')) return [];
  let tokens;

  try {
    tokens = tokenize(source, true);
  } catch {
    return [];
  }

  const calls: FormulaPropCall[] = [];

  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const [ident, open, ref, close] = tokens.slice(index, index + 4);
    const previous = tokens[index - 1];

    if (
      ident.kind === 'ident' &&
      ident.value === 'prop' &&
      open.kind === 'punct' &&
      open.value === '(' &&
      ref.kind === 'string' &&
      close.kind === 'punct' &&
      close.value === ')' &&
      !(previous?.kind === 'punct' && previous.value === '.')
    ) {
      calls.push({
        start: ident.position.offset,
        end: close.end,
        refStart: ref.position.offset,
        refEnd: ref.end,
        ref: ref.value,
      });
      index += 3;
    }
  }

  return calls;
}
