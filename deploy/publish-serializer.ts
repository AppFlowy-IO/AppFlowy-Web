/**
 * Converts a published-page snapshot into semantic HTML for the server-rendered
 * body of a published page.
 *
 * This is intentionally independent of the React renderer (`StaticEditor`,
 * `src/components/editor/`). That tree is browser-only — it touches `window`,
 * `document`, `navigator` and DOM observers throughout — and making it
 * server-safe would be a long refactor with permanent regression risk on every
 * new block type. This module instead emits plain semantic HTML (headings,
 * lists, links, tables) for crawlers and for the moment before the client app
 * loads. The client does not hydrate this markup: `createRoot` discards it and
 * mounts the normal app, so there is no markup contract to keep in sync, only
 * the snapshot JSON both sides already consume.
 *
 * Constraints:
 * - Pure and dependency-free. No DOM, React, Slate or `src/` imports — the
 *   production image ships only `deploy/`, so block types are string literals
 *   here (a test checks them against `BlockType`).
 * - Input is untrusted JSON. Every text node and attribute value goes through
 *   `escapeHtml`, and every URL through `sanitizeUrl`. There is no raw
 *   interpolation of snapshot data anywhere.
 * - Content is never silently dropped: an unknown block type still emits its
 *   text in a neutral wrapper, so a block added to the editor later degrades to
 *   unstyled text rather than vanishing.
 */

export type SerializeFailureReason =
  | 'not_an_object'
  | 'unsupported_schema_version'
  | 'unsupported_kind'
  | 'missing_document'
  | 'too_deep'
  | 'serializer_error';

export type SerializeResult = { ok: true; html: string } | { ok: false; reason: SerializeFailureReason };

type JsonObject = Record<string, unknown>;

interface ViewRef {
  view_id?: unknown;
  viewId?: unknown;
  name?: unknown;
  child_views?: unknown;
  childViews?: unknown;
}

interface RenderContext {
  /** view id → view name, for page mentions and sub-page blocks. */
  viewNames: Map<string, string>;
  /** view id → published URL, for the targets that resolved (see publish-links.ts). */
  viewHrefs: Map<string, string>;
  depth: number;
}

export interface SerializeOptions {
  /**
   * Published URLs of linked pages, keyed by view id. Targets present here
   * render as links; the rest render as plain names.
   */
  viewHrefs?: Map<string, string>;
}

// Nested blocks recurse; a hostile or corrupt snapshot could nest deeply enough
// to overflow the stack. Past this depth we give up and serve the shell.
const MAX_DEPTH = 64;

class TooDeepError extends Error {}

// Block types, mirrored from `BlockType` in src/application/types.ts. Kept as
// literals because `src/` is not in the production image; a test asserts they
// match the enum.
const BLOCK = {
  paragraph: 'paragraph',
  page: 'page',
  heading: 'heading',
  todoList: 'todo_list',
  bulletedList: 'bulleted_list',
  numberedList: 'numbered_list',
  toggleList: 'toggle_list',
  code: 'code',
  equation: 'math_equation',
  quote: 'quote',
  callout: 'callout',
  divider: 'divider',
  image: 'image',
  gallery: 'multi_image',
  video: 'video',
  audio: 'audio',
  file: 'file',
  pdf: 'pdf',
  linkPreview: 'link_preview',
  table: 'table',
  tableCell: 'table/cell',
  simpleTable: 'simple_table',
  simpleTableRow: 'simple_table_row',
  simpleTableCell: 'simple_table_cell',
  columns: 'simple_columns',
  column: 'simple_column',
  subpage: 'sub_page',
  linkedPage: 'linked_page',
  outline: 'outline',
} as const;

// Embedded database views carry no document text — their rows live in other
// collabs that are not part of a document snapshot — so they render as nothing.
const DATABASE_BLOCK_TYPES = new Set([
  'grid',
  'board',
  'calendar',
  'timeline',
  'list',
  'chart',
  'gallery',
  'feed',
]);

/**
 * Block types the serializer knows about, for the coverage test that fails CI
 * when a new `BlockType` is added without a decision.
 * - `handled`: rendered with dedicated semantic markup (or deliberately empty).
 * - `textFallback`: intentionally left to the unknown-type fallback, which
 *   keeps their text in a neutral wrapper.
 */
