import { SourcePosition } from './errors';

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

export type FormulaNode =
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

/** Collects every `prop()` reference in evaluation order (duplicates preserved). */
export function collectPropRefs(node: FormulaNode, out: string[] = []): string[] {
  switch (node.kind) {
    case 'prop':
      out.push(node.ref);
      break;
    case 'list':
      node.items.forEach((item) => collectPropRefs(item, out));
      break;
    case 'call':
      node.args.forEach((arg) => collectPropRefs(arg, out));
      break;
    case 'unary':
      collectPropRefs(node.operand, out);
      break;
    case 'binary':
      collectPropRefs(node.left, out);
      collectPropRefs(node.right, out);
      break;
    case 'conditional':
      collectPropRefs(node.test, out);
      collectPropRefs(node.then, out);
      collectPropRefs(node.else, out);
      break;
    default:
      break;
  }

  return out;
}
