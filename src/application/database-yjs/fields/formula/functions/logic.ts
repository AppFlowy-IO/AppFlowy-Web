import { FormulaNode } from '../ast';
import { asBoolean } from '../coerce';
import { FormulaError } from '../errors';
import { FormulaFunctionSpec, TypeCheckContext } from '../registry';
import {
  bool,
  EMPTY,
  FormulaType,
  FormulaValue,
  isEmptyValue,
  typesCompatible,
  typeToString,
  unifyTypes,
  valuesEqual,
} from '../values';

function requireBooleanish(type: FormulaType, what: string, node: FormulaNode) {
  if (!typesCompatible(type, 'boolean')) {
    throw new FormulaError(`${what} must be a boolean, got ${typeToString(type)}`, node.position);
  }
}

function unifyBranches(types: FormulaType[], nodes: FormulaNode[], functionName: string): FormulaType {
  let result: FormulaType = 'empty';

  types.forEach((type, index) => {
    const unified = unifyTypes(result, type);

    if (unified === null) {
      throw new FormulaError(
        `${functionName}() branches must have the same type: ${typeToString(result)} vs ${typeToString(type)}`,
        nodes[index].position
      );
    }

    result = unified;
  });

  return result;
}

function checkArity(name: string, args: FormulaNode[], min: number, max: number, position: FormulaNode['position']) {
  if (args.length < min || args.length > max) {
    const expected = min === max ? `${min}` : `${min} to ${max}`;

    throw new FormulaError(`${name}() expects ${expected} argument${max === 1 ? '' : 's'}`, position);
  }
}