export const SERIALIZER_BLOCK_COVERAGE = {
  handled: [...Object.values(BLOCK), ...DATABASE_BLOCK_TYPES] as string[],
  textFallback: [
    'google_drive',
    'ai_meeting',
    'ai_meeting_summary',
    'ai_meeting_notes',
    'ai_meeting_transcription',
    'ai_meeting_speaker',
  ],
};

const LIST_TAGS: Record<string, 'ul' | 'ol'> = {
  [BLOCK.bulletedList]: 'ul',
  [BLOCK.numberedList]: 'ol',
  [BLOCK.todoList]: 'ul',
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes text for use in HTML text content or a double-quoted attribute value.
 *
 * All five significant characters are escaped everywhere, so the same function
 * is safe in both positions and there is no second, weaker escaper to misuse.
 *
 * @param value - Any value; non-strings are converted with `String`.
 * @returns The escaped string.
 */
export const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Validates a URL from the snapshot for use in `href` or `src`.
 *
 * Allowlist, not denylist: only http(s), mailto, and same-site relative URLs
 * (`/path`, `#anchor`, `//host`) pass. Everything else — `javascript:`,
 * `data:`, `vbscript:`, mixed-case or whitespace-obfuscated variants, strings
 * with control characters, and scheme-less text like `example.com` — is
 * rejected. The caller keeps the link text and drops only the link.
 *
 * @param raw - An untrusted value.
 * @returns The trimmed URL (still to be escaped by the caller), or null.
 */
export const sanitizeUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;

  const url = raw.trim();

  // Browsers strip tabs and newlines inside URLs, which is how
  // "java\tscript:" smuggles a scheme past naive checks. Reject them outright.
  // eslint-disable-next-line no-control-regex
  if (url.length === 0 || /[\u0000-\u001F\u007F]/.test(url)) return null;

  if (url.startsWith('/') || url.startsWith('#')) return url;

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1]?.toLowerCase();

  return scheme && SAFE_SCHEMES.has(scheme) ? url : null;
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const collectViewNames = (views: unknown, into: Map<string, string>) => {
  for (const view of asArray(views)) {
    if (!isObject(view)) continue;

    const ref = view as ViewRef;
    const id = asString(ref.view_id) ?? asString(ref.viewId);
    const name = asString(ref.name);

    if (id && name && !into.has(id)) into.set(id, name);

    collectViewNames(ref.child_views ?? ref.childViews, into);
  }
};

// view id → name for the page itself, its children and its ancestors: every
// page a mention or sub-page block in this document can name.
const buildViewNames = (view: JsonObject): Map<string, string> => {
  const viewNames = new Map<string, string>();

  collectViewNames([view], viewNames);
  collectViewNames(view.childViews, viewNames);
  collectViewNames(view.ancestorViews, viewNames);

  return viewNames;
};

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

const formatMentionDate = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;

  // Dates are ISO strings in current data, millisecond timestamps in older data.
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
};

// A linked page's name, as a link when its published URL resolved. The URL
// still goes through sanitizeUrl even though this server built it.
const renderPageName = (viewId: string, name: string, ctx: RenderContext, fallbackTag: 'span' | 'p') => {
  const href = sanitizeUrl(ctx.viewHrefs.get(viewId));
  const link = href ? `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>` : undefined;

  if (fallbackTag === 'p') return `<p>${link ?? escapeHtml(name)}</p>`;

  return link ?? `<span>${escapeHtml(name)}</span>`;
};

// Denormalized display title some mentions carry (newer page mentions and
// database references), used when the page is not in the snapshot's view tree.
const mentionTitle = (mention: JsonObject) => (isObject(mention.data) ? asString(mention.data.title) : undefined);

// Mirrors `isDatabaseReference` in MentionLeaf.tsx: a database row reference,
// or a database reference with a display title. These render their label but
// are not linked, because their route depends on the database container, not
// on the mentioned id.
const isDatabaseReference = (mention: JsonObject) => {
  const rowId = asString(mention.row_id) ?? asString(mention.database_row_id);
  const databaseId = asString(mention.database_id);

  return (
    mention.type === 'page' &&
    ((rowId !== undefined &&
      (databaseId ?? asString(mention.database_view_id) ?? asString(mention.page_id)) !== undefined) ||
      (databaseId !== undefined && mentionTitle(mention) !== undefined))
  );
};

