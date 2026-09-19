import { SourcePosition } from './errors';
import { FormulaType } from './values';

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'and'
  | 'or';
export type UnaryOperator = '-' | 'not';

export type FormulaNode = ParsedFormulaNode & {
  /** Set by the checker; an empty runtime value still retains this expression's type. */
  inferredType?: FormulaType;
};

type ParsedFormulaNode =
  | { kind: 'number'; value: number; position: SourcePosition; end: number }
  | { kind: 'string'; value: string; position: SourcePosition; end: number }
  | { kind: 'boolean'; value: boolean; position: SourcePosition; end: number }
  | { kind: 'list'; items: FormulaNode[]; position: SourcePosition; end: number }
  /** `prop("ref")` — `ref` is a field id (storage form) or a field name (editor form). */
  | { kind: 'prop'; ref: string; position: SourcePosition; end: number }
  /** A bare identifier: a variable such as `current`, `index`, or a `let` binding. */
  | { kind: 'ident'; name: string; position: SourcePosition; end: number }
  | { kind: 'call'; name: string; args: FormulaNode[]; position: SourcePosition; end: number }
  | { kind: 'unary'; op: UnaryOperator; operand: FormulaNode; position: SourcePosition; end: number }
  | {
      kind: 'binary';
      op: BinaryOperator;
      left: FormulaNode;
      right: FormulaNode;
      position: SourcePosition;
      end: number;
    }
  | {
      kind: 'conditional';
      test: FormulaNode;
      then: FormulaNode;
      else: FormulaNode;
      position: SourcePosition;
      end: number;
    };

/** Iterative because invalid expressions can still have a deeply nested AST. */
function* walkFormulaNodes(root: FormulaNode): Generator<FormulaNode> {
  const pending = [root];

  while (pending.length > 0) {
    const node = pending.pop()!;

    yield node;
    switch (node.kind) {
      case 'list':
      case 'call': {
        const children = node.kind === 'list' ? node.items : node.args;

        for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
        break;
      }

      case 'unary':
        pending.push(node.operand);
        break;
      case 'binary':
        pending.push(node.right, node.left);
        break;
      case 'conditional':
        pending.push(node.else, node.then, node.test);
        break;
    }
  }
}

/** Collects every `prop()` reference in evaluation order (duplicates preserved). */
export function collectPropRefs(node: FormulaNode, out: string[] = []): string[] {
  for (const current of walkFormulaNodes(node)) {
    if (current.kind === 'prop') out.push(current.ref);
  }

  return out;
}

/** Whether this expression directly reads the wall clock. */
export function formulaUsesClock(node: FormulaNode): boolean {
  for (const current of walkFormulaNodes(node)) {
    if (current.kind === 'call' && (current.name === 'now' || current.name === 'today')) return true;
  }

  return false;
}
