import { BinaryOperator, FormulaNode } from './ast';
import { FormulaError } from './errors';
import { Token, tokenize } from './lexer';

/**
 * Pratt parser for the formula language.
 *
 * Precedence, lowest to highest (matching Notion):
 *   ?:  <  or  <  and  <  == !=  <  < <= > >=  <  + -  <  * / %  <  ^  <  unary  <  call / dot
 */
const BINARY_PRECEDENCE: Record<string, number> = {
  or: 2,
  '||': 2,
  and: 3,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
  '^': 8,
};

const RIGHT_ASSOCIATIVE = new Set(['^']);
const NON_CHAINABLE = new Set(['==', '!=', '<', '<=', '>', '>=']);
const UNARY_PRECEDENCE = 9;
const TERNARY_PRECEDENCE = 1;

function normalizeOperator(op: string): BinaryOperator {
  if (op === '||') return 'or';
  if (op === '&&') return 'and';
  return op as BinaryOperator;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    const node = this.parseExpression(0);
    const token = this.peek();

    if (token.kind !== 'eof') {
      throw new FormulaError(`Unexpected "${token.value}"`, token.position);
    }

    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];

    this.index += 1;
    return token;
  }

  private isPunct(value: string): boolean {
    const token = this.peek();

    return token.kind === 'punct' && token.value === value;
  }

  private expectPunct(value: string): Token {
    const token = this.peek();

    if (token.kind !== 'punct' || token.value !== value) {
      const found = token.kind === 'eof' ? 'end of formula' : `"${token.value}"`;

      throw new FormulaError(`Expected "${value}" but found ${found}`, token.position);
    }

    return this.next();
  }

  private parseExpression(minPrecedence: number): FormulaNode {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();

      if (token.kind === 'punct' && token.value === '?' && TERNARY_PRECEDENCE >= minPrecedence) {
        this.next();
        const then = this.parseExpression(TERNARY_PRECEDENCE);

        this.expectPunct(':');
        const otherwise = this.parseExpression(TERNARY_PRECEDENCE);

        left = { kind: 'conditional', test: left, then, else: otherwise, position: left.position, end: otherwise.end };
        continue;
      }

      const opText = token.kind === 'punct' || token.kind === 'ident' ? token.value : '';
      const precedence = BINARY_PRECEDENCE[opText];

      if (precedence === undefined || precedence < minPrecedence) break;
      if (token.kind === 'ident' && opText !== 'and' && opText !== 'or') break;

      this.next();
      const op = normalizeOperator(opText);
      const nextMin = RIGHT_ASSOCIATIVE.has(opText) ? precedence : precedence + 1;
      const right = this.parseExpression(nextMin);

      if (NON_CHAINABLE.has(op)) {
        const following = this.peek();
        const followingOp = following.kind === 'punct' ? following.value : '';

        if (NON_CHAINABLE.has(followingOp)) {
          throw new FormulaError('Comparisons cannot be chained; combine them with "and"', following.position);
        }
      }

      left = { kind: 'binary', op, left, right, position: left.position, end: right.end };
    }

    return left;
  }

  private parseUnary(): FormulaNode {
    const token = this.peek();

    if (token.kind === 'punct' && (token.value === '-' || token.value === '!')) {
      this.next();
      const operand = this.parseExpression(UNARY_PRECEDENCE);

      return {
        kind: 'unary',
        op: token.value === '-' ? '-' : 'not',
        operand,
        position: token.position,
        end: operand.end,
      };
    }

    if (token.kind === 'ident' && token.value === 'not') {
      this.next();
      const operand = this.parseExpression(UNARY_PRECEDENCE);

      return { kind: 'unary', op: 'not', operand, position: token.position, end: operand.end };
    }

    return this.parsePostfix(this.parsePrimary());
  }

  private parsePostfix(node: FormulaNode): FormulaNode {
    let current = node;

    while (this.isPunct('.')) {
      this.next();
      const name = this.peek();

      if (name.kind !== 'ident') {
        throw new FormulaError('Expected a function name after "."', name.position);
      }

      this.next();
      const args = this.isPunct('(') ? this.parseArguments() : [];
      const end = this.tokens[this.index - 1].end;

      current = { kind: 'call', name: name.value, args: [current, ...args], position: current.position, end };
    }

    return current;
  }

  private parseArguments(): FormulaNode[] {
    this.expectPunct('(');
    const args: FormulaNode[] = [];

    if (this.isPunct(')')) {
      this.next();
      return args;
    }

    for (;;) {
      args.push(this.parseExpression(0));
      if (this.isPunct(',')) {
        this.next();
        continue;
      }

      this.expectPunct(')');
      return args;
    }
  }

  private parsePrimary(): FormulaNode {
    const token = this.peek();

    switch (token.kind) {
      case 'number': {
        this.next();
        const value = Number(token.value);

        if (!Number.isFinite(value)) throw new FormulaError(`Invalid number "${token.value}"`, token.position);
        return { kind: 'number', value, position: token.position, end: token.end };
      }

      case 'string':
        this.next();
        return { kind: 'string', value: token.value, position: token.position, end: token.end };

      case 'ident': {
        this.next();
        if (token.value === 'true' || token.value === 'false') {
          return { kind: 'boolean', value: token.value === 'true', position: token.position, end: token.end };
        }

        if (this.isPunct('(')) {
          const args = this.parseArguments();
          const end = this.tokens[this.index - 1].end;

          if (token.value === 'prop') {
            const [ref] = args;

            if (args.length !== 1 || !ref || ref.kind !== 'string') {
              throw new FormulaError('prop() expects a single property name in quotes', token.position);
            }

            return { kind: 'prop', ref: ref.value, position: token.position, end };
          }

          return { kind: 'call', name: token.value, args, position: token.position, end };
        }

        return { kind: 'ident', name: token.value, position: token.position, end: token.end };
      }

      case 'punct': {
        if (token.value === '(') {
          this.next();
          const inner = this.parseExpression(0);

          this.expectPunct(')');
          return inner;
        }

        if (token.value === '[') {
          this.next();
          const items: FormulaNode[] = [];

          if (!this.isPunct(']')) {
            for (;;) {
              items.push(this.parseExpression(0));
              if (this.isPunct(',')) {
                this.next();
                continue;
              }

              break;
            }
          }

          const close = this.expectPunct(']');

          return { kind: 'list', items, position: token.position, end: close.end };
        }

        throw new FormulaError(`Unexpected "${token.value}"`, token.position);
      }

      case 'eof':
        throw new FormulaError(this.index === 0 ? 'Formula is empty' : 'Unexpected end of formula', token.position);

      default:
        throw new FormulaError(`Unexpected "${token.value}"`, token.position);
    }
  }
}

export function parseFormula(source: string): FormulaNode {
  return new Parser(tokenize(source)).parse();
}