// A page mention the serializer may link: the id to resolve, or undefined.
const linkablePageMentionId = (mention: JsonObject): string | undefined =>
  (mention.type === 'page' || mention.type === 'childPage') && !isDatabaseReference(mention)
    ? asString(mention.page_id)
    : undefined;

// The label of a page mention: the page's name from the view tree, else the
// mention's own denormalized title.
const pageMentionLabel = (mention: JsonObject, viewNames: Map<string, string>) => {
  const pageId = asString(mention.page_id);

  return (pageId ? viewNames.get(pageId) : undefined) ?? mentionTitle(mention);
};

// Mention leaves carry a hidden placeholder character as their text; the app
// renders the label from the mention data instead, and so do we. Mentions we
// cannot label (e.g. a page outside the published tree with no title) render
// as nothing rather than as a stray placeholder.
const renderMention = (mention: JsonObject, ctx: RenderContext): string => {
  const type = mention.type;

  if (isDatabaseReference(mention)) {
    const label = mentionTitle(mention) ?? pageMentionLabel(mention, ctx.viewNames);

    return label ? `<span>${escapeHtml(label)}</span>` : '';
  }

  const linkableId = linkablePageMentionId(mention);

  if (linkableId) {
    const label = pageMentionLabel(mention, ctx.viewNames);

    return label ? renderPageName(linkableId, label, ctx, 'span') : '';
  }

  if (type === 'date') {
    const date = formatMentionDate(mention.date);

    return date ? `<time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>` : '';
  }

  if (type === 'externalLink') {
    const href = sanitizeUrl(mention.url);

    return href ? `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>` : '';
  }

  if (type === 'person') {
    const name = asString(mention.person_name);

    return name ? `<span>${escapeHtml(name)}</span>` : '';
  }

  return '';
};

// Marks wrap in a fixed order (innermost first) so a given combination always
// produces the same markup: <a><strong><em><u><s><code>text</code></s></u></em></strong></a>.
const MARK_TAGS: Array<[mark: string, tag: string]> = [
  ['code', 'code'],
  ['strikethrough', 's'],
  ['underline', 'u'],
  ['italic', 'em'],
  ['bold', 'strong'],
];

const renderLeaf = (leaf: unknown, ctx: RenderContext): string => {
  if (!isObject(leaf)) return '';

  if (isObject(leaf.mention)) return renderMention(leaf.mention, ctx);

  // Inline formulas also use a placeholder as text; the formula is the content.
  if (typeof leaf.formula === 'string') return `<span>${escapeHtml(leaf.formula)}</span>`;

  if (typeof leaf.text !== 'string' || leaf.text.length === 0) return '';

  // Soft line breaks (shift+enter) are stored as "\n" inside the text.
  let html = escapeHtml(leaf.text).replace(/\n/g, '<br>');

  for (const [mark, tag] of MARK_TAGS) {
    if (leaf[mark] === true) html = `<${tag}>${html}</${tag}>`;
  }

  const href = sanitizeUrl(leaf.href);

  if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`;

  return html;
};

const isTextElement = (node: unknown): node is JsonObject => isObject(node) && node.type === 'text';

const renderInline = (textElements: JsonObject[], ctx: RenderContext): string =>
  textElements.map((element) => asArray(element.children).map((leaf) => renderLeaf(leaf, ctx)).join('')).join('');

const plainText = (textElements: JsonObject[]): string =>
  textElements
    .map((element) =>
      asArray(element.children)
        .map((leaf) => (isObject(leaf) && typeof leaf.text === 'string' ? leaf.text : ''))
        .join('')
    )
    .join('');

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

interface BlockParts {
  type: string;
  data: JsonObject;
  inline: string;
  textElements: JsonObject[];
  childBlocks: JsonObject[];
}

// A Slate block element's children are its text element(s) followed by its
// nested child blocks.
const splitBlock = (block: JsonObject, ctx: RenderContext): BlockParts => {
  const children = asArray(block.children);
  const textElements = children.filter(isTextElement);
  const childBlocks = children.filter((child): child is JsonObject => isObject(child) && !isTextElement(child));

  return {
    type: typeof block.type === 'string' ? block.type : '',
    data: isObject(block.data) ? block.data : {},
    inline: renderInline(textElements, ctx),
    textElements,
    childBlocks,
  };
};

const paragraphIfAny = (inline: string) => (inline ? `<p>${inline}</p>` : '');

const renderMediaLink = (parts: BlockParts) => {
  const href = sanitizeUrl(parts.data.url);
  const label = asString(parts.data.name) ?? href;

  if (!href || !label) return '';

  return `<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;
};

