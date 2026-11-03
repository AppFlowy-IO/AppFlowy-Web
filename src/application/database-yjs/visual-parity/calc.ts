/**
 * The `calc` grammar of `visual-metrics.json` (VISUAL-PARITY.md §2.3). Both
 * probes implement exactly this, and nothing more:
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := factor (('*' | '/') factor)*
 *   factor  := NUMBER | TOKEN_PATH | MEASURED | FUNC '(' expr (',' expr)* ')' | '(' expr ')'
 *   TOKEN_PATH := (color|shadow|chart|layout|geometry|typography|motion) ('.' [A-Za-z0-9]+)+
 *   MEASURED   := '$' (parity-id | 'self') '.' metric
 *   FUNC       := clamp(lo, x, hi) | min(a, b) | max(a, b) | round(x)   -- round = half away from zero
 *
 * There is no unary minus.
 */

export const TOKEN_ROOTS = ['color', 'shadow', 'chart', 'layout', 'geometry', 'typography', 'motion'] as const;

const FUNCTIONS: Record<string, number> = { clamp: 3, min: 2, max: 2, round: 1 };

export type CalcNode =
  | { type: 'number'; value: number }
  | { type: 'token'; path: string }
  | { type: 'measured'; id: string; metric: string }
  | { type: 'call'; name: string; args: CalcNode[] }
  | { type: 'binary'; op: '+' | '-' | '*' | '/'; left: CalcNode; right: CalcNode };

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'measured'; id: string; metric: string }
  | { kind: 'op'; value: string };

export class CalcError extends Error {}

/** A `$id.metric` the evaluator could not get a measurement for. */
export class MissingMeasurementError extends CalcError {
  constructor(readonly id: string, readonly metric: string) {
    super(`no measurement for $${id}.${metric}`);
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\s*(?:(\d+(?:\.\d+)?)|(\$(?:self|[a-z0-9-]+(?:__[a-z0-9-]+)?)\.[A-Za-z]+)|([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*)|([-+*/(),]))/y;
  let index = 0;

  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);

    if (!match) throw new CalcError(`unexpected input at ${index}: "${source.slice(index, index + 12)}"`);
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) {
      const dot = match[2].lastIndexOf('.');

      tokens.push({ kind: 'measured', id: match[2].slice(1, dot), metric: match[2].slice(dot + 1) });
    } else if (match[3] !== undefined) tokens.push({ kind: 'ident', value: match[3] });
    else tokens.push({ kind: 'op', value: match[4] });
  }

  return tokens;
}

export function parseCalc(source: string): CalcNode {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => {
    const token = peek();

    return token?.kind === 'op' && token.value === value;
  };

  const expectOp = (value: string) => {
    if (!isOp(value)) throw new CalcError(`expected "${value}" in "${source}"`);
    position += 1;
  };

  function factor(): CalcNode {
    const token = peek();

    if (!token) throw new CalcError(`unexpected end of "${source}"`);
    position += 1;
    if (token.kind === 'number') return { type: 'number', value: token.value };
    if (token.kind === 'measured') return { type: 'measured', id: token.id, metric: token.metric };
    if (token.kind === 'op') {
      if (token.value !== '(') throw new CalcError(`unexpected "${token.value}" in "${source}"`);
      const inner = expr();

      expectOp(')');
      return inner;
    }

    if (isOp('(')) {
      const arity = FUNCTIONS[token.value];

      if (arity === undefined) throw new CalcError(`unknown function "${token.value}" in "${source}"`);
      position += 1;
      const args = [expr()];

      while (isOp(',')) {
        position += 1;
        args.push(expr());
      }

      expectOp(')');
      if (args.length !== arity) throw new CalcError(`${token.value} takes ${arity} arguments in "${source}"`);
      return { type: 'call', name: token.value, args };
    }

    const root = token.value.split('.')[0];

    if (!(TOKEN_ROOTS as readonly string[]).includes(root) || !token.value.includes('.')) {
      throw new CalcError(`"${token.value}" is not a token path in "${source}"`);
    }

    return { type: 'token', path: token.value };
  }

  function term(): CalcNode {
    let node = factor();

    while (isOp('*') || isOp('/')) {
      const op = (peek() as { value: '*' | '/' }).value;

      position += 1;
      node = { type: 'binary', op, left: node, right: factor() };
    }

    return node;
  }

  function expr(): CalcNode {
    let node = term();

    while (isOp('+') || isOp('-')) {
      const op = (peek() as { value: '+' | '-' }).value;

      position += 1;
      node = { type: 'binary', op, left: node, right: term() };
    }

    return node;
  }

  const node = expr();

  if (position !== tokens.length) throw new CalcError(`trailing input in "${source}"`);
  return node;
}

export interface CalcEnvironment {
  /** The number at a tokens.json path; throws when the path is not a number. */
  token: (path: string) => number;
  /** A measured metric of a parity id (`self` is the element itself); `undefined` when not measured. */
  measured: (id: string, metric: string) => number | undefined;
}

function roundHalfAwayFromZero(value: number) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function evaluateCalc(node: CalcNode, env: CalcEnvironment): number {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'token':
      return env.token(node.path);
    case 'measured': {
      const value = env.measured(node.id, node.metric);

      if (value === undefined || !Number.isFinite(value)) throw new MissingMeasurementError(node.id, node.metric);
      return value;
    }

    case 'call': {
      const args = node.args.map((arg) => evaluateCalc(arg, env));

      if (node.name === 'clamp') return Math.min(Math.max(args[1], args[0]), args[2]);
      if (node.name === 'min') return Math.min(args[0], args[1]);
      if (node.name === 'max') return Math.max(args[0], args[1]);
      return roundHalfAwayFromZero(args[0]);
    }

    case 'binary': {
      const left = evaluateCalc(node.left, env);
      const right = evaluateCalc(node.right, env);

      if (node.op === '+') return left + right;
      if (node.op === '-') return left - right;
      if (node.op === '*') return left * right;
      if (right === 0) throw new CalcError('division by zero');
      return left / right;
    }
  }
}

/** The token paths and measurements a `calc` expression reads. */
export function calcDependencies(source: string): { tokens: string[]; measured: { id: string; metric: string }[] } {
  const tokens: string[] = [];
  const measured: { id: string; metric: string }[] = [];
  const walk = (node: CalcNode) => {
    if (node.type === 'token') tokens.push(node.path);
    else if (node.type === 'measured') measured.push({ id: node.id, metric: node.metric });
    else if (node.type === 'call') node.args.forEach(walk);
    else if (node.type === 'binary') {
      walk(node.left);
      walk(node.right);
    }
  };

  walk(parseCalc(source));
  return { tokens, measured };
}
