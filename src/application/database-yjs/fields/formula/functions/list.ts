import { FormulaNode } from '../ast';
import { asBoolean, asList, asNumber, asText } from '../coerce';
import { FormulaError, SourcePosition } from '../errors';
import { FormulaFunctionSpec, TypeCheckContext } from '../registry';
import {
  bool,
  EMPTY,
  FormulaType,
  FormulaValue,
  isListType,
  list,
  listOf,
  num,
  text,
  typesCompatible,
  typeToString,
  unifyTypes,
  valuesEqual,
} from '../values';

const LIST_ANY = listOf('any');

/** Element type of a list type; a non-list value is treated as a one-item list. */
function elementType(type: FormulaType): FormulaType {
  if (isListType(type)) return type.list;
  if (type === 'empty' || type === 'any') return 'any';
  return type;
}

function requireList(type: FormulaType, functionName: string, node: FormulaNode) {
  if (!typesCompatible(type, LIST_ANY)) {
    throw new FormulaError(`${functionName}() expects a list, got ${typeToString(type)}`, node.position);
  }
}

function checkArity(name: string, args: FormulaNode[], count: number, position: SourcePosition) {
  if (args.length !== count) {
    throw new FormulaError(`${name}() expects ${count} argument${count === 1 ? '' : 's'}`, position);
  }
}

/**
 * Shared shape of map/filter/find/findIndex/some/every: the second argument is
 * evaluated once per item with `current` and `index` bound.
 */
function iterating(
  name: string,
  signature: string,
  description: string,
  examples: FormulaFunctionSpec['examples'],
  resultType: (listType: FormulaType, bodyType: FormulaType) => FormulaType,
  bodyMustBeBoolean: boolean,
  run: (items: FormulaValue[], evaluateBody: (item: FormulaValue, index: number) => FormulaValue) => FormulaValue
): FormulaFunctionSpec {
  return {
    name,
    category: 'list',
    signature,
    description,
    examples,
    params: [],
    returnType: 'any',
    lazy: true,
    check: (args, ctx: TypeCheckContext, position) => {
      checkArity(name, args, 2, position);
      const listType = ctx.infer(args[0]);

      requireList(listType, name, args[0]);
      const bodyType = ctx.withBindings({ current: elementType(listType), index: 'number' }, () => ctx.infer(args[1]));

      if (bodyMustBeBoolean && !typesCompatible(bodyType, 'boolean')) {
        throw new FormulaError(`${name}() expects a condition that returns a boolean`, args[1].position);
      }

      return resultType(listType, bodyType);
    },
    impl: (_args, ctx, nodes, position) => {
      const items = asList(ctx.evaluate(nodes[0]));

      return run(items, (item, index) => {
        ctx.consumeWork(1, position);
        return ctx.withBindings({ current: item, index: num(index) }, () => ctx.evaluate(nodes[1]));
      });
    },
  };
}

