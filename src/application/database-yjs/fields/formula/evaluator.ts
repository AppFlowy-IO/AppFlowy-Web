import { FormulaNode } from './ast';
import { asBoolean, asNumber, asText } from './coerce';
import { FormulaError, SourcePosition } from './errors';
import { getFormulaFunction } from './functions';
import { EvalContext } from './registry';
import { bool, EMPTY, FormulaValue, list, num, text, valuesEqual } from './values';

export interface EvaluateOptions {
  getProp: (ref: string, position: SourcePosition) => FormulaValue;
  now?: () => number;
  rowId?: string;
}

function compareOrdered(left: FormulaValue, right: FormulaValue, position: SourcePosition): number | null {
  if (left.type === 'empty' || right.type === 'empty') return null;
  if (left.type === 'text' || right.type === 'text') {
    return asText(left).localeCompare(asText(right));
  }

  if (left.type === 'date' && right.type === 'date') {
    return left.value.start - right.value.start;
  }

  return asNumber(left, position) - asNumber(right, position);
}

/** Evaluates a parsed formula. Type errors are caught earlier by `inferFormulaType`. */
export function evaluateFormula(root: FormulaNode, options: EvaluateOptions): FormulaValue {
  const scopes: Array<Map<string, FormulaValue>> = [new Map()];
  const now = options.now ?? (() => Date.now());

  const lookup = (name: string): FormulaValue | undefined => {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const value = scopes[index].get(name);

      if (value !== undefined) return value;
    }

    return undefined;
  };

  const ctx: EvalContext = {
    getProp: (ref, position) => options.getProp(ref, position ?? root.position),
    now,
    rowId: options.rowId,
    get env() {
      const merged = new Map<string, FormulaValue>();

      scopes.forEach((scope) => scope.forEach((value, name) => merged.set(name, value)));
      return merged;
    },
    evaluate: (node) => evaluate(node),
    withBindings: (bindings, body) => {
      scopes.push(new Map(Object.entries(bindings)));
      try {
        return body();
      } finally {
        scopes.pop();
      }
    },
  };

  const evaluate = (node: FormulaNode): FormulaValue => {
    switch (node.kind) {
      case 'number':
        return num(node.value);
      case 'string':
        return text(node.value);
      case 'boolean':
        return bool(node.value);
      case 'prop':
        return options.getProp(node.ref, node.position);
      case 'ident': {
        const value = lookup(node.name);

        if (value === undefined) throw new FormulaError(`Unknown variable "${node.name}"`, node.position);
        return value;
      }

      case 'list':
        return list(node.items.map(evaluate));
      case 'unary': {
        const operand = evaluate(node.operand);

        if (node.op === '-') return operand.type === 'empty' ? EMPTY : num(-asNumber(operand, node.position));
        return bool(!asBoolean(operand));
      }

      case 'conditional':
        return asBoolean(evaluate(node.test)) ? evaluate(node.then) : evaluate(node.else);
      case 'binary': {
        // Short-circuit before evaluating the right operand.
        if (node.op === 'and') return bool(asBoolean(evaluate(node.left)) && asBoolean(evaluate(node.right)));
        if (node.op === 'or') return bool(asBoolean(evaluate(node.left)) || asBoolean(evaluate(node.right)));

        const left = evaluate(node.left);
        const right = evaluate(node.right);

        switch (node.op) {
          case '+':
            if (left.type === 'text' || right.type === 'text') return text(asText(left) + asText(right));
            if (left.type === 'empty' && right.type === 'empty') return EMPTY;
            return num(asNumber(left, node.position) + asNumber(right, node.position));
          case '-':
            return num(asNumber(left, node.position) - asNumber(right, node.position));
          case '*':
            return num(asNumber(left, node.position) * asNumber(right, node.position));
          case '/':
            return num(asNumber(left, node.position) / asNumber(right, node.position));
          case '%':
            return num(asNumber(left, node.position) % asNumber(right, node.position));
          case '^':
            return num(asNumber(left, node.position) ** asNumber(right, node.position));
          case '==':
            return bool(valuesEqual(left, right));
          case '!=':
            return bool(!valuesEqual(left, right));
          case '<':
          case '<=':
          case '>':
          case '>=': {
            const order = compareOrdered(left, right, node.position);

            if (order === null) return bool(false);
            switch (node.op) {
              case '<':
                return bool(order < 0);
              case '<=':
                return bool(order <= 0);
              case '>':
                return bool(order > 0);
              default:
                return bool(order >= 0);
            }
          }

          default:
            throw new FormulaError(`Unsupported operator "${node.op}"`, node.position);
        }
      }

      case 'call': {
        const spec = getFormulaFunction(node.name);

        if (!spec) throw new FormulaError(`Unknown function "${node.name}"`, node.position);
        if (spec.lazy) return spec.impl([], ctx, node.args, node.position);
        return spec.impl(node.args.map(evaluate), ctx, node.args, node.position);
      }
    }
  };

  return evaluate(root);
}
