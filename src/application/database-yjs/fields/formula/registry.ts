import { FormulaNode } from './ast';
import { SourcePosition } from './errors';
import { FormulaType, FormulaValue } from './values';

export type FormulaFunctionCategory = 'logic' | 'text' | 'number' | 'date' | 'list' | 'variable' | 'page';

export interface FormulaFunctionExample {
  expression: string;
  result: string;
}

export interface FormulaParam {
  name: string;
  /** Accepted static type(s). `any` accepts everything. */
  type: FormulaType | FormulaType[];
  optional?: boolean;
  /** The last parameter may repeat (`min(1, 2, 3)`). */
  rest?: boolean;
}

/** What the evaluator hands to a function implementation. */
export interface EvalContext {
  /** Resolves `prop("ref")` for the row being evaluated. */
  getProp(ref: string, position?: SourcePosition): FormulaValue;
  /** Current time in unix milliseconds (injectable for tests). */
  now(): number;
  /** The id of the row being evaluated, for `id()`. */
  rowId?: string;
  /** Variable bindings (`current`, `index`, `let` names). */
  env: ReadonlyMap<string, FormulaValue>;
  /** Evaluates a sub-expression in this context (lazy functions). */
  evaluate(node: FormulaNode): FormulaValue;
  /** Evaluates `body` with extra bindings in scope. */
  withBindings<T>(bindings: Record<string, FormulaValue>, body: () => T): T;
}

/** What the type checker hands to a function's `check` hook. */
export interface TypeCheckContext {
  getPropType(ref: string, position?: SourcePosition): FormulaType;
  env: ReadonlyMap<string, FormulaType>;
  infer(node: FormulaNode): FormulaType;
  withBindings<T>(bindings: Record<string, FormulaType>, body: () => T): T;
}

export interface FormulaFunctionSpec {
  name: string;
  category: FormulaFunctionCategory;
  /** Signature shown in the editor docs panel, e.g. `if(condition, valueIfTrue, valueIfFalse)`. */
  signature: string;
  description: string;
  examples: FormulaFunctionExample[];
  /** Parameters checked statically for eager functions. Ignored when `check` is given. */
  params: FormulaParam[];
  /**
   * Result type. A function receives the inferred argument types so generic
   * functions (`if`, `at`, `first`, ...) can derive their result.
   */
  returnType: FormulaType | ((argTypes: FormulaType[]) => FormulaType);
  /** Custom static typing for lazy/scoped functions; receives raw argument nodes. */
  check?: (args: FormulaNode[], ctx: TypeCheckContext, position: SourcePosition) => FormulaType;
  /**
   * Lazy functions get their arguments unevaluated (`args` is empty, `nodes`
   * holds the AST) so they can short-circuit or bind variables.
   */
  lazy?: boolean;
  impl: (args: FormulaValue[], ctx: EvalContext, nodes: FormulaNode[], position: SourcePosition) => FormulaValue;
}