const renderImage = (url: unknown) => {
  const src = sanitizeUrl(url);

  return src ? `<img src="${escapeHtml(src)}" alt="">` : '';
};

const renderLegacyTable = (parts: BlockParts, ctx: RenderContext) => {
  // Legacy tables store cells flat, each with its own row/column position.
  const rows = new Map<number, Map<number, string>>();

  for (const cell of parts.childBlocks) {
    const cellParts = splitBlock(cell, ctx);
    const row = Number(cellParts.data.rowPosition);
    const col = Number(cellParts.data.colPosition);

    if (!Number.isInteger(row) || !Number.isInteger(col)) continue;

    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)?.set(col, renderBlocks(cellParts.childBlocks, ctx) || cellParts.inline);
  }

  const body = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([, cols]) =>
        `<tr>${[...cols.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, html]) => `<td>${html}</td>`)
          .join('')}</tr>`
    )
    .join('');

  return body ? `<table><tbody>${body}</tbody></table>` : '';
};

const renderSimpleTable = (parts: BlockParts, ctx: RenderContext) => {
  const rows = parts.childBlocks
    .filter((row) => row.type === BLOCK.simpleTableRow)
    .map((row) => {
      const cells = splitBlock(row, ctx)
        .childBlocks.filter((cell) => cell.type === BLOCK.simpleTableCell)
        .map((cell) => {
          const cellParts = splitBlock(cell, ctx);

          return `<td>${paragraphIfAny(cellParts.inline)}${renderBlocks(cellParts.childBlocks, ctx)}</td>`;
        })
        .join('');

      return `<tr>${cells}</tr>`;
    })
    .join('');

  return rows ? `<table><tbody>${rows}</tbody></table>` : '';
};

const renderListItem = (parts: BlockParts, ctx: RenderContext) => {
  const nested = renderBlocks(parts.childBlocks, ctx);
  const checkbox =
    parts.type === BLOCK.todoList ? `<input type="checkbox" disabled${parts.data.checked === true ? ' checked' : ''}> ` : '';

  return `<li>${checkbox}${parts.inline}${nested}</li>`;
};

