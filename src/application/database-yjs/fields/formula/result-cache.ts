import { getStoredCellFieldType } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YjsDatabaseKey } from '@/application/types';

import { FormulaNode } from './ast';
import { readFieldFormulaValue } from './cell-values';
import { compileFormula } from './compile';
import { FormulaCellResult } from './formula.type';
import { parseFormulaTypeOption } from './parse';
import { FormulaFieldSchema, formulaSchemaSignature, hasFormulaSchemaSource, resolveFormulaField } from './schema';
import { FormulaType, FormulaValue } from './values';

import type { EvaluateFormulaCellOptions } from './evaluate';
import type { Doc } from 'yjs';

/** Per database document; byte estimates include strings, values and entry overhead. */
export const FORMULA_RESULT_CACHE_LIMITS = {
  entries: 512,
  bytes: 4 * 1024 * 1024,
  entryBytes: 64 * 1024,
} as const;

const localFieldTypes = new Set([
  FieldType.RichText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.URL,
  FieldType.Checklist,
  FieldType.Summary,
  FieldType.Translate,
  FieldType.Time,
  FieldType.Media,
]);

// Explicitly opt functions in: adding a clock/external function to the language
// must not silently make its results cacheable. Date functions also depend on
// ambient timezone/locale, even when they do not directly call now().
const localFunctions = new Set(
  (
    'if ifs empty equal unequal and or not let lets ' +
    'length substring contains test match replace replaceAll lower upper repeat trim split join format toNumber ' +
    'add subtract multiply divide mod pow abs round ceil floor sqrt cbrt exp ln log10 log2 sign ' +
    'min max sum mean median pi e formatNumber ' +
    'at first last slice concat sort reverse unique includes flat map filter find findIndex some every id'
  ).split(' ')
);

interface CacheEntry {
  fingerprint: string;
  result: FormulaCellResult;
  bytes: number;
}

interface DatabaseCache {
  signature: string;
  entries: Map<string, CacheEntry>;
  bytes: number;
  disposed: boolean;
}

const databaseCaches = new WeakMap<Doc, DatabaseCache>();
const plans = new WeakMap<FormulaFieldSchema[], Map<string, FormulaFieldSchema[] | null>>();

function databaseCache(doc: Doc): DatabaseCache {
  let cache = databaseCaches.get(doc);

  if (!cache) {
    const scope: DatabaseCache = { signature: '', entries: new Map(), bytes: 0, disposed: false };

    // One database listener owns all entries; row documents are never retained.
    doc.once('destroy', () => {
      scope.entries.clear();
      scope.signature = '';
      scope.bytes = 0;
      scope.disposed = true;
    });
    databaseCaches.set(doc, scope);
    cache = scope;
  }

  return cache;
}

/** Plans contain database fields only, never row documents or row values. */
function localDependencies(options: EvaluateFormulaCellOptions): FormulaFieldSchema[] | null {
  const { schema, fieldId } = options;
  let byField = plans.get(schema);

  if (!byField) {
    byField = new Map();
    plans.set(schema, byField);
  }

  if (byField.has(fieldId)) return byField.get(fieldId)!;
  const leaves = new Map<string, FormulaFieldSchema>();
  const visited = new Set<string>();
  const pendingFields = [schema.find((entry) => entry.id === fieldId)];
  let safe = true;

  while (safe && pendingFields.length > 0) {
    const entry = pendingFields.pop();

    if (!entry || entry.type !== FieldType.Formula) {
      safe = false;
      break;
    }

    if (visited.has(entry.id)) continue;
    visited.add(entry.id);
    const compiled = compileFormula(parseFormulaTypeOption(entry.field).formula, schema, entry.id);

    if (compiled.error) {
      safe = false;
      break;
    }

    const pendingNodes: FormulaNode[] = compiled.ast ? [compiled.ast] : [];

    while (safe && pendingNodes.length > 0) {
      const node = pendingNodes.pop()!;

      switch (node.kind) {
        case 'prop': {
          const dependency = resolveFormulaField(schema, node.ref);

          if (!dependency) safe = false;
          else if (dependency.type === FieldType.Formula) pendingFields.push(dependency);
          else if (localFieldTypes.has(dependency.type)) leaves.set(dependency.id, dependency);
          else safe = false;
          break;
        }

        case 'call':
          if (!localFunctions.has(node.name)) safe = false;
          pendingNodes.push(...node.args);
          break;
        case 'list':
          pendingNodes.push(...node.items);
          break;
        case 'unary':
          pendingNodes.push(node.operand);
          break;
        case 'binary':
          pendingNodes.push(node.left, node.right);
          break;
        case 'conditional':
          pendingNodes.push(node.test, node.then, node.else);
          break;
      }
    }
  }

  const result = safe ? Array.from(leaves.values()) : null;

  // Very wide databases do not need an unbounded second cache of plans.
  if (byField.size >= FORMULA_RESULT_CACHE_LIMITS.entries) byField.delete(byField.keys().next().value);
  byField.set(fieldId, result);
  return result;
}

