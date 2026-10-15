import * as Y from 'yjs';
import { v5 as uuidv5 } from 'uuid';

import { CollabOrigin } from '@/application/types';

type Value =
  | { kind: 'missing' }
  | { kind: 'value'; value: unknown }
  | { kind: 'map'; entries: Record<string, Value> }
  | { kind: 'array'; values: Value[] }
  | { kind: 'text'; delta: Array<{ insert: string; attributes?: Record<string, unknown> }> };
interface Change {
  path: string[];
  before: Value;
  after: Value;
}
interface StagedBody {
  version: 1;
  documentId: string;
  changes: Change[];
}
const missing: Value = { kind: 'missing' };

function orderedJson(value: unknown): string {
  const ordered = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
    return item;
  };

  return JSON.stringify(ordered(value));
}

function snapshot(value: unknown): Value {
  if (value === undefined) return missing;
  if (value instanceof Y.Map) {
    return {
      kind: 'map',
      entries: Object.fromEntries(
        Array.from(value.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, snapshot(item)])
      ),
    };
  }

  if (value instanceof Y.Array) return { kind: 'array', values: value.toArray().map(snapshot) };
  if (value instanceof Y.Text) return { kind: 'text', delta: value.toDelta() };
  return { kind: 'value', value };
}

function equal(a: Value, b: Value): boolean {
  return orderedJson(a) === orderedJson(b);
}

function changes(before: Value, after: Value, path: string[] = []): Change[] {
  if (equal(before, after)) return [];
  if (before.kind === 'map' && after.kind === 'map') {
    return Array.from(new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])).flatMap((key) =>
      changes(before.entries[key] ?? missing, after.entries[key] ?? missing, [...path, key])
    );
  }

  return [{ path, before, after }];
}

function restore(value: Value): unknown {
  switch (value.kind) {
    case 'missing':
      return undefined;
    case 'value':
      return value.value;
    case 'map':
      return new Y.Map(Object.entries(value.entries).map(([key, child]) => [key, restore(child)]));
    case 'array': {
      const array = new Y.Array();

      array.insert(0, value.values.map(restore));
      return array;
    }

    case 'text': {
      const text = new Y.Text();

      text.applyDelta(value.delta);
      return text;
    }
  }
}

function patchText(text: Y.Text, before: Extract<Value, { kind: 'text' }>, after: Extract<Value, { kind: 'text' }>) {
  const characters = (value: typeof before) =>
    value.delta.flatMap(({ insert, attributes }) =>
      insert.split('').map((character) => ({ insert: character, attributes }))
    );
  const original = characters(before);
  const changed = characters(after);
  const same = (a: (typeof original)[number], b: (typeof original)[number]) => orderedJson(a) === orderedJson(b);
  let prefix = 0;
  let suffix = 0;

  while (prefix < original.length && prefix < changed.length && same(original[prefix], changed[prefix])) prefix += 1;
  while (
    suffix < original.length - prefix &&
    suffix < changed.length - prefix &&
    same(original[original.length - suffix - 1], changed[changed.length - suffix - 1])
  )
    suffix += 1;
  const inserted = changed.slice(prefix, changed.length - suffix);
  const delta: Array<
    { retain: number } | { delete: number } | { insert: string; attributes?: Record<string, unknown> }
  > = [];

  if (prefix) delta.push({ retain: prefix });
  if (original.length - prefix - suffix) delta.push({ delete: original.length - prefix - suffix });
  for (const item of inserted) {
    const previous = delta[delta.length - 1];

    if (previous && 'insert' in previous && JSON.stringify(previous.attributes) === JSON.stringify(item.attributes))
      previous.insert += item.insert;
    else delta.push({ ...item });
  }

  text.applyDelta(delta);
}

function applyChange(root: Y.Map<unknown>, change: Change): void {
  let parent: unknown = root;

  for (const key of change.path.slice(0, -1)) {
    if (!(parent instanceof Y.Map)) throw new Error('The row-page block identity changed during creation.');
    parent = parent.get(key);
  }

  if (!(parent instanceof Y.Map) || !change.path.length) throw new Error('The staged row-page path is invalid.');
  const key = change.path[change.path.length - 1];
  const current = parent.get(key);
  const currentValue = snapshot(current);

  // A cache checkpoint may have survived an interrupted journal cleanup.
  if (equal(currentValue, change.after)) return;
  if (!equal(currentValue, change.before))
    throw new Error('The row-page changed on another device. Your pending edits are retained.');
  if (current instanceof Y.Text && change.before.kind === 'text' && change.after.kind === 'text') {
    // Keep the canonical CRDT identity. Only this explicitly matched text is
    // changed; unrelated blocks and their concurrent edits are untouched.
    patchText(current, change.before, change.after);
  } else if (current instanceof Y.Array && change.before.kind === 'array' && change.after.kind === 'array') {
    let prefix = 0;
    let suffix = 0;

    while (
      prefix < change.before.values.length &&
      prefix < change.after.values.length &&
      equal(change.before.values[prefix], change.after.values[prefix])
    )
      prefix += 1;
    while (
      suffix < change.before.values.length - prefix &&
      suffix < change.after.values.length - prefix &&
      equal(
        change.before.values[change.before.values.length - suffix - 1],
        change.after.values[change.after.values.length - suffix - 1]
      )
    )
      suffix += 1;
    current.delete(prefix, change.before.values.length - prefix - suffix);
    current.insert(prefix, change.after.values.slice(prefix, change.after.values.length - suffix).map(restore));
  } else if (change.after.kind === 'missing') parent.delete(key);
  else parent.set(key, restore(change.after));
}

