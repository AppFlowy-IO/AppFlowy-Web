import { FormulaNode } from './ast';
import { FormulaError, SourcePosition } from './errors';
import { getFormulaFunction } from './functions';
import { FormulaFunctionSpec, TypeCheckContext } from './registry';
import { FormulaType, isListType, listOf, typesCompatible, typeToString, unifyTypes } from './values';

export interface CheckOptions {
  /** Static type of `prop("ref")`; throw a FormulaError for unknown properties. */
  getPropType: (ref: string, position: SourcePosition) => FormulaType;
}

const NUMERIC_OPERATORS = new Set(['-', '*', '/', '%', '^']);
const ORDER_OPERATORS = new Set(['<', '<=', '>', '>=']);

function describe(type: FormulaType) {
  return typeToString(type);
}

function checkEagerCall(spec: FormulaFunctionSpec, args: FormulaNode[], argTypes: FormulaType[], position: SourcePosition) {
  const required = spec.params.filter((param) => !param.optional && !param.rest).length;
  const rest = spec.params.find((param) => param.rest);
  const max = rest ? Number.POSITIVE_INFINITY : spec.params.length;

  if (argTypes.length < required || argTypes.length > max) {
    const expected = rest
      ? `at least ${required}`
      : required === max
      ? `${required}`
      : `${required} to ${max}`;

    throw new FormulaError(`${spec.name}() expects ${expected} argument${max === 1 ? '' : 's'}`, position);
  }

  argTypes.forEach((argType, index) => {
    const param = spec.params[Math.min(index, spec.params.length - 1)];

    if (!param) return;
    const accepted = Array.isArray(param.type) ? param.type : [param.type];

    if (!accepted.some((type) => typesCompatible(type, argType))) {
      throw new FormulaError(
        `${spec.name}() expects ${accepted.map(describe).join(' or ')} for "${param.name}", got ${describe(argType)}`,
        args[index].position
      );
    }
  });
}

/**
 * Infers the static type of a formula and reports the first type error.
 * Rules mirror Notion: operands must match, `if` branches must unify, and
 * only booleans drive conditions. `empty` is compatible with every type.
 */
export function inferFormulaType(root: FormulaNode, options: CheckOptions): FormulaType {
  const scopes: Array<Map<string, FormulaType>> = [new Map()];

  const lookup = (name: string): FormulaType | undefined => {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const type = scopes[index].get(name);

      if (type !== undefined) return type;
    }

    return undefined;
  };

  const ctx: TypeCheckContext = {
    getPropType: (ref, position) => options.getPropType(ref, position ?? root.position),
    get env() {
      const merged = new Map<string, FormulaType>();

      scopes.forEach((scope) => scope.forEach((type, name) => merged.set(name, type)));
      return merged;
    },
    infer: (node) => infer(node),
    withBindings: (bindings, body) => {
      scopes.push(new Map(Object.entries(bindings)));
      try {
        return body();
      } finally {
        scopes.pop();
      }
    },
  };

  const infer = (node: FormulaNode): FormulaType => {
    const type = inferNode(node);

    node.inferredType = type;
    return type;
  };

  const inferNode = (node: FormulaNode): FormulaType => {
    switch (node.kind) {
      case 'number':
        return 'number';
      case 'string':
        return 'text';
      case 'boolean':
        return 'boolean';
      case 'prop':
        return options.getPropType(node.ref, node.position);
      case 'ident': {
        const type = lookup(node.name);

        if (type === undefined) {
          throw new FormulaError(`Unknown variable or function "${node.name}"`, node.position);
        }

        return type;
      }

      case 'list': {
        let inner: FormulaType = 'empty';

        node.items.forEach((item) => {
          const itemType = infer(item);
          const unified = unifyTypes(inner, itemType);

          if (unified === null) {
            throw new FormulaError(
              `List items must have the same type: ${describe(inner)} vs ${describe(itemType)}`,
              item.position
            );
          }

          inner = unified;
        });

        return listOf(inner);
      }

      case 'unary': {
        const operand = infer(node.operand);

        if (node.op === '-') {
          if (!typesCompatible(operand, 'number')) {
            throw new FormulaError(`Unary "-" expects a number, got ${describe(operand)}`, node.operand.position);
          }

          return 'number';
        }

        // Like Notion, `not` negates any value by emptiness: `!0` and `![]` are true.
        return 'boolean';
      }

      case 'binary': {
        const left = infer(node.left);
        const right = infer(node.right);

        if (node.op === '+') {
          if (typesCompatible(left, 'number') && typesCompatible(right, 'number')) {
            // `empty + empty` has no better type than number.
            return 'number';
          }

          // Anything else is joined as text, as in Notion: `"Due " + now()`, `1 + true`.
          return 'text';
        }

        if (NUMERIC_OPERATORS.has(node.op)) {
          if (!typesCompatible(left, 'number')) {
            throw new FormulaError(`"${node.op}" expects a number, got ${describe(left)}`, node.left.position);
          }

          if (!typesCompatible(right, 'number')) {
            throw new FormulaError(`"${node.op}" expects a number, got ${describe(right)}`, node.right.position);
          }

          return 'number';
        }

        if (node.op === '==' || node.op === '!=') {
          if (!typesCompatible(left, right)) {
            throw new FormulaError(
              `Cannot compare ${describe(left)} with ${describe(right)}; convert one side first`,
              node.position
            );
          }

          return 'boolean';
        }

        if (ORDER_OPERATORS.has(node.op)) {
          const comparable = (type: FormulaType) =>
            typesCompatible(type, 'number') || typesCompatible(type, 'text') || typesCompatible(type, 'date');

          if (!comparable(left) || !comparable(right) || !typesCompatible(left, right) || isListType(left)) {
            throw new FormulaError(
              `"${node.op}" expects two numbers, two dates or two text values, got ${describe(left)} and ${describe(right)}`,
              node.position
            );
          }

          return 'boolean';
        }

        // and / or
        if (!typesCompatible(left, 'boolean')) {
          throw new FormulaError(`"${node.op}" expects a boolean, got ${describe(left)}`, node.left.position);
        }

        if (!typesCompatible(right, 'boolean')) {
          throw new FormulaError(`"${node.op}" expects a boolean, got ${describe(right)}`, node.right.position);
        }

        return 'boolean';
      }

      case 'conditional': {
        const test = infer(node.test);

        if (!typesCompatible(test, 'boolean')) {
          throw new FormulaError(`The condition before "?" must be a boolean, got ${describe(test)}`, node.test.position);
        }

        const then = infer(node.then);
        const otherwise = infer(node.else);
        const unified = unifyTypes(then, otherwise);

        if (unified === null) {
          throw new FormulaError(
            `Both results of "? :" must have the same type: ${describe(then)} vs ${describe(otherwise)}`,
            node.else.position
          );
        }

        return unified;
      }

      case 'call': {
        const spec = getFormulaFunction(node.name);

        if (!spec) {
          throw new FormulaError(`Unknown function "${node.name}"`, node.position);
        }

        if (spec.check) return spec.check(node.args, ctx, node.position);

        const argTypes = node.args.map((arg) => infer(arg));

        checkEagerCall(spec, node.args, argTypes, node.position);
        return typeof spec.returnType === 'function' ? spec.returnType(argTypes) : spec.returnType;
      }
    }
  };

  return infer(root);
}
