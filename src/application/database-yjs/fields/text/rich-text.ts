import dayjs from 'dayjs';

import { isTextWrittenCell } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { Mention, MentionType, YDatabaseCell, YjsDatabaseKey } from '@/application/types';

/**
 * Rich text for database Text cells (format version 1).
 *
 * A Text cell keeps its plain text in `data`, which is what Desktop, the
 * server (search, AI indexing, export) and every web consumer (filter, sort,
 * group, formula, field conversion) read. The formatting lives beside it
 * under `rich_text` as the JSON envelope `{ v, min_v?, text, delta }`:
 * `text` is the `data` the delta was saved with (formatting saved for other
 * text is stale and ignored), `v` is the writer's format version
 * (informational), and `min_v` is the oldest version that may edit the cell.
 * A cell that needs a newer client is shown but never changed here.
 *
 * Web and Desktop share this format. The normative rules (R1-R55) are in
 * doc/DATABASE_RICH_TEXT_CELLS.md, and both clients run the shared cases in
 * __tests__/rich-text-conformance.json.
 */

/** The format version this client reads and writes (R44). */
export const RICH_TEXT_FORMAT_VERSION = 1;

/**
 * Desktop refuses to save formatting whose delta JSON is larger than this
 * (`MAX_RICH_TEXT_DELTA_BYTES` in rich_text.rs, counted in UTF-8 bytes), and
 * with it every later edit of the cell, so the web does not store more.
 */
export const MAX_RICH_TEXT_DELTA_BYTES = 200_000;

/** Desktop refuses to save a Text cell whose `data` is longer than this, in UTF-8 bytes (R48). */
export const MAX_RICH_TEXT_TEXT_BYTES = 10_000;

// Unknown attributes are kept only within these structural limits (R27).
export const RICH_TEXT_UNKNOWN_MAX_DEPTH = 4;
export const RICH_TEXT_UNKNOWN_MAX_KEYS = 32;
export const RICH_TEXT_UNKNOWN_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const RICH_TEXT_FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
/** Editor-internal and transient keys that are never stored (R26). */
export const RICH_TEXT_RESERVED_KEYS: readonly string[] = [
  'atom_key',
  'find_bg_color',
  'auto_complete',
  'transparent',
  'prism_token',
  'class_name',
];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface RichTextInsert {
  insert: string;
  /** Registered attributes (section 6) only: what renderers read. */
  attributes?: Record<string, unknown>;
  /**
   * Attributes this version does not know, kept to be written back
   * unchanged (section 8). Renderers never read them (R13, R30).
   */
  preserved?: Record<string, JsonValue>;
}

export type RichTextDelta = RichTextInsert[];

/** How a cell's formatting reads (section 3). */
export type RichTextState = 'plain' | 'invalid' | 'stale' | 'rich' | 'newer';

export interface RichTextCellRead {
  state: RichTextState;
  /** False when the cell needs a newer client: it is shown but never edited. */
  editable: boolean;
  /** The formatting to show, for `rich` and for `newer` cells whose delta this version can read. */
  delta?: RichTextDelta;
}

/** Resolves a mentioned page's name when writing the plain-text fallback. */
export type RichTextPageNameResolver = (pageId: string) => string | undefined;

const FLAG_MARKS = new Set(['bold', 'italic', 'underline', 'strikethrough', 'code']);
const STRING_MARKS = new Set(['href', 'formula']);
const COLOR_MARKS = new Set(['font_color', 'af_text_color', 'bg_color', 'af_background_color']);
const MENTION_MARK = 'mention';
const FORBIDDEN_KEYS = new Set(RICH_TEXT_FORBIDDEN_KEYS);
const RESERVED_KEYS = new Set(RICH_TEXT_RESERVED_KEYS);