function remapNewIdentities(doc: Y.Doc, edits: Change[]): Change[] {
  const remapped = new Map<string, string>();
  const identityFields = new Set(['id', 'parent', 'children', 'external_id', 'block_id', 'text_id']);

  for (const edit of edits) {
    if (edit.before.kind !== 'missing' ||
      !((edit.path.length === 3 && edit.path[1] === 'blocks') ||
        (edit.path.length === 4 && edit.path[1] === 'meta' && ['children_map', 'text_map'].includes(edit.path[2])))) continue;
    let parent: unknown = doc.getMap('data');

    for (const part of edit.path.slice(0, -1)) parent = parent instanceof Y.Map ? parent.get(part) : undefined;
    const key = edit.path[edit.path.length - 1];

    if (parent instanceof Y.Map && parent.has(key) && !equal(snapshot(parent.get(key)), edit.after)) {
      // A deterministic remap is repeatable after an interrupted cache write;
      // a second collision still fails preflight rather than overwriting it.
      remapped.set(key, uuidv5(`row-page-staged:${key}`, doc.guid));
    }
  }

  if (!remapped.size) return edits;
  const metadata = (value: unknown, field?: string): unknown => {
    if (typeof value === 'string') return field && identityFields.has(field) ? remapped.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map((item) => metadata(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, metadata(child, key)]));
    return value;
  };

  const rewrite = (value: Value, field?: string): Value => {
    if (value.kind === 'map') return { kind: 'map', entries: Object.fromEntries(Object.entries(value.entries).map(([key, child]) => [remapped.get(key) ?? key, rewrite(child, key)])) };
    if (value.kind === 'array') return { kind: 'array', values: value.values.map((child) => rewrite(child, 'id')) };
    if (value.kind === 'text') return { kind: 'text', delta: value.delta.map((item) => ({ ...item, ...(item.attributes ? { attributes: metadata(item.attributes) as Record<string, unknown> } : {}) })) };
    if (value.kind === 'value') {
      if (field === 'data' && typeof value.value === 'string') return { kind: 'value', value: JSON.stringify(metadata(JSON.parse(value.value))) };
      return { kind: 'value', value: metadata(value.value, field) };
    }

    return value;
  };

  return edits.map((edit) => ({ ...edit, path: edit.path.map((part) => remapped.get(part) ?? part), after: rewrite(edit.after, edit.path[edit.path.length - 1]) }));
}

/** Logical edits after sealing, never a detached CRDT update or a replacement server body. */
export class FirstBodyStaging {
  private readonly baseline: Value;
  private currentJson: string;
  private stopped = false;

  constructor(private readonly doc: Y.Doc, private readonly persist: (json: string) => void) {
    this.baseline = snapshot(doc.getMap('data'));
    this.currentJson = this.serialize();
    doc.on('update', this.capture);
  }

  private serialize() {
    return JSON.stringify({
      version: 1,
      documentId: this.doc.guid,
      changes: changes(this.baseline, snapshot(this.doc.getMap('data'))),
    } satisfies StagedBody);
  }

  capture = () => {
    if (this.stopped) return;
    this.currentJson = this.serialize();
    this.persist(this.currentJson);
  };

  get json() {
    return this.currentJson;
  }

  stop() {
    if (this.stopped) return;
    this.capture();
    this.stopped = true;
    this.doc.off('update', this.capture);
  }
}

export function applyFirstBodyStaging(doc: Y.Doc, json: string): void {
  const value = JSON.parse(json) as StagedBody;

  if (
    value.version !== 1 ||
    value.documentId !== doc.guid ||
    !Array.isArray(value.changes) ||
    value.changes.length > 8192 ||
    new TextEncoder().encode(json).length > 8 * 1024 * 1024
  )
    throw new Error('The pending row-page edits are invalid.');
  if (
    value.changes.some(
      (change) =>
        !Array.isArray(change.path) ||
        change.path.some((part) => typeof part !== 'string') ||
        change.path[0] !== 'document' ||
        change.path.length < 3 ||
        change.path.some((part) => part === '__proto__' || part === 'constructor' || part === 'prototype')
    )
  )
    throw new Error('The pending row-page edit identity is invalid.');
  const probe = new Y.Doc({ guid: doc.guid });
  const edits = remapNewIdentities(doc, value.changes);

  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
    probe.transact(() => edits.forEach((change) => applyChange(probe.getMap('data'), change)));
    // Every affected identity and previous value must match before any live
    // mutation. Concurrent unrelated content remains in the canonical doc.
    doc.transact(() => edits.forEach((change) => applyChange(doc.getMap('data'), change)), CollabOrigin.Local);
  } finally {
    probe.destroy();
  }
}
