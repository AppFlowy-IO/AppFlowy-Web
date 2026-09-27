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

const schemaCache = new WeakMap<
  YDatabaseFields,
  { version: number | undefined; schema: FormulaFieldSchema[]; signature: string }
>();
// Keep the source even for an empty schema, so a retained snapshot can discover
// fields added while its view has no mounted subscribers.
const schemaSources = new WeakMap<FormulaFieldSchema[], YDatabaseFields>();
const signatureCache = new WeakMap<FormulaFieldSchema[], string>();
const indexCache = new WeakMap<
  FormulaFieldSchema[],
  { byId: Map<string, FormulaFieldSchema>; byName: Map<string, FormulaFieldSchema> }
>();

/**
 * Observer versions can lag inside a transaction or while a view is closed.
 * Validate the live fields at the read boundary, then share the signature and
 * lookup maps for the resulting snapshot throughout synchronous evaluation.
 */
function readCurrentFormulaSchema(fields: YDatabaseFields, version?: number): FormulaFieldSchema[] {
  const cached = schemaCache.get(fields);
  const schema: FormulaFieldSchema[] = [];
  const signatureEntries: unknown[] = [];

  fields.forEach((field, id) => {
    const name = String(field.get(YjsDatabaseKey.name) ?? '');
    const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

    schema.push({ id, name, type, field });
    signatureEntries.push([id, type, name, field.get(YjsDatabaseKey.type_option)?.toJSON()]);
  });

  const signature = stringifyFormulaConfig(signatureEntries);

  if (
    cached &&
    (version === undefined || cached.version === version) &&
    cached.signature === signature &&
    cached.schema.length === schema.length &&
    schema.every((entry, index) => entry.field === cached.schema[index].field)
  ) {
    return cached.schema;
  }

  schemaSources.set(schema, fields);
  // Capture type options now: the Yjs handles can mutate before a caller first
  // requests this snapshot's signature.
  signatureCache.set(schema, signature);
  schemaCache.set(fields, { version: version ?? cached?.version, schema, signature });
  return schema;
}

export function readFormulaSchema(fields?: YDatabaseFields): FormulaFieldSchema[] {
  return fields ? readCurrentFormulaSchema(fields) : [];
}

/** Share one validated schema snapshot among callers reading the same version. */
export function readFormulaSchemaForVersion(fields: YDatabaseFields | undefined, version: number): FormulaFieldSchema[] {
  return fields ? readCurrentFormulaSchema(fields, version) : [];
}

/** Only retained snapshots from the schema readers carry a refreshable source. */
export function hasFormulaSchemaSource(schema: FormulaFieldSchema[]): boolean {
  return schemaSources.has(schema);
}

/** Refresh retained schemas before using cached plans or results; leave untracked arrays unchanged. */
export function refreshFormulaSchema(schema: FormulaFieldSchema[]): FormulaFieldSchema[] {
  const fields = schemaSources.get(schema);

  return fields ? readCurrentFormulaSchema(fields) : schema;
}

/** Changes whenever a field is added, removed, renamed, retyped or reconfigured. */
export function formulaSchemaSignature(schema: FormulaFieldSchema[]): string {
  let signature = signatureCache.get(schema);

  if (signature === undefined) {
    // last_modified has second resolution; multiple edits can share it.
    signature = stringifyFormulaConfig(
      schema.map((entry) => [entry.id, entry.type, entry.name, entry.field.get(YjsDatabaseKey.type_option)?.toJSON()])
    );
    signatureCache.set(schema, signature);
  }

  return signature;
}

/** Native Yrs type options can contain BigInts, including integers beyond Number's exact range. */
export function stringifyFormulaConfig(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
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