/** Bounded, typed and lossless: JSON's number conversion would alias -0 and 0. */
function valueFingerprint(values: Iterable<FormulaValue>): string | undefined {
  const parts: string[] = [];
  let size = 0;
  const append = (part: string): boolean => {
    size += part.length * 2 + 32;
    if (size > FORMULA_RESULT_CACHE_LIMITS.entryBytes) return false;
    parts.push(part);
    return true;
  };

  const visit = (value: FormulaValue, depth: number): boolean => {
    if (depth > 64) return false;
    switch (value.type) {
      case 'empty':
        return append('e;');
      case 'boolean':
        return append(value.value ? 'b1;' : 'b0;');
      case 'number':
        return Number.isFinite(value.value) && append(`n${Object.is(value.value, -0) ? '-0' : value.value};`);
      case 'text':
        return (
          value.value.length * 2 <= FORMULA_RESULT_CACHE_LIMITS.entryBytes && append(`t${JSON.stringify(value.value)};`)
        );
      case 'date':
        return false;
      case 'list':
        if (!append('[')) return false;
        for (const item of value.items) {
          if (!visit(item, depth + 1)) return false;
        }

        return append(']');
    }
  };

  for (const value of values) {
    if (!visit(value, 0)) return undefined;
  }

  return parts.join('');
}

function cloneValue(value: FormulaValue): FormulaValue {
  if (value.type === 'list') return { type: 'list', items: value.items.map(cloneValue) };
  if (value.type === 'date') return { type: 'date', value: { ...value.value } };
  return { ...value };
}

function cloneType(type: FormulaType): FormulaType {
  return typeof type === 'string' ? type : { list: cloneType(type.list) };
}

function cloneResult(result: FormulaCellResult): FormulaCellResult {
  return { ...result, value: cloneValue(result.value), resultType: cloneType(result.resultType) };
}

/**
 * Only top-level saved evaluations use this cache. Each hit proves equality of
 * current decoded leaves, so local/remote edits and reads inside one Yjs
 * transaction do not depend on observer delivery or timestamp resolution.
 */
export function withFormulaResultCache(
  options: EvaluateFormulaCellOptions,
  evaluate: (values: Map<string, FormulaValue>) => FormulaCellResult
): FormulaCellResult {
  const values = new Map<string, FormulaValue>();
  const doc = options.field.doc;

  if (options.visiting !== undefined || !doc || !options.row.doc || !hasFormulaSchemaSource(options.schema)) {
    return evaluate(values);
  }

  const cache = databaseCache(doc);

  if (cache.disposed) return evaluate(values);
  const signature = formulaSchemaSignature(options.schema);

  if (signature.length * 2 > FORMULA_RESULT_CACHE_LIMITS.entryBytes) return evaluate(values);
  const dependencies = localDependencies(options);
  const cells = options.row.get(YjsDatabaseKey.cells);

  if (!dependencies || !cells) return evaluate(values);
  // Reading a converted date as text can still depend on timezone/date options.
  if (
    dependencies.some((entry) => {
      const cell = cells.get(entry.id);

      return cell && !localFieldTypes.has(getStoredCellFieldType(cell, entry.type));
    })
  ) {
    return evaluate(values);
  }

  let leaves: string | undefined;

  try {
    dependencies.forEach((entry) => values.set(entry.id, readFieldFormulaValue(entry, options.row, options)));
    leaves = valueFingerprint(values.values());
  } catch {
    // A bad value in an unvisited conditional branch must not change behavior.
    return evaluate(new Map());
  }

  if (leaves === undefined) return evaluate(values);
  const typeOption = parseFormulaTypeOption(options.field);
  const format = { numberFormat: typeOption.format, ...options.format };
  const key = JSON.stringify([options.rowId, options.fieldId]);
  const fingerprint = JSON.stringify([
    typeOption.formula,
    format.numberFormat,
    format.dateFormat,
    format.timeFormat,
    leaves,
  ]);

  if ((key.length + fingerprint.length) * 2 > FORMULA_RESULT_CACHE_LIMITS.entryBytes) return evaluate(values);
  if (cache.signature !== signature) {
    cache.entries.clear();
    cache.signature = signature;
    cache.bytes = signature.length * 2;
  }

  const cached = cache.entries.get(key);

  if (cached) {
    cache.entries.delete(key);
    if (cached.fingerprint === fingerprint) {
      cache.entries.set(key, cached);
      return cloneResult(cached.result);
    }

    cache.bytes -= cached.bytes;
  }

  const result = evaluate(values);

  if (result.error !== undefined || result.rawDate || result.missingPropertyRef !== undefined) return result;
  const resultFingerprint = valueFingerprint([result.value]);

  if (resultFingerprint === undefined) return result;
  // Fingerprint characters conservatively account for object/list overhead too.
  const bytes = 256 + (key.length + fingerprint.length + result.text.length) * 2 + resultFingerprint.length * 16;

  if (bytes > FORMULA_RESULT_CACHE_LIMITS.entryBytes) return result;
  while (
    cache.entries.size >= FORMULA_RESULT_CACHE_LIMITS.entries ||
    cache.bytes + bytes > FORMULA_RESULT_CACHE_LIMITS.bytes
  ) {
    const oldest = cache.entries.keys().next().value;

    if (oldest === undefined) return result;
    cache.bytes -= cache.entries.get(oldest)!.bytes;
    cache.entries.delete(oldest);
  }

  cache.entries.set(key, { fingerprint, result: cloneResult(result), bytes });
  cache.bytes += bytes;
  // The compiler also shares inferred list types; isolate the initial caller
  // so mutating its result cannot poison a later evaluation after a cache miss.
  return cloneResult(result);
}