const renderBlock = (block: JsonObject, ctx: RenderContext): string => {
  const parts = splitBlock(block, ctx);
  const nested = () => renderBlocks(parts.childBlocks, ctx);
  const { data, inline } = parts;

  switch (parts.type) {
    case BLOCK.paragraph:
      return `${paragraphIfAny(inline)}${nested()}`;

    case BLOCK.page:
      return nested();

    case BLOCK.columns:
    case BLOCK.column:
      return `<div>${nested()}</div>`;

    case BLOCK.heading: {
      // The page title is the document's only <h1>, so content headings shift
      // down one level: an in-document H1 becomes <h2>, capped at <h6>.
      const level = Number.isInteger(data.level) ? Math.min(Math.max(data.level as number, 1), 6) : 1;
      const tag = `h${Math.min(level + 1, 6)}`;

      return `<${tag}>${inline}</${tag}>${nested()}`;
    }

    case BLOCK.toggleList:
      // Rendered open: crawlers read collapsed content either way, and humans
      // see the full text before the app mounts.
      return `<details open><summary>${inline}</summary>${nested()}</details>`;

    case BLOCK.quote:
      return `<blockquote>${paragraphIfAny(inline)}${nested()}</blockquote>`;

    case BLOCK.callout: {
      // Only emoji icons are text; icon-library icons are JSON and are skipped.
      const icon = data.icon_type !== 'icon' ? asString(data.icon) : undefined;
      const iconHtml = icon && icon.length <= 16 ? `<span>${escapeHtml(icon)}</span> ` : '';

      return `<aside>${iconHtml}${paragraphIfAny(inline)}${nested()}</aside>`;
    }

    case BLOCK.code: {
      const language = asString(data.language);
      // The language lands in a class name; restrict it to identifier characters.
      const className = language && /^[\w+#-]{1,32}$/.test(language) ? ` class="language-${escapeHtml(language)}"` : '';

      return `<pre><code${className}>${escapeHtml(plainText(parts.textElements))}</code></pre>${nested()}`;
    }

    case BLOCK.equation: {
      const formula = asString(data.formula);

      return formula ? `<pre>${escapeHtml(formula)}</pre>` : '';
    }

    case BLOCK.divider:
      return '<hr>';

    case BLOCK.image: {
      const img = renderImage(data.url);

      return img ? `<figure>${img}</figure>` : '';
    }

    case BLOCK.gallery: {
      const images = asArray(data.images)
        .map((image) => (isObject(image) ? renderImage(image.url) : ''))
        .join('');

      return images ? `<figure>${images}</figure>` : '';
    }

    case BLOCK.video:
    case BLOCK.audio:
    case BLOCK.file:
    case BLOCK.pdf:
    case BLOCK.linkPreview:
      return renderMediaLink(parts);

    case BLOCK.simpleTable:
      return renderSimpleTable(parts, ctx);

    case BLOCK.table:
      return renderLegacyTable(parts, ctx);

    case BLOCK.subpage:
    case BLOCK.linkedPage: {
      const viewId = asString(data.view_id);
      const name = viewId ? ctx.viewNames.get(viewId) : undefined;

      return viewId && name ? renderPageName(viewId, name, ctx, 'p') : '';
    }

    case BLOCK.outline:
      // Derived from the document's headings, which are already rendered.
      return '';

    default:
      if (DATABASE_BLOCK_TYPES.has(parts.type)) return nested();

      // Unknown block type: keep its text and children in a neutral wrapper so
      // content added by future block types is never silently dropped.
      return `<div data-block-type="${escapeHtml(parts.type)}">${paragraphIfAny(inline)}${nested()}</div>`;
  }
};

/**
 * Renders a list of sibling blocks, grouping consecutive list items of the same
 * type into one <ul>/<ol>, as the editor displays them.
 */
const renderBlocks = (blocks: unknown[], ctx: RenderContext): string => {
  if (ctx.depth > MAX_DEPTH) throw new TooDeepError();

  const childCtx = { ...ctx, depth: ctx.depth + 1 };
  let html = '';
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];

    // Malformed sibling: skip just this node, keep the rest of the document.
    if (!isObject(block) || typeof block.type !== 'string') {
      index += 1;
      continue;
    }

    const listTag = LIST_TAGS[block.type];

    if (!listTag) {
      html += renderBlock(block, childCtx);
      index += 1;
      continue;
    }

    const items: BlockParts[] = [];

    while (index < blocks.length) {
      const item = blocks[index];

      if (!isObject(item) || item.type !== block.type) break;

      items.push(splitBlock(item, childCtx));
      index += 1;
    }

    const start = Number(items[0].data.number);
    const startAttr = listTag === 'ol' && Number.isInteger(start) && start !== 1 ? ` start="${start}"` : '';

    html += `<${listTag}${startAttr}>${items.map((item) => renderListItem(item, childCtx)).join('')}</${listTag}>`;
  }

  return html;
};

/**
 * Serializes a published-page snapshot into the server-rendered page body.
 *
 * @param snapshot - The untrusted snapshot JSON from the v2 `/snapshot`
 *   endpoint (the `data` field of the API response).
 * @param options - Optional resolved URLs for linked pages.
 * @returns `{ ok: true, html }` with an `<article data-appflowy-ssr>` element
 *   for document snapshots. Returns `{ ok: false, reason }` — never throws — for
 *   anything it cannot render with confidence: a non-object, an unknown schema
 *   version, a non-document kind (databases are out of scope), a missing
 *   document body, excessive nesting, or an unexpected internal error. Callers
 *   serve the head-only shell in that case.
 */
