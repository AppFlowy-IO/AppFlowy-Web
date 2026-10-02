import dayjs from 'dayjs';

import { Mention, MentionType, YDatabaseCell, YjsDatabaseKey } from '@/application/types';

/**
 * Rich text for database Text cells.
 *
 * A Text cell keeps its plain text in `data`, which is what Desktop, the
 * server (search, AI indexing, export) and every web consumer (filter, sort,
 * group, formula, field conversion) read. The formatting lives beside it
 * under `rich_text` as JSON `{ text, delta }`, where `text` is the `data` the
 * delta was saved with. A client that rewrites only `data` (Desktop keeps
 * unknown cell keys but never updates them) leaves `text` behind, so the
 * delta is ignored until the web saves formatting again.
 */

export interface RichTextInsert {
  insert: string;
  attributes?: Record<string, unknown>;
}

export type RichTextDelta = RichTextInsert[];

interface StoredRichText {
  text: string;
  delta: RichTextDelta;
}

/** Resolves a mentioned page's name when writing the plain-text fallback. */
export type RichTextPageNameResolver = (pageId: string) => string | undefined;

// The attributes a Text cell keeps (the document's inline marks, as on
// Desktop); anything else a paste or another client brings in is dropped.
const FLAG_MARKS = new Set(['bold', 'italic', 'underline', 'strikethrough', 'code']);
const STRING_MARKS = new Set(['href', 'formula', 'font_color', 'af_text_color', 'bg_color', 'af_background_color']);
const MENTION_MARK = 'mention';

// A link, equation or color longer than a whole cell's text is no real value.
const MAX_MARK_VALUE_LENGTH = 10000;

// Mention fields the leaf renderers read as strings.
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
]);

// Older documents store date mentions as reminders; both clients read them as dates.
const LEGACY_REMINDER_TYPE = 'reminder';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
  );
}

/** Keeps a mention's `data` (the stored title and similar display data) flat. */
function sanitizeMentionData(value: unknown) {
  if (!isRecord(value)) return undefined;

  const data: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, field]) => {
    if (isPrimitive(field)) data[key] = field;
  });

  return Object.keys(data).length > 0 ? data : undefined;
}

/**
 * A mention as the renderers and the plain-text writer read it, or undefined
 * when the value is not one. Like Desktop, a mention stored as JSON text is
 * decoded. The fields the renderers read keep only the type they expect, and
 * unknown fields (from a newer client) survive only as plain values, so no
 * value of an unexpected type or depth reaches them.
 */
export function sanitizeMention(value: unknown): Mention | undefined {
  let raw = value;

  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  if (!isRecord(raw) || typeof raw.type !== 'string' || !raw.type) return undefined;

  const mention: Record<string, unknown> = {
    type: raw.type === LEGACY_REMINDER_TYPE ? MentionType.Date : raw.type,
  };

  Object.entries(raw).forEach(([key, field]) => {
    if (key === 'type') return;

    if (key === 'include_time') {
      if (typeof field === 'boolean') mention.include_time = field;
      return;
    }

    if (key === 'data') {
      const data = sanitizeMentionData(field);

      if (data) mention.data = data;
      return;
    }

    if (MENTION_STRING_FIELDS.has(key)) {
      if (typeof field === 'string') {
        mention[key] = field;
      } else if (key === 'person_name' && typeof field === 'number' && Number.isFinite(field)) {
        // Desktop writes such a name as its digits.
        mention[key] = String(field);
      }

      return;
    }

    if (isPrimitive(field)) mention[key] = field;
  });

  return mention as unknown as Mention;
}

/**
 * The attributes a Text cell keeps, each in the shape the editor and the leaf
 * renderers read (as Desktop's `_keptAttribute` does): marks only as `true`,
 * links, equations and colors only as non-empty strings, and mentions only as
 * objects ({@link sanitizeMention}). Anything else is dropped, so a value
 * stored by another client or brought in by a paste can never break the
 * rendering of a cell (and with it the whole database view).
 */
export function sanitizeRichTextAttributes(attributes: unknown): Record<string, unknown> {
  const kept: Record<string, unknown> = {};

  if (!isRecord(attributes)) return kept;

  Object.entries(attributes).forEach(([key, value]) => {
    if (FLAG_MARKS.has(key)) {
      if (value === true) kept[key] = true;
      return;
    }

    if (STRING_MARKS.has(key)) {
      if (typeof value === 'string' && value && value.length <= MAX_MARK_VALUE_LENGTH) kept[key] = value;
      return;
    }

    if (key === MENTION_MARK) {
      const mention = sanitizeMention(value);

      if (mention) kept[key] = mention;
    }
  });

  return kept;
}

