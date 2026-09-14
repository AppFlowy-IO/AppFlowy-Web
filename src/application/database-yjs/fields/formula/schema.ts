import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YDatabaseFields, YjsDatabaseKey } from '@/application/types';

import { tokenize } from './lexer';

/** The part of a field a formula needs: identity, type and the Yjs handle for cell decoding. */
export interface FormulaFieldSchema {
  id: string;
  name: string;
  type: FieldType;
  field: YDatabaseField;
}

export function readFormulaSchema(fields?: YDatabaseFields): FormulaFieldSchema[] {
  if (!fields) return [];
  const schema: FormulaFieldSchema[] = [];

  fields.forEach((field, id) => {
    schema.push({
      id,
      name: String(field.get(YjsDatabaseKey.name) ?? ''),
      type: Number(field.get(YjsDatabaseKey.type)) as FieldType,
      field,
    });
  });

  return schema;
}

/** Changes whenever a field is added, removed, renamed, retyped or reconfigured. */
export function formulaSchemaSignature(schema: FormulaFieldSchema[]): string {
  return schema
    .map((entry) => `${entry.id}:${entry.type}:${entry.name}:${entry.field.get(YjsDatabaseKey.last_modified) ?? ''}`)
    .join('|');
}

/**
 * Resolves a `prop("ref")` reference. Storage uses ids; the editor and hand
 * typed formulas use names, so both are accepted (ids win over names).
 */
export function resolveFormulaField(schema: FormulaFieldSchema[], ref: string): FormulaFieldSchema | undefined {
  return schema.find((entry) => entry.id === ref) ?? schema.find((entry) => entry.name === ref);
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Rewrites every `prop("...")` argument through `map`, leaving the rest of the
 * source (including other strings and comments) untouched. Returns the source
 * unchanged when it cannot be tokenized so an invalid draft is never lost.
 */
function rewritePropRefs(source: string, map: (ref: string) => string | undefined): string {
  let tokens;

  try {
    tokens = tokenize(source);
  } catch {
    return source;
  }

  let output = '';
  let cursor = 0;

  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const [ident, open, ref, close] = tokens.slice(index, index + 4);

    if (
      ident.kind !== 'ident' ||
      ident.value !== 'prop' ||
      open.kind !== 'punct' ||
      open.value !== '(' ||
      ref.kind !== 'string' ||
      close.kind !== 'punct' ||
      close.value !== ')'
    ) {
      continue;
    }

    const replacement = map(ref.value);

    if (replacement === undefined) continue;
    output += source.slice(cursor, ref.position.offset) + quote(replacement);
    cursor = ref.end;
  }

  return output + source.slice(cursor);
}

/** Editor form → storage form: `prop("Price")` becomes `prop("<id of Price>")`. */
export function toStorageExpression(displaySource: string, schema: FormulaFieldSchema[]): string {
  return rewritePropRefs(displaySource, (ref) => resolveFormulaField(schema, ref)?.id);
}

/** Storage form → editor form: `prop("<id>")` becomes `prop("Price")`. Unknown ids are kept. */
export function toDisplayExpression(storageSource: string, schema: FormulaFieldSchema[]): string {
  return rewritePropRefs(storageSource, (ref) => schema.find((entry) => entry.id === ref)?.name);
}