export const serializePublishedPage = (snapshot: unknown, options: SerializeOptions = {}): SerializeResult => {
  if (!isObject(snapshot)) return { ok: false, reason: 'not_an_object' };
  if (snapshot.schemaVersion !== 1) return { ok: false, reason: 'unsupported_schema_version' };
  if (snapshot.kind !== 'document') return { ok: false, reason: 'unsupported_kind' };

  const document = snapshot.document;

  if (!isObject(document) || !Array.isArray(document.children)) {
    return { ok: false, reason: 'missing_document' };
  }

  try {
    const view: JsonObject = isObject(snapshot.view) ? snapshot.view : {};
    const viewNames = buildViewNames(view);
    const title = asString(view.name);
    const body = renderBlocks(document.children, {
      viewNames,
      viewHrefs: options.viewHrefs ?? new Map(),
      depth: 0,
    });

    return {
      ok: true,
      html: `<article data-appflowy-ssr>${title ? `<h1>${escapeHtml(title)}</h1>` : ''}${body}</article>`,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof TooDeepError ? 'too_deep' : 'serializer_error' };
  }
};

// Only targets the serializer can render as a link are collected: ones with a
// label, so no lookup is wasted on a link that would have no text.
const collectFromBlocks = (blocks: unknown[], viewNames: Map<string, string>, into: string[], depth: number) => {
  // Same bound as rendering; a snapshot too deep to render has no links to resolve.
  if (depth > MAX_DEPTH) return;

  for (const block of blocks) {
    if (!isObject(block)) continue;

    if ((block.type === BLOCK.subpage || block.type === BLOCK.linkedPage) && isObject(block.data)) {
      const viewId = asString(block.data.view_id);

      if (viewId && viewNames.has(viewId)) into.push(viewId);
    }

    for (const child of asArray(block.children)) {
      if (isTextElement(child)) {
        for (const leaf of asArray(child.children)) {
          if (!isObject(leaf) || !isObject(leaf.mention)) continue;

          const viewId = linkablePageMentionId(leaf.mention);

          if (viewId && pageMentionLabel(leaf.mention, viewNames)) into.push(viewId);
        }
      }
    }

    collectFromBlocks(
      asArray(block.children).filter((child) => !isTextElement(child)),
      viewNames,
      into,
      depth + 1
    );
  }
};

/**
 * Lists the view ids a document links to — sub-page blocks and page mentions —
 * in document order, deduplicated. The caller resolves their published URLs
 * and passes them back through `SerializeOptions.viewHrefs`.
 *
 * Only targets the serializer can actually render as a link are listed.
 *
 * @param snapshot - The untrusted snapshot JSON.
 * @returns View ids; empty for anything that is not a well-formed document
 *   snapshot. Never throws.
 */