function isInsert(value: unknown): value is RichTextInsert {
  if (!value || typeof value !== 'object') return false;
  const { insert, attributes } = value as { insert?: unknown; attributes?: unknown };

  // Same rules as Desktop (rich_text.rs): null attributes mean none; any
  // other non-object (including an array) makes the delta invalid.
  return (
    typeof insert === 'string' &&
    (attributes === undefined ||
      attributes === null ||
      (typeof attributes === 'object' && !Array.isArray(attributes)))
  );
}

function hasAttributes(insert: RichTextInsert) {
  return !!insert.attributes && Object.values(insert.attributes).some((value) => value !== undefined && value !== null && value !== false);
}

/** A delta whose inserts carry no formatting says nothing `data` does not. */
export function isPlainRichText(delta: RichTextDelta) {
  return !delta.some(hasAttributes);
}

/** A stored value's formatting and the text it was saved for, or null when it holds none that can be used. */
function parseStoredRichText(raw: string): StoredRichText | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRichText> | null;

    if (!parsed || typeof parsed.text !== 'string' || !Array.isArray(parsed.delta)) return null;
    if (!parsed.delta.every(isInsert)) return null;

    const delta = parsed.delta.map(({ insert, attributes }) => {
      const kept = sanitizeRichTextAttributes(attributes);

      return Object.keys(kept).length > 0 ? { insert, attributes: kept } : { insert };
    });

    return isPlainRichText(delta) ? null : { text: parsed.text, delta };
  } catch {
    return null;
  }
}

// What stored values read as, by their JSON, most recently read last. A cell
// is read on every render and every change of its row or field, and a view
// shows many cells: a value is parsed once, and reading it again returns the
// same delta, so renderers memoized on the delta skip cells that did not
// change. The size is bounded by the JSON kept, not by the number of cells.
const STORED_CACHE_MAX_CHARS = 4_000_000;
const storedCache = new Map<string, StoredRichText | null>();
let storedCacheChars = 0;

function readStoredRichText(raw: string): StoredRichText | null {
  const cached = storedCache.get(raw);

  if (cached !== undefined) {
    storedCache.delete(raw);
    storedCache.set(raw, cached);
    return cached;
  }

  const stored = parseStoredRichText(raw);

  if (raw.length > STORED_CACHE_MAX_CHARS) return stored;

  storedCache.set(raw, stored);
  storedCacheChars += raw.length;

  for (const oldest of storedCache.keys()) {
    if (storedCacheChars <= STORED_CACHE_MAX_CHARS) break;
    storedCache.delete(oldest);
    storedCacheChars -= oldest.length;
  }

  return stored;
}

/**
 * Reads a stored `rich_text` value. Returns the delta only while it still
 * describes `data`; anything else (missing, malformed, or saved for text that
 * has since changed) reads as plain text.
 *
 * Reads of the same stored value share one delta: treat it as read-only.
 */
export function parseRichTextCellValue(raw: unknown, data: unknown): RichTextDelta | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (typeof data !== 'string') return undefined;

  const stored = readStoredRichText(raw);

  return stored && stored.text === data ? stored.delta : undefined;
}

export function readRichTextFromCell(cell: YDatabaseCell): RichTextDelta | undefined {
  return parseRichTextCellValue(cell.get(YjsDatabaseKey.rich_text), cell.get(YjsDatabaseKey.data));
}

/**
 * Desktop refuses to save formatting whose delta JSON is larger than this
 * (`MAX_RICH_TEXT_DELTA_BYTES` in rich_text.rs, counted in UTF-8 bytes), and
 * with it every later edit of the cell, so the web does not store more.
 */
export const MAX_RICH_TEXT_DELTA_BYTES = 200_000;

function utf8Length(text: string) {
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
export function isRichTextTooLarge(delta: RichTextDelta, json = JSON.stringify(delta)) {
  // No UTF-16 unit takes more than 3 UTF-8 bytes.
  if (json.length * 3 <= MAX_RICH_TEXT_DELTA_BYTES) return false;

  return utf8Length(json) > MAX_RICH_TEXT_DELTA_BYTES;
}

export function serializeRichTextCellValue(text: string, delta: RichTextDelta): string {
  const stored: StoredRichText = { text, delta };

  return JSON.stringify(stored);
}

export function plainTextToRichText(text: string): RichTextDelta {
  return text ? [{ insert: text }] : [];
}

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

    default:
      return '';
  }
}

/**
 * The plain text a delta is stored as in `data`: mentions and equations are
 * written the way they read, so Desktop, search and filters see words rather
 * than the `@`/`$` placeholder characters the editor keeps them on. Reads any
 * delta the way Desktop does (see the shared corpus in __tests__), including
 * mentions stored as JSON text and values of unexpected types.
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