// The shared color grammar (R22): hex, rgb()/rgba(), or a theme token.
const MAX_COLOR_LENGTH = 64;
const COLOR_PATTERNS = [
  /^(#|0x)([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d{1,6}|1\.0{1,6})\s*)?\)$/,
  /^[a-z][a-z0-9_-]{0,63}$/,
];

// Mention fields kept only as strings (section 9.1).
const MENTION_STRING_FIELDS = new Set([
  'page_id',
  'block_id',
  'row_id',
  'date',
  'end',
  'reminder_id',
  'reminder_option',
  'url',
  'person_id',
  'person_name',
  'database_id',
  'database_view_id',
  'database_row_id',
  'row_document_id',
  'label',
]);
const MENTION_DATA_STRING_FIELDS = new Set(['title', 'database_name']);
const MENTION_LABEL = 'label';
const KNOWN_MENTION_TYPES = new Set<string>([
  MentionType.Person,
  MentionType.PageRef,
  MentionType.childPage,
  MentionType.Date,
  MentionType.externalLink,
]);

// Older documents store date mentions as reminders; both clients read them as dates.
const LEGACY_REMINDER_TYPE = 'reminder';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, 'g');

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Sets a key that came from input without ever reaching a prototype setter. */
function defineEntry(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// ---- JSON equality (R33, R49)

/**
 * A key for structural JSON equality: object keys in any order, arrays by
 * position, numbers by value. It is only compared, never stored.
 */
export function jsonEqualityKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonEqualityKey).join(',')}]`;

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${jsonEqualityKey(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'undefined';
}

export function jsonDeepEqual(a: unknown, b: unknown) {
  return jsonEqualityKey(a) === jsonEqualityKey(b);
}

// ---- unknown values (section 8)

function unknownValueOk(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;

  if (typeof value === 'number') {
    // Integers beyond 2^53-1 do not survive JavaScript (R27.3).
    return Number.isFinite(value) && (!Number.isInteger(value) || Math.abs(value) <= Number.MAX_SAFE_INTEGER);
  }

  if (Array.isArray(value)) {
    return depth < RICH_TEXT_UNKNOWN_MAX_DEPTH && value.every((member) => unknownValueOk(member, depth + 1));
  }

  if (isRecord(value)) {
    return (
      depth < RICH_TEXT_UNKNOWN_MAX_DEPTH &&
      Object.keys(value).every((key) => !FORBIDDEN_KEYS.has(key)) &&
      Object.values(value).every((member) => unknownValueOk(member, depth + 1))
    );
  }

  return false;
}

interface UnknownKeyOptions {
  /** Whether the reserved keys of R26 apply (not inside a mention). */
  reserved: boolean;
  /** Whether `false` is a value (inside a mention, R29) or means absent (R18). */
  keepFalse: boolean;
}

function isPreservable(key: string, value: unknown, { reserved, keepFalse }: UnknownKeyOptions) {
  if (!RICH_TEXT_UNKNOWN_KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) return false;
  if (reserved && RESERVED_KEYS.has(key)) return false;
  if (value === null || value === undefined || (value === false && !keepFalse)) return false;
  return unknownValueOk(value, 0);
}

/**
 * The unknown entries kept (R27, R29): valid keys and values only, at most
 * the first 32 in UTF-16 code-unit order of their keys. Values are kept
 * whole or dropped whole, never rewritten.
 */
function keepUnknownEntries(entries: [string, unknown][], options: UnknownKeyOptions): Record<string, JsonValue> {
  const kept: Record<string, JsonValue> = {};

  entries
    .filter(([key, value]) => isPreservable(key, value, options))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, RICH_TEXT_UNKNOWN_MAX_KEYS)
    .forEach(([key, value]) => defineEntry(kept, key, value));

  return kept;
}

// Inside a mention, reserved keys do not apply and `false` is a value (R29).
const MENTION_UNKNOWN: UnknownKeyOptions = { reserved: false, keepFalse: true };

/** Re-checks unknown attributes an editor carried (`_preserved`) against R27. */
export function sanitizePreservedAttributes(value: unknown): Record<string, JsonValue> | undefined {
  if (!isRecord(value)) return undefined;

  const kept = keepUnknownEntries(Object.entries(value), { reserved: true, keepFalse: false });

  return Object.keys(kept).length > 0 ? kept : undefined;
}

// ---- mentions (section 9)

export function isKnownMentionType(type: unknown) {
  return typeof type === 'string' && KNOWN_MENTION_TYPES.has(type);
}

export interface SanitizeMentionOptions {
  /**
   * Keep only registered fields (section 9.1) and no label on known types:
   * what paste and copy carry (R31, R31b), and what an editor holds (labels
   * are recomputed on every save, R37).
   */
  registeredOnly?: boolean;
  /** Drop the label of a known type (it is recomputed on every save, R37). */
  dropKnownLabel?: boolean;
}

/**
 * A mention as the renderers and the plain-text writer read it, or undefined
 * when the value is not one. Like Desktop, a mention stored as JSON text is
 * decoded. Registered fields keep only the type they are read as, and unknown
 * fields (from a newer client) are kept by the unknown-value rules (R29).
 */
export function sanitizeMention(value: unknown, options: SanitizeMentionOptions = {}): Mention | undefined {
  let raw = value;

  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  if (!isRecord(raw) || typeof raw.type !== 'string' || !raw.type) return undefined;

  const type = raw.type === LEGACY_REMINDER_TYPE ? MentionType.Date : raw.type;
  const known = KNOWN_MENTION_TYPES.has(type);
  const dropLabel = known && (options.registeredOnly || options.dropKnownLabel);
  const mention: Record<string, unknown> = { type };
  const unknown: [string, unknown][] = [];

  Object.entries(raw).forEach(([key, field]) => {
    if (key === 'type') return;

    if (MENTION_STRING_FIELDS.has(key)) {
      if (key === MENTION_LABEL && dropLabel) return;

      if (typeof field === 'string') {
        defineEntry(mention, key, field);
      } else if (key === 'person_name' && typeof field === 'number' && Number.isFinite(field)) {
        // Desktop writes such a name as its digits.
        mention.person_name = String(field);
      }

      return;
    }

    if (key === 'include_time') {
      if (typeof field === 'boolean') mention.include_time = field;
      return;
    }

    if (key === 'data') {
      if (!isRecord(field)) return;

      const data: Record<string, unknown> = {};
      const dataUnknown: [string, unknown][] = [];

      Object.entries(field).forEach(([dataKey, member]) => {
        if (MENTION_DATA_STRING_FIELDS.has(dataKey)) {
          if (typeof member === 'string') defineEntry(data, dataKey, member);
        } else {
          dataUnknown.push([dataKey, member]);
        }
      });

      if (!options.registeredOnly) Object.assign(data, keepUnknownEntries(dataUnknown, MENTION_UNKNOWN));
      if (Object.keys(data).length > 0) mention.data = data;
      return;
    }

    unknown.push([key, field]);
  });

  if (!options.registeredOnly) Object.assign(mention, keepUnknownEntries(unknown, MENTION_UNKNOWN));

  return mention as unknown as Mention;
}


// ---- attributes (sections 6-8)

function isColor(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_COLOR_LENGTH && COLOR_PATTERNS.some((pattern) => pattern.test(value))
  );
}

export interface PartitionedAttributes {
  /** Registered keys, each in the shape renderers read. */
  known: Record<string, unknown>;
  /** Unknown keys kept by the unknown-value rules. */
  preserved: Record<string, JsonValue>;
}

/**
 * Splits stored attributes into the registered keys a renderer reads (marks
 * only as `true`; links and equations only as non-empty strings; colors only
 * by the color grammar; mentions only as objects) and the unknown keys this
 * version keeps and writes back unchanged (R27). A registered key whose value
 * breaks its rule is dropped, never preserved (R23), and reserved keys are
 * never kept (R26). Nothing a value of an unexpected type or depth can break
 * reaches a renderer.
 */
export function partitionRichTextAttributes(
  attributes: unknown,
  mentionOptions: SanitizeMentionOptions = {}
): PartitionedAttributes {
  const known: Record<string, unknown> = {};
  const unknown: [string, unknown][] = [];

  if (!isRecord(attributes)) return { known, preserved: {} };

  Object.entries(attributes).forEach(([key, value]) => {
    if (FLAG_MARKS.has(key)) {
      if (value === true) defineEntry(known, key, true);
    } else if (STRING_MARKS.has(key)) {
      if (typeof value === 'string' && value) defineEntry(known, key, value);
    } else if (COLOR_MARKS.has(key)) {
      if (isColor(value)) defineEntry(known, key, value);
    } else if (key === MENTION_MARK) {
      const mention = sanitizeMention(value, mentionOptions);

      if (mention) known.mention = mention;
    } else {
      unknown.push([key, value]);
    }
  });

  return { known, preserved: keepUnknownEntries(unknown, { reserved: true, keepFalse: false }) };
}

/**
 * The registered attributes only, mentions with their registered fields
 * only: what paste and copy carry (R31, R31b). Unknown attributes, and the
 * editor's packed `_preserved`, are never taken from or put on the clipboard.
 */
export function sanitizeRichTextAttributes(attributes: unknown): Record<string, unknown> {
  return partitionRichTextAttributes(attributes, { registeredOnly: true }).known;
}

function toInsert(insert: string, known: Record<string, unknown>, preserved?: Record<string, JsonValue>) {
  const op: RichTextInsert = { insert };

  if (Object.keys(known).length > 0) op.attributes = known;
  if (preserved && Object.keys(preserved).length > 0) op.preserved = preserved;
  return op;
}

/** One insert's attributes, registered and preserved, as stored. */
function flatAttributes({ attributes, preserved }: RichTextInsert): Record<string, unknown> {
  return preserved ? { ...attributes, ...preserved } : { ...attributes };
}

/**
 * Sanitizes a stored, flat or pasted delta (sections 6-9): one output insert
 * per input insert, unknown attributes in `preserved`. This is the
 * conformance `sanitize` contract (with `unpackRichTextDelta`).
 */
export function packRichTextDelta(delta: RichTextDelta): RichTextDelta {
  return delta.map((op) => {
    const { known, preserved } = partitionRichTextAttributes(flatAttributes(op));

    return toInsert(op.insert, known, preserved);
  });
}

/** Merges preserved attributes back into `attributes`: the stored shape. */
export function unpackRichTextDelta(delta: RichTextDelta): RichTextDelta {
  return delta.map((op) => {
    const attributes = flatAttributes(op);

    return Object.keys(attributes).length > 0 ? { insert: op.insert, attributes } : { insert: op.insert };
  });
}

/** Sanitizes a stored, flat or pasted delta into the stored shape (R34 `sanitizeStoredDelta`). */
export function sanitizeStoredDelta(delta: RichTextDelta): RichTextDelta {
  return unpackRichTextDelta(packRichTextDelta(delta));
}

/**
 * Normalizes an editor's own delta (registered attributes plus `preserved`):
 * registered keys are sanitized; with `keepUnknown` the preserved attributes
 * are re-checked and kept, without it (paste, copy) they are dropped (R34).
 */
export function normalizeEditorDelta(delta: RichTextDelta, { keepUnknown }: { keepUnknown: boolean }): RichTextDelta {
  return delta.map(({ insert, attributes, preserved }) => {
    const { known } = partitionRichTextAttributes(attributes, keepUnknown ? {} : { registeredOnly: true });

    return toInsert(insert, known, keepUnknown ? sanitizePreservedAttributes(preserved) : undefined);
  });
}

function hasAttributes(insert: RichTextInsert) {
  const formatted = (values?: Record<string, unknown>) =>
    !!values && Object.values(values).some((value) => value !== undefined && value !== null && value !== false);

  return formatted(insert.attributes) || formatted(insert.preserved);
}

/** A delta whose inserts carry no formatting, known or preserved, says nothing `data` does not (R32). */
export function isPlainRichText(delta: RichTextDelta) {
  return !delta.some(hasAttributes);
}

// ---- reading (sections 2-3)

/**
 * JSON.parse that fails where serde_json fails (R7): on numbers outside the
 * finite double range and on unpaired surrogates in strings or keys.
 */
function parseEnvelopeJson(raw: string): unknown {
  return JSON.parse(raw, (key, value: unknown) => {
    if (LONE_SURROGATE.test(key)) throw new Error('lone surrogate in key');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('number out of range');
    if (typeof value === 'string' && LONE_SURROGATE.test(value)) throw new Error('lone surrogate');
    return value;
  });
}

/** Whether `min_v` lets this version edit the cell (R9-R11). A malformed value never does. */
function isMinVersionSatisfied(minVersion: unknown) {
  if (minVersion === undefined || minVersion === null) return true;

  return (
    typeof minVersion === 'number' &&
    Number.isInteger(minVersion) &&
    minVersion >= 1 &&
    minVersion <= RICH_TEXT_FORMAT_VERSION
  );
}

function isV1Insert(value: unknown) {
  if (!isRecord(value)) return false;
  const { insert, attributes } = value;

  // Same rules as Desktop (rich_text.rs): null attributes mean none; any
  // other non-object (including an array) makes the delta invalid.
  return typeof insert === 'string' && (attributes === undefined || attributes === null || isRecord(attributes));
}

/** What a stored string reads as, independent of the cell's `data`. */
type ParsedEnvelope =
  | { valid: false }
  | {
      valid: true;
      text: string;
      minVersionOk: boolean;
      /** The sanitized delta, when it has the version 1 structure. */
      delta: RichTextDelta | null;
      formatted: boolean;
    };

function parseEnvelope(raw: string): ParsedEnvelope {
  let envelope: unknown;

  try {
    envelope = parseEnvelopeJson(raw);
  } catch {
    return { valid: false };
  }

  if (!isRecord(envelope) || typeof envelope.text !== 'string') return { valid: false };

  const rawDelta = envelope.delta;
  const delta =
    Array.isArray(rawDelta) && rawDelta.every(isV1Insert) ? packRichTextDelta(rawDelta as RichTextDelta) : null;

  return {
    valid: true,
    text: envelope.text,
    minVersionOk: isMinVersionSatisfied(envelope.min_v),
    delta,
    formatted: delta !== null && !isPlainRichText(delta),
  };
}

// What stored values read as, by their JSON, most recently read last. A cell
// is read on every render and every change of its row or field, and a view
// shows many cells: a value is parsed once, and reading it again returns the
// same delta, so renderers memoized on the delta skip cells that did not
// change. The size is bounded by the JSON kept, not by the number of cells.
const STORED_CACHE_MAX_CHARS = 4_000_000;
const storedCache = new Map<string, ParsedEnvelope>();
let storedCacheChars = 0;

function readEnvelope(raw: string): ParsedEnvelope {
  const cached = storedCache.get(raw);

  if (cached !== undefined) {
    storedCache.delete(raw);
    storedCache.set(raw, cached);
    return cached;
  }

  const parsed = parseEnvelope(raw);

  if (raw.length > STORED_CACHE_MAX_CHARS) return parsed;

  storedCache.set(raw, parsed);
  storedCacheChars += raw.length;

  for (const oldest of storedCache.keys()) {
    if (storedCacheChars <= STORED_CACHE_MAX_CHARS) break;
    storedCache.delete(oldest);
    storedCacheChars -= oldest.length;
  }

  return parsed;
}

/**
 * The state of a stored `rich_text` for `data` (section 2.2, steps 2-9),
 * ignoring field types. Staleness is decided before versions are compared.
 */
export function readRichTextValue(raw: unknown, data: unknown): { state: RichTextState; delta?: RichTextDelta } {
  if (raw === undefined || raw === null || raw === '') return { state: 'plain' };
  // Only a future representation stores something else (R6).
  if (typeof raw !== 'string') return { state: 'newer' };

  const envelope = readEnvelope(raw);

  if (!envelope.valid) return { state: 'invalid' };
  if (envelope.text !== data) return { state: 'stale' };
  if (!envelope.minVersionOk) return envelope.delta ? { state: 'newer', delta: envelope.delta } : { state: 'newer' };
  if (!envelope.delta) return { state: 'invalid' };
  return envelope.formatted ? { state: 'rich', delta: envelope.delta } : { state: 'plain' };
}

type CellReader = Pick<YDatabaseCell, 'get'>;

/**
 * Reads a cell's formatting under a field of `fieldType` (section 2.2). Only
 * a Text-written cell's `rich_text` describes its text; under another field
 * type it is displayed plain but still decides whether the cell may be
 * edited (R52).
 *
 * Reads of the same stored value share one delta: treat it as read-only.
 */
export function readRichTextCell(cell: CellReader, fieldType: FieldType): RichTextCellRead {
  if (!isTextWrittenCell(cell)) return { state: 'plain', editable: true };

  const { state, delta } = readRichTextValue(cell.get(YjsDatabaseKey.rich_text), cell.get(YjsDatabaseKey.data));
  const editable = state !== 'newer';

  if (fieldType !== FieldType.RichText) return { state: 'plain', editable };
  return delta ? { state, editable, delta } : { state, editable };
}

/** A Text-written cell this version must never change (section 0). */
export function isNewerRichTextCell(cell: CellReader | undefined | null): boolean {
  return Boolean(cell) && !readRichTextCell(cell as CellReader, FieldType.RichText).editable;
}

/**
 * Reads a stored `rich_text` value. Returns the delta only while it still
 * describes `data` and this version may edit it; anything else (missing,
 * malformed, saved for text that has since changed, or needing a newer
 * client) reads as plain text.
 *
 * Reads of the same stored value share one delta: treat it as read-only.
 */
export function parseRichTextCellValue(raw: unknown, data: unknown): RichTextDelta | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (typeof data !== 'string') return undefined;

  const { state, delta } = readRichTextValue(raw, data);

  return state === 'rich' ? delta : undefined;
}

export function readRichTextFromCell(cell: YDatabaseCell): RichTextDelta | undefined {
  const { state, delta } = readRichTextCell(cell, FieldType.RichText);

  return state === 'rich' ? delta : undefined;
}

// ---- writing (sections 5, 11, 12)

export function utf8Length(text: string) {
  let bytes = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;

    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }

  return bytes;
}

/**
 * Whether a delta's formatting is too large for Desktop to save edits of the
 * cell. A caller that already has the delta's JSON passes it.
 */
export function isRichTextTooLarge(delta: RichTextDelta, json = JSON.stringify(unpackRichTextDelta(delta))) {
  // No UTF-16 unit takes more than 3 UTF-8 bytes.
  if (json.length * 3 <= MAX_RICH_TEXT_DELTA_BYTES) return false;

  return utf8Length(json) > MAX_RICH_TEXT_DELTA_BYTES;
}

/** Whether a cell's plain text is too long for Desktop to save any edit of the cell (R48). */
export function isRichTextTextTooLong(text: string) {
  if (text.length <= MAX_RICH_TEXT_TEXT_BYTES / 3) return false;

  return utf8Length(text) > MAX_RICH_TEXT_TEXT_BYTES;
}

/** Replaces unpaired surrogates with U+FFFD: every reader rejects them in stored JSON (R21). */
export function toWellFormedText(text: string) {
  return LONE_SURROGATE.test(text) ? text.replace(LONE_SURROGATES, '�') : text;
}

function toWellFormedValue(value: unknown): unknown {
  if (typeof value === 'string') return toWellFormedText(value);
  if (Array.isArray(value)) return value.map(toWellFormedValue);

  if (isRecord(value)) {
    const clean: Record<string, unknown> = {};

    Object.entries(value).forEach(([key, member]) => defineEntry(clean, toWellFormedText(key), toWellFormedValue(member)));
    return clean;
  }

  return value;
}

/**
 * The delta with every string well formed: inserts, attribute values at any
 * depth, object keys, mention fields and labels (R21).
 */
export function toWellFormedDeep(delta: RichTextDelta): RichTextDelta {
  return delta.map(({ insert, attributes, preserved }) => {
    const op: RichTextInsert = { insert: toWellFormedText(insert) };

    if (attributes) op.attributes = toWellFormedValue(attributes) as Record<string, unknown>;
    if (preserved) op.preserved = toWellFormedValue(preserved) as Record<string, JsonValue>;
    return op;
  });
}

/**
 * The stored `rich_text` for `text` and a sanitized, labelled delta: a
 * version 1 envelope with the preserved attributes written back (R44). It
 * never writes `min_v` (R46).
 */
export function serializeRichTextCellValue(text: string, delta: RichTextDelta): string {
  return JSON.stringify({ v: RICH_TEXT_FORMAT_VERSION, text, delta: unpackRichTextDelta(delta) });
}

/** What to store for a delta: its envelope, or `''` (no envelope) when it formats nothing (R45). */
export function encodeRichTextCellValue(text: string, delta: RichTextDelta): string {
  return isPlainRichText(delta) ? '' : serializeRichTextCellValue(text, delta);
}

/** A comparable key for a delta's content, independent of key order. */
export function richTextDeltaKey(delta: RichTextDelta) {
  return jsonEqualityKey(unpackRichTextDelta(delta));
}

export function plainTextToRichText(text: string): RichTextDelta {
  return text ? [{ insert: text }] : [];
}

// ---- plain text and labels (sections 9-10)

function formatMentionDate(mention: Mention) {
  if (typeof mention.date !== 'string') return '';

  const date = dayjs(mention.date);

  if (!date.isValid()) return mention.date;

  return date.format(mention.include_time ? 'MMM D, YYYY h:mm A' : 'MMM D, YYYY');
}

/**
 * A mention of a database row. It carries its database's view as `page_id`
 * and the row's title in `data.title`, which is what its chip shows (as in
 * the document's `MentionLeaf` and Desktop's row mentions).
 */
export function isRowMention(mention: Mention) {
  return mention.type === MentionType.PageRef && Boolean(mention.row_id || mention.database_row_id);
}

function mentionPlainText(mention: Mention, resolvePageName?: RichTextPageNameResolver) {
  switch (mention.type) {
    case MentionType.Person:
      return `@${mention.person_name?.trim() || mention.person_id || ''}`;
    case MentionType.Date:
      return `@${formatMentionDate(mention)}`;
    case MentionType.externalLink:
      return mention.url ?? '';
    case MentionType.PageRef:
    case MentionType.childPage: {
      const title = mention.data?.title;
      const storedTitle = typeof title === 'string' ? title : '';

      // The page a row mention names is its database's view, not the row.
      if (isRowMention(mention)) return storedTitle;

      // The page's current name wins over the title stored when the mention
      // was inserted, which goes stale after a rename.
      const resolved = mention.page_id ? resolvePageName?.(mention.page_id) : undefined;

      return resolved || storedTitle;
    }

    // A type from a newer client reads as the label its writer stored (R39).
    default:
      return typeof mention.label === 'string' ? mention.label : '';
  }
}

/**
 * The plain text a delta is stored as in `data`: mentions and equations are
 * written the way they read, so Desktop, search and filters see words rather
 * than the `@`/`$` placeholder characters the editor keeps them on. Reads any
 * delta the way Desktop does (see the shared conformance cases in
 * __tests__), including mentions stored as JSON text and values of
 * unexpected types.
 */
export function richTextToPlainText(delta: RichTextDelta, resolvePageName?: RichTextPageNameResolver) {
  return delta
    .map(({ insert, attributes: rawAttributes }) => {
      if (typeof insert !== 'string') return '';

      const attributes = isRecord(rawAttributes) ? rawAttributes : undefined;
      const mention = attributes ? sanitizeMention(attributes.mention) : undefined;

      if (mention) return mentionPlainText(mention, resolvePageName);

      const formula = attributes?.formula;

      if (typeof formula === 'string') return formula;

      return insert;
    })
    .join('');
}

/**
 * The delta with every mention of a known type labelled with the text
 * `richTextToPlainText` writes for it (R37). Mentions of unknown types keep
 * their label as written, and get none if they had none (R38).
 */
export function withMentionLabels(delta: RichTextDelta, resolvePageName?: RichTextPageNameResolver): RichTextDelta {
  return delta.map((op) => {
    const mention = isRecord(op.attributes) ? sanitizeMention(op.attributes.mention) : undefined;

    if (!mention) return op;

    const labelled = isKnownMentionType(mention.type)
      ? { ...mention, label: mentionPlainText(mention, resolvePageName) }
      : mention;

    return { ...op, attributes: { ...op.attributes, mention: labelled } };
  });
}

/**
 * Page ids whose current names a delta's plain text uses, so they can be
 * loaded before saving. Row mentions are left out: their text is the row's
 * stored title, not their database view's name.
 */
export function getMentionedPageIds(delta: RichTextDelta) {
  const ids = new Set<string>();

  delta.forEach(({ attributes }) => {
    const mention = isRecord(attributes) ? sanitizeMention(attributes.mention) : undefined;

    if (
      mention?.page_id &&
      (mention.type === MentionType.PageRef || mention.type === MentionType.childPage) &&
      !isRowMention(mention)
    ) {
      ids.add(mention.page_id);
    }
  });

  return [...ids];
}

/**
 * Whether a page mention of `pageId` in the delta carries a stored title to
 * fall back on while the page's current name is unknown. A row mention's
 * title is the row's, so it says nothing about the page.
 */
export function hasStoredPageTitle(delta: RichTextDelta, pageId: string) {
  return delta.some(({ attributes }) => {
    const mention = isRecord(attributes) ? sanitizeMention(attributes.mention) : undefined;
    const title = mention?.data?.title;

    return mention?.page_id === pageId && !isRowMention(mention) && typeof title === 'string' && title !== '';
  });
}