export const collectLinkedViewIds = (snapshot: unknown): string[] => {
  if (!isObject(snapshot) || snapshot.kind !== 'document' || !isObject(snapshot.document)) return [];

  try {
    const viewNames = buildViewNames(isObject(snapshot.view) ? snapshot.view : {});
    const ids: string[] = [];

    collectFromBlocks(asArray(snapshot.document.children), viewNames, ids, 0);

    return [...new Set(ids)];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Meta description
// ---------------------------------------------------------------------------

/** Longest generated description, in characters, including the ellipsis. */
export const DESCRIPTION_MAX_LENGTH = 155;

// Blocks whose text reads as prose. Headings repeat the title or structure,
// code and equations are not prose, and embeds have no text of their own.
const DESCRIPTION_BLOCK_TYPES = new Set<string>([
  BLOCK.paragraph,
  BLOCK.quote,
  BLOCK.callout,
  BLOCK.bulletedList,
  BLOCK.numberedList,
  BLOCK.todoList,
  BLOCK.toggleList,
]);

// Containers whose nested blocks are not read for the description.
const DESCRIPTION_SKIPPED_CONTAINERS = new Set<string>([BLOCK.code, BLOCK.equation, BLOCK.simpleTable, BLOCK.table]);

// Same labels the HTML path renders for mentions, as plain text.
const mentionText = (mention: JsonObject, viewNames: Map<string, string>): string | undefined => {
  if (isDatabaseReference(mention)) return mentionTitle(mention) ?? pageMentionLabel(mention, viewNames);
  if (linkablePageMentionId(mention)) return pageMentionLabel(mention, viewNames);
  if (mention.type === 'date') return formatMentionDate(mention.date);
  if (mention.type === 'externalLink') return asString(mention.url);
  if (mention.type === 'person') return asString(mention.person_name);

  return undefined;
};

const leafText = (leaf: unknown, viewNames: Map<string, string>): string => {
  if (!isObject(leaf)) return '';
  if (isObject(leaf.mention)) return mentionText(leaf.mention, viewNames) ?? '';
  if (typeof leaf.formula === 'string') return leaf.formula;

  return typeof leaf.text === 'string' ? leaf.text : '';
};

/**
 * Collects prose text from blocks in document order, stopping as soon as
 * enough has been gathered: a long document never costs more than a few blocks.
 */
const collectProse = (blocks: unknown[], viewNames: Map<string, string>, parts: string[], state: { length: number }, depth: number) => {
  if (depth > MAX_DEPTH) return;

  for (const block of blocks) {
    if (state.length > DESCRIPTION_MAX_LENGTH) return;
    if (!isObject(block) || typeof block.type !== 'string') continue;

    const children = asArray(block.children);

    if (DESCRIPTION_BLOCK_TYPES.has(block.type)) {
      const text = children
        .filter(isTextElement)
        .map((element) => asArray(element.children).map((leaf) => leafText(leaf, viewNames)).join(''))
        .join(' ')
        .trim();

      if (text) {
        parts.push(text);
        state.length += text.length + 1;
      }
    }

    // Nested content (list children, toggle bodies, columns, callout bodies)
    // is read in order, but never inside non-prose containers: table cells
    // hold paragraphs too, yet tabular data makes a poor description.
    if (!DESCRIPTION_SKIPPED_CONTAINERS.has(block.type)) {
      collectProse(children.filter((child) => !isTextElement(child)), viewNames, parts, state, depth + 1);
    }
  }
};

/**
 * Joins block texts into one line. A block that ends a sentence is followed by
 * a space; one that does not (list items, link-only lines on index pages) by a
 * comma, so "Create a page" + "Share it" reads "Create a page, Share it"
 * rather than running the two together.
 */
const joinProse = (parts: string[]): string =>
  parts.reduce((joined, part) => {
    if (!joined) return part;

    return `${joined}${/[.!?…:;]$/.test(joined) ? ' ' : ', '}${part}`;
  }, '');

/**
 * Cuts text to at most `maxLength` characters, at a word boundary where
 * possible, adding an ellipsis when anything was removed.
 */
const truncateAtWord = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;

  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only back up to a space if it keeps most of the text; a single very long
  // word (a URL, say) is cut mid-word instead of leaving almost nothing.
  const trimmed = lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut;

  return `${trimmed.replace(/[\s,;:.\-–—]+$/, '')}…`;
};

/**
 * Derives a meta description from the opening prose of a document page.
 *
 * Reads paragraph-like blocks in document order (skipping headings, code,
 * equations, tables and embeds), collapses whitespace, and truncates to
 * `DESCRIPTION_MAX_LENGTH` characters at a word boundary.
 *
 * The result is plain text, not HTML: the caller must set it through an API
 * that escapes attribute values.
 *
 * @param snapshot - The untrusted snapshot JSON.
 * @returns The description, or undefined when the snapshot is not a document
 *   or has no prose — callers then keep the default description. Never throws.
 */
export const extractPageDescription = (snapshot: unknown): string | undefined => {
  if (!isObject(snapshot) || snapshot.kind !== 'document' || !isObject(snapshot.document)) return undefined;

  try {
    const viewNames = buildViewNames(isObject(snapshot.view) ? snapshot.view : {});
    const parts: string[] = [];

    collectProse(asArray(snapshot.document.children), viewNames, parts, { length: 0 }, 0);

    const text = joinProse(parts.map((part) => part.replace(/\s+/g, ' ').trim())).trim();

    return text ? truncateAtWord(text, DESCRIPTION_MAX_LENGTH) : undefined;
  } catch {
    return undefined;
  }
};
