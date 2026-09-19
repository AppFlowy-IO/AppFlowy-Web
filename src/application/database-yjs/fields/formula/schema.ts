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

const schemaCache = new WeakMap<YDatabaseFields, { version: number; schema: FormulaFieldSchema[] }>();

/**
 * `readFormulaSchema` shared by every caller that reads the same fields
 * version (e.g. all formula cells of a grid render), so the schema is built
 * once per fields change instead of once per cell.
 */
export function readFormulaSchemaForVersion(fields: YDatabaseFields | undefined, version: number): FormulaFieldSchema[] {
  if (!fields) return [];
  const cached = schemaCache.get(fields);

  if (cached && cached.version === version) return cached.schema;
  const schema = readFormulaSchema(fields);

  schemaCache.set(fields, { version, schema });
  return schema;
}

/*
 * A schema array is a snapshot: callers re-read it after fields change. The
 * derived signature and lookup maps are cached per array so evaluating a
 * formula for every row of a filter or sort pass does not rebuild them.
 */
const signatureCache = new WeakMap<FormulaFieldSchema[], string>();
const indexCache = new WeakMap<
  FormulaFieldSchema[],
  { byId: Map<string, FormulaFieldSchema>; byName: Map<string, FormulaFieldSchema> }
>();

/** Changes whenever a field is added, removed, renamed, retyped or reconfigured. */
export function formulaSchemaSignature(schema: FormulaFieldSchema[]): string {
  let signature = signatureCache.get(schema);

  if (signature === undefined) {
    // last_modified has second resolution; multiple edits can share it.
    signature = JSON.stringify(
      schema.map((entry) => [entry.id, entry.type, entry.name, entry.field.get(YjsDatabaseKey.type_option)?.toJSON()])
    );
    signatureCache.set(schema, signature);
  }

  return signature;
}

function schemaIndex(schema: FormulaFieldSchema[]) {
  let index = indexCache.get(schema);

  if (!index) {
    const byId = new Map<string, FormulaFieldSchema>();
    const byName = new Map<string, FormulaFieldSchema>();

    schema.forEach((entry) => {
      byId.set(entry.id, entry);
      // The first field with a name wins, matching a front-to-back search.
      if (!byName.has(entry.name)) byName.set(entry.name, entry);
    });
    index = { byId, byName };
    indexCache.set(schema, index);
  }

  return index;
}

/**
 * Resolves a `prop("ref")` reference. Storage uses ids; the editor and hand
 * typed formulas use names, so both are accepted (ids win over names).
 */
export function resolveFormulaField(schema: FormulaFieldSchema[], ref: string): FormulaFieldSchema | undefined {
  const { byId, byName } = schemaIndex(schema);

  return byId.get(ref) ?? byName.get(ref);
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Rewrites every `prop("...")` argument through `map`, leaving the rest of the
 * source (including other strings and comments) untouched. Completed references
 * remain bound even while another part of the draft is incomplete.
 */
function rewritePropRefs(source: string, map: (ref: string) => string | undefined): string {
  const tokens = tokenize(source, true);

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

/** Use names only when resolving them again preserves the referenced field. */
export function toDisplayExpression(storageSource: string, schema: FormulaFieldSchema[]): string {
  return rewritePropRefs(storageSource, (ref) => {
    const entry = schemaIndex(schema).byId.get(ref);

    return entry && resolveFormulaField(schema, entry.name)?.id === entry.id ? entry.name : undefined;
  });
}

/** Insert the selected property, using its name only when it resolves back to that ID. */
export function formulaPropertyReference(fieldId: string, schema: FormulaFieldSchema[]): string {
  return toDisplayExpression(`prop(${quote(fieldId)})`, schema);
}