function sortKey(value: FormulaValue): string | number {
  switch (value.type) {
    case 'number':
      return value.value;
    case 'boolean':
      return value.value ? 1 : 0;
    case 'date':
      return value.value.start;
    case 'empty':
      return Number.NEGATIVE_INFINITY;
    default:
      return asText(value);
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareKeys(keyA: string | number, keyB: string | number): number {
  if (typeof keyA === 'number' && typeof keyB === 'number') return keyA - keyB;
  return collator.compare(String(keyA), String(keyB));
}

export const listFunctions: FormulaFunctionSpec[] = [
  {
    name: 'at',
    category: 'list',
    signature: 'at(list, index)',
    description: 'Returns the item at the given position in the list. The first item is at index 0.',
    examples: [{ expression: '[1, 2, 3].at(1)', result: '2' }],
    params: [
      { name: 'list', type: LIST_ANY },
      { name: 'index', type: 'number' },
    ],
    returnType: ([listType]) => elementType(listType),
    impl: ([value, index], _ctx, _nodes, position) => {
      const items = asList(value);
      const at = Math.trunc(asNumber(index, position));

      return items[at < 0 ? items.length + at : at] ?? EMPTY;
    },
  },
  {
    name: 'first',
    category: 'list',
    signature: 'first(list)',
    description: 'Returns the first item in the list.',
    examples: [{ expression: 'first([1, 2, 3])', result: '1' }],
    params: [{ name: 'list', type: LIST_ANY }],
    returnType: ([listType]) => elementType(listType),
    impl: ([value]) => asList(value)[0] ?? EMPTY,
  },
  {
    name: 'last',
    category: 'list',
    signature: 'last(list)',
    description: 'Returns the last item in the list.',
    examples: [{ expression: 'last([1, 2, 3])', result: '3' }],
    params: [{ name: 'list', type: LIST_ANY }],
    returnType: ([listType]) => elementType(listType),
    impl: ([value]) => {
      const items = asList(value);

      return items[items.length - 1] ?? EMPTY;
    },
  },
  {
    name: 'slice',
    category: 'list',
    signature: 'slice(list, startIndex, endIndex?)',
    description: 'Returns the items from the start index (inclusive) to the end index (optional and exclusive).',
    examples: [{ expression: '[1, 2, 3].slice(1)', result: '[2, 3]' }],
    params: [
      { name: 'list', type: LIST_ANY },
      { name: 'startIndex', type: 'number' },
      { name: 'endIndex', type: 'number', optional: true },
    ],
    returnType: ([listType]) => listOf(elementType(listType)),
    impl: ([value, start, end], _ctx, _nodes, position) =>
      list(
        asList(value).slice(
          Math.trunc(asNumber(start, position)),
          end === undefined ? undefined : Math.trunc(asNumber(end, position))
        )
      ),
  },
  {
    name: 'concat',
    category: 'list',
    signature: 'concat(list1, list2, ...)',
    description: 'Combines several lists into one. Use + to combine text.',
    examples: [{ expression: 'concat([1], [2, 3])', result: '[1, 2, 3]' }],
    params: [{ name: 'lists', type: 'any', rest: true }],
    returnType: (argTypes) => {
      let inner: FormulaType = 'empty';

      argTypes.forEach((type) => {
        inner = unifyTypes(inner, elementType(type)) ?? 'any';
      });

      return listOf(inner);
    },
    impl: (args) => list(args.flatMap((arg) => asList(arg))),
  },
  {
    name: 'sort',
    category: 'list',
    signature: 'sort(list)',
    description: 'Returns the list sorted in ascending order.',
    examples: [{ expression: 'sort([3, 1, 2])', result: '[1, 2, 3]' }],
    params: [{ name: 'list', type: LIST_ANY }],
    returnType: ([listType]) => listOf(elementType(listType)),
    impl: ([value], ctx, _nodes, position) => {
      // Compute recursive text keys once; comparisons share the cell's budget.
      const items = asList(value).map((item) => ({ item, key: sortKey(item) }));

      items.sort((a, b) => {
        ctx.consumeWork(1, position);
        return compareKeys(a.key, b.key);
      });
      return list(items.map(({ item }) => item));
    },
  },
  {
    name: 'reverse',
    category: 'list',
    signature: 'reverse(list)',
    description: 'Returns the list in reverse order.',
    examples: [{ expression: 'reverse([1, 2, 3])', result: '[3, 2, 1]' }],
    params: [{ name: 'list', type: LIST_ANY }],
    returnType: ([listType]) => listOf(elementType(listType)),
    impl: ([value]) => list([...asList(value)].reverse()),
  },
  {
    name: 'unique',
    category: 'list',
    signature: 'unique(list)',
    description: 'Returns the list with duplicate items removed.',
    examples: [{ expression: 'unique([1, 1, 2])', result: '[1, 2]' }],
    params: [{ name: 'list', type: LIST_ANY }],
    returnType: ([listType]) => listOf(elementType(listType)),
    impl: ([value], ctx, _nodes, position) => {
      const result: FormulaValue[] = [];
      const visit = () => ctx.consumeWork(1, position);

      asList(value).forEach((item) => {
        if (!result.some((existing) => valuesEqual(existing, item, visit))) result.push(item);
      });

      return list(result);
    },
  },
  {
    name: 'includes',
    category: 'list',
    signature: 'includes(list, value)',
    description: 'Returns true if the list contains the value.',
    examples: [{ expression: '["a", "b"].includes("a")', result: 'true' }],
    params: [
      { name: 'list', type: LIST_ANY },
      { name: 'value', type: 'any' },
    ],
    returnType: 'boolean',
    impl: ([value, needle], ctx, _nodes, position) =>
      bool(asList(value).some((item) => valuesEqual(item, needle, () => ctx.consumeWork(1, position)))),
  },
  {
    name: 'flat',
    category: 'list',
    signature: 'flat(list)',
    description: 'Flattens a list of lists into a single list.',
    examples: [{ expression: 'flat([[1, 2], [3]])', result: '[1, 2, 3]' }],
    params: [{ name: 'list', type: LIST_ANY }],
    returnType: ([listType]) => listOf(elementType(elementType(listType))),
    impl: ([value]) => list(asList(value).flatMap((item) => asList(item))),
  },
  iterating(
    'map',
    'map(list, expression)',
    'Transforms every item in the list with the expression. Use `current` for the item and `index` for its position.',
    [{ expression: '[1, 2, 3].map(current * 2)', result: '[2, 4, 6]' }],
    (_listType, bodyType) => listOf(bodyType),
    false,
    (items, evaluateBody) => list(items.map((item, index) => evaluateBody(item, index)))
  ),
  iterating(
    'filter',
    'filter(list, condition)',
    'Keeps only the items for which the condition is true. Use `current` for the item.',
    [{ expression: '[1, 2, 3].filter(current > 1)', result: '[2, 3]' }],
    (listType) => listOf(elementType(listType)),
    true,
    (items, evaluateBody) => list(items.filter((item, index) => asBoolean(evaluateBody(item, index))))
  ),
  iterating(
    'find',
    'find(list, condition)',
    'Returns the first item for which the condition is true.',
    [{ expression: '[1, 2, 3].find(current > 1)', result: '2' }],
    (listType) => elementType(listType),
    true,
    (items, evaluateBody) => items.find((item, index) => asBoolean(evaluateBody(item, index))) ?? EMPTY
  ),
  iterating(
    'findIndex',
    'findIndex(list, condition)',
    'Returns the position of the first item for which the condition is true, or -1 if none matches.',
    [{ expression: '[1, 2, 3].findIndex(current > 1)', result: '1' }],
    () => 'number',
    true,
    (items, evaluateBody) => num(items.findIndex((item, index) => asBoolean(evaluateBody(item, index))))
  ),
  iterating(
    'some',
    'some(list, condition)',
    'Returns true if the condition is true for at least one item.',
    [{ expression: '[1, 2, 3].some(current > 2)', result: 'true' }],
    () => 'boolean',
    true,
    (items, evaluateBody) => bool(items.some((item, index) => asBoolean(evaluateBody(item, index))))
  ),
  iterating(
    'every',
    'every(list, condition)',
    'Returns true if the condition is true for every item.',
    [{ expression: '[1, 2, 3].every(current > 0)', result: 'true' }],
    () => 'boolean',
    true,
    (items, evaluateBody) => bool(items.every((item, index) => asBoolean(evaluateBody(item, index))))
  ),
  {
    name: 'id',
    category: 'page',
    signature: 'id()',
    description: 'Returns the id of the current row.',
    examples: [{ expression: 'id()', result: '"a1b2c3..."' }],
    params: [],
    returnType: 'text',
    impl: (_args, ctx) => text(ctx.rowId ?? ''),
  },
];