export const logicFunctions: FormulaFunctionSpec[] = [
  {
    name: 'if',
    category: 'logic',
    signature: 'if(condition, valueIfTrue, valueIfFalse)',
    description: 'Returns the first value if the condition is true; otherwise, returns the second value.',
    examples: [
      { expression: 'if(true, 1, 2)', result: '1' },
      { expression: 'if(prop("Checked") == true, "Complete", "Incomplete")', result: '"Complete"' },
    ],
    params: [],
    returnType: 'any',
    lazy: true,
    check: (args, ctx, position) => {
      checkArity('if', args, 3, 3, position);
      requireBooleanish(ctx.infer(args[0]), 'The if() condition', args[0]);
      return unifyBranches([ctx.infer(args[1]), ctx.infer(args[2])], [args[1], args[2]], 'if');
    },
    impl: (_args, ctx, nodes) => (asBoolean(ctx.evaluate(nodes[0])) ? ctx.evaluate(nodes[1]) : ctx.evaluate(nodes[2])),
  },
  {
    name: 'ifs',
    category: 'logic',
    signature: 'ifs(condition1, value1, condition2, value2, ..., default)',
    description: 'Returns the value for the first true condition. An alternative to nested if() calls.',
    examples: [
      { expression: 'ifs(true, 1, true, 2, 3)', result: '1' },
      { expression: 'ifs(false, 1, false, 2, 3)', result: '3' },
    ],
    params: [],
    returnType: 'any',
    lazy: true,
    check: (args, ctx: TypeCheckContext, position) => {
      if (args.length < 3 || args.length % 2 === 0) {
        throw new FormulaError('ifs() expects condition/value pairs followed by a default value', position);
      }

      const valueNodes: FormulaNode[] = [];

      for (let index = 0; index < args.length - 1; index += 2) {
        requireBooleanish(ctx.infer(args[index]), 'An ifs() condition', args[index]);
        valueNodes.push(args[index + 1]);
      }

      valueNodes.push(args[args.length - 1]);
      return unifyBranches(
        valueNodes.map((node) => ctx.infer(node)),
        valueNodes,
        'ifs'
      );
    },
    impl: (_args, ctx, nodes) => {
      for (let index = 0; index < nodes.length - 1; index += 2) {
        if (asBoolean(ctx.evaluate(nodes[index]))) return ctx.evaluate(nodes[index + 1]);
      }

      return ctx.evaluate(nodes[nodes.length - 1]);
    },
  },
  {
    name: 'empty',
    category: 'logic',
    signature: 'empty(value)',
    description: 'Returns true if the value is empty. 0, "", false, and [] are considered empty. Called with no argument, it is the empty value itself.',
    examples: [
      { expression: 'empty(0)', result: 'true' },
      { expression: 'empty([])', result: 'true' },
      { expression: 'if(empty(prop("Date")), empty(), prop("Date"))', result: 'the date, or nothing' },
    ],
    params: [{ name: 'value', type: 'any', optional: true }],
    returnType: (argTypes) => (argTypes.length === 0 ? 'empty' : 'boolean'),
    impl: (args) => (args.length === 0 ? EMPTY : bool(isEmptyValue(args[0]))),
  },
  {
    name: 'equal',
    category: 'logic',
    signature: 'equal(value1, value2)',
    description: 'Returns true if both values are equal. Same as the == operator.',
    examples: [
      { expression: 'equal(1, 1)', result: 'true' },
      { expression: '"a" == "b"', result: 'false' },
    ],
    params: [
      { name: 'value1', type: 'any' },
      { name: 'value2', type: 'any' },
    ],
    returnType: 'boolean',
    impl: ([a, b]) => bool(valuesEqual(a, b)),
  },
  {
    name: 'unequal',
    category: 'logic',
    signature: 'unequal(value1, value2)',
    description: 'Returns true if the values are not equal. Same as the != operator.',
    examples: [{ expression: 'unequal(1, 2)', result: 'true' }],
    params: [
      { name: 'value1', type: 'any' },
      { name: 'value2', type: 'any' },
    ],
    returnType: 'boolean',
    impl: ([a, b]) => bool(!valuesEqual(a, b)),
  },
  {
    name: 'and',
    category: 'logic',
    signature: 'and(condition1, condition2, ...)',
    description: 'Returns true if every condition is true. Same as the and / && operator.',
    examples: [
      { expression: 'and(true, false)', result: 'false' },
      { expression: 'prop("Done") and prop("Reviewed")', result: 'true when both are checked' },
    ],
    params: [],
    returnType: 'boolean',
    lazy: true,
    check: (args, ctx, position) => {
      checkArity('and', args, 1, Number.POSITIVE_INFINITY, position);
      args.forEach((arg) => requireBooleanish(ctx.infer(arg), 'Every and() argument', arg));
      return 'boolean';
    },
    impl: (_args, ctx, nodes) => bool(nodes.every((node) => asBoolean(ctx.evaluate(node)))),
  },
  {
    name: 'or',
    category: 'logic',
    signature: 'or(condition1, condition2, ...)',
    description: 'Returns true if any condition is true. Same as the or / || operator.',
    examples: [{ expression: 'or(true, false)', result: 'true' }],
    params: [],
    returnType: 'boolean',
    lazy: true,
    check: (args, ctx, position) => {
      checkArity('or', args, 1, Number.POSITIVE_INFINITY, position);
      args.forEach((arg) => requireBooleanish(ctx.infer(arg), 'Every or() argument', arg));
      return 'boolean';
    },
    impl: (_args, ctx, nodes) => bool(nodes.some((node) => asBoolean(ctx.evaluate(node)))),
  },
  {
    name: 'not',
    category: 'logic',
    signature: 'not(condition)',
    description: 'Returns the opposite of the condition. Same as the not / ! operator.',
    examples: [{ expression: 'not(true)', result: 'false' }],
    params: [{ name: 'condition', type: 'boolean' }],
    returnType: 'boolean',
    impl: ([value]) => bool(!asBoolean(value)),
  },
  {
    name: 'let',
    category: 'variable',
    signature: 'let(name, value, expression)',
    description:
      'Creates a variable with the given name and value, then evaluates the expression with that variable in scope.',
    examples: [
      { expression: 'let(x, 2, x * x)', result: '4' },
      { expression: 'let(tax, prop("Subtotal") * 0.1, prop("Subtotal") + tax)', result: 'subtotal plus 10%' },
    ],
    params: [],
    returnType: 'any',
    lazy: true,
    check: (args, ctx, position) => {
      checkArity('let', args, 3, 3, position);
      const [nameNode, valueNode, bodyNode] = args;

      if (nameNode.kind !== 'ident') {
        throw new FormulaError('let() expects a variable name as its first argument', nameNode.position);
      }

      const valueType = ctx.infer(valueNode);

      return ctx.withBindings({ [nameNode.name]: valueType }, () => ctx.infer(bodyNode));
    },
    impl: (_args, ctx, nodes) => {
      const [nameNode, valueNode, bodyNode] = nodes;
      const name = nameNode.kind === 'ident' ? nameNode.name : '';
      const value = ctx.evaluate(valueNode);

      return ctx.withBindings({ [name]: value }, () => ctx.evaluate(bodyNode));
    },
  },
  {
    name: 'lets',
    category: 'variable',
    signature: 'lets(name1, value1, name2, value2, ..., expression)',
    description: 'Creates several variables at once, then evaluates the expression with them in scope.',
    examples: [{ expression: 'lets(a, 1, b, 2, a + b)', result: '3' }],
    params: [],
    returnType: 'any',
    lazy: true,
    check: (args, ctx, position) => {
      if (args.length < 3 || args.length % 2 === 0) {
        throw new FormulaError('lets() expects name/value pairs followed by an expression', position);
      }

      const bind = (index: number): FormulaType => {
        if (index >= args.length - 1) return ctx.infer(args[args.length - 1]);
        const nameNode = args[index];

        if (nameNode.kind !== 'ident') {
          throw new FormulaError('lets() expects a variable name before each value', nameNode.position);
        }

        const valueType = ctx.infer(args[index + 1]);

        return ctx.withBindings({ [nameNode.name]: valueType }, () => bind(index + 2));
      };

      return bind(0);
    },
    impl: (_args, ctx, nodes) => {
      const bind = (index: number): FormulaValue => {
        if (index >= nodes.length - 1) return ctx.evaluate(nodes[nodes.length - 1]);
        const nameNode = nodes[index];
        const name = nameNode.kind === 'ident' ? nameNode.name : '';
        const value = ctx.evaluate(nodes[index + 1]);

        return ctx.withBindings({ [name]: value }, () => bind(index + 2));
      };

      return bind(0);
    },
  },
];
