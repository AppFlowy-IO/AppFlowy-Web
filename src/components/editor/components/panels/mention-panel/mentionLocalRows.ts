/**
 * The open database's rows as the editor @ picker's local lane takes them (MEN-WEB-15), behind the
 * picker's `mentionTypeaheadV2` switch and its local lane (`mentionTypeaheadFlag.ts`).
 *
 * A Text cell or a row page gives the picker the rows its database holds in memory
 * ({@link MentionLocalRowsAccess}, built by `@/application/database-yjs/mention-local-rows`): each
 * row's primary-field text, as the grid shows it, and when the row was created. On a typed query,
 * {@link rankMentionLocalRows} matches those titles with the typeahead contract's tiers (T3 or
 * better) and ranks them as the contract ranks local-only items, so the picker's merge
 * (`mentionLocalMerge.ts`) adds them to Pages, where Search returns rows. A row created seconds ago
 * is listed in the keystroke's own render, before Search has indexed it, and flagged fresh for 15
 * minutes after its creation (its `created_at`, whoever created it).
 *
 * A row the server lists too keeps the server's payload, and the title of a row whose live document
 * the tab syncs ({@link MentionLocalRow.synced}), so a rename typed or received here shows at once.
 * A title read from a copy that may lag behind Search's (the row walk's seed, a cached document no
 * longer synced) gives way to the server's: {@link mentionLocalRowsForSections} leaves that row to
 * the server's item. The row the editor is in is never matched
 * ({@link RankMentionLocalRowsInput.contextRowId}): a row page's title is saved as it is typed, so
 * it holds the very query the picker matches. Search's item for that row still shows.
 *
 * Search matches a row by any text the row holds (its other cells, its page), the lane only by its
 * title, so the picker keeps sending the server's rows request. It leaves that request out only when
 * the database's rows are all in memory ({@link MentionLocalRowsSnapshot.complete}) and the browser
 * asks for it (`__mention_local_rows_skip_server`, off by default until the coverage it loses is
 * measured; `doc/MENTION_LOCAL_ROWS_SPIKE.md`), and decides that once per typed query.
 *
 * Matching first drops every row that lacks one of the query's words, which a title must contain to
 * match at any tier, reading a normalized copy of each title made once per row and kept with it.
 * Ranking the rows that pass prepares their titles again, in the ranker's own cache, once per title
 * text. Nothing here depends on React, the database's internals or the network.
 */
import {
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';
import { boundMentionText, normalizeMentionText } from '@/utils/normalize-text';

import { MentionQuery, prepareMentionQuery, rankSection } from './mentionLocalRanker';
import { mentionItemNavKey } from './mentionUtils';

import type { MentionLaneItem } from './mentionLocalLane';
import type { MentionPickScore } from './mentionPickMemory';

/** One row the database holds in memory. */
export interface MentionLocalRow {
  readonly rowId: string;
  /** The primary field's text, as the grid shows it; empty for an untitled row. */
  readonly title: string;
  /** When the row was created (its `created_at`), in epoch milliseconds; absent when unknown. */
  readonly createdAtMs?: number;
  /**
   * The title was read from the row's live document while the tab syncs it, so it is at least as
   * new as Search's. Otherwise (absent or false) it comes from a copy that may lag behind Search's,
   * such as the row walk's seed, and the server's title wins for a row the server lists.
   */
  readonly synced?: boolean;
}

/** What the database holds in memory now. A new snapshot after each change. */
export interface MentionLocalRowsSnapshot {
  readonly databaseId: string;
  /** The rows with a known title, each once. */
  readonly rows: readonly MentionLocalRow[];
  /**
   * Every row of the database is listed, from data the tab holds in memory: then the server's rows
   * request can add only rows that match by something other than their title.
   */
  readonly complete: boolean;
}

/** The rows of the database a Text cell or row page is in, as a subscription. */
export interface MentionLocalRowsSource {
  /** The current snapshot: the same object until a subscriber is notified of a change. */
  readonly getSnapshot: () => MentionLocalRowsSnapshot;
  /** Starts reading the database's rows on the first subscriber, and stops after the last one. */
  readonly subscribe: (onChange: () => void) => () => void;
}

/** What the editor context gives the picker in a Text cell or a row page. */
export interface MentionLocalRowsAccess {
  readonly source: MentionLocalRowsSource;
  /** The view the editor is in: a row mention the picker inserts opens the row in it. */
  readonly databaseViewId: string;
}

/** The snapshot of a source that holds nothing. */
export const NO_MENTION_LOCAL_ROWS: MentionLocalRowsSnapshot = Object.freeze({
  databaseId: '',
  rows: Object.freeze([]) as readonly MentionLocalRow[],
  complete: false,
});

/**
 * At most this many rows are ranked for one typed query: more than the Pages section of any answer
 * can hold (20 pages, 20 rows and 20 carried provisional items), so the merge, which keeps at most
 * `max(20, what the server listed)` there, gets every local row that could make it in.
 */
export const MENTION_LOCAL_ROWS_LIMIT = 60;

/** The navigation key of a row, as `mentionItemNavKey` gives the server's item for it. */
export function mentionLocalRowNavKey(databaseId: string, rowId: string): string {
  return `row:${databaseId}:${rowId}`;
}

/**
 * A row as Search lists it (`database_row_mention_item_from_parts`): the row id as its object, the
 * database and the view to open it in, and a `databaseRow` payload, so the picker inserts the row
 * mention a server item would give. The row's page is left out, as for a row that matched by title.
 */
export function mentionLocalRowItem(
  databaseId: string,
  databaseViewId: string,
  row: Pick<MentionLocalRow, 'rowId' | 'title'>
): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.DatabaseRow,
    object_id: row.rowId,
    title: row.title,
    database_id: databaseId,
    database_view_id: databaseViewId,
    database_row_id: row.rowId,
    mention: {
      type: 'databaseRow',
      database_id: databaseId,
      database_view_id: databaseViewId,
      row_id: row.rowId,
    },
  };
}

// Each row's title as the contract's matcher reads it, kept with the row object: a snapshot keeps
// the objects of the rows that did not change, so a title is normalized once.
const normalizedTitles = new WeakMap<MentionLocalRow, string>();
// And every title of a snapshot's rows, in their order, so a keystroke reads them in one pass.
const normalizedRowTitles = new WeakMap<readonly MentionLocalRow[], readonly string[]>();

function normalizedTitle(row: MentionLocalRow): string {
  let normalized = normalizedTitles.get(row);

  if (normalized === undefined) {
    normalized = normalizeMentionText(boundMentionText(row.title));
    normalizedTitles.set(row, normalized);
  }

  return normalized;
}

function normalizedTitlesOf(rows: readonly MentionLocalRow[]): readonly string[] {
  let titles = normalizedRowTitles.get(rows);

  if (!titles) {
    titles = rows.map(normalizedTitle);
    normalizedRowTitles.set(rows, titles);
  }

  return titles;
}

/**
 * Normalizes every title of `snapshot` for the word filter ahead of the first keystroke. The
 * ranking of the titles that pass it prepares them in the ranker's own cache on the keystroke that
 * first matches them.
 */
export function prepareMentionLocalRows(snapshot: MentionLocalRowsSnapshot): void {
  normalizedTitlesOf(snapshot.rows);
}

/**
 * What a title must contain to match `query` at any tier: each of its words, or the whole query when
 * it has none (only punctuation). An exact, prefix or substring match contains the whole query, and
 * so each of its words; a CJK match contains the whole query; a word-start match has each word start
 * a word of the title.
 */
function requiredParts(query: MentionQuery): readonly string[] {
  return query.tokens.length > 0 ? query.tokens : [query.normalized];
}

/** The rows whose title contains every part of the query: the only ones that can match it. */
export function mentionLocalRowCandidates(query: MentionQuery, rows: readonly MentionLocalRow[]): MentionLocalRow[] {
  if (!query.normalized) return [];

  const parts = requiredParts(query);
  const titles = normalizedTitlesOf(rows);
  const candidates: MentionLocalRow[] = [];

  if (parts.length === 1) {
    const [part] = parts;

    for (let index = 0; index < titles.length; index += 1) {
      if (titles[index].includes(part)) candidates.push(rows[index]);
    }

    return candidates;
  }

  for (let index = 0; index < titles.length; index += 1) {
    const title = titles[index];

    if (parts.every((part) => title.includes(part))) candidates.push(rows[index]);
  }

  return candidates;
}

/** A matched row as the merge takes it, with where its title came from. */
export interface MentionLocalRowLaneItem extends MentionLaneItem {
  /** {@link MentionLocalRow.synced}: the title follows the row's synced live document. */
  readonly synced: boolean;
}

/**
 * What a merge with `sections` should get of `rows` (ranked by {@link rankMentionLocalRows}):
 * - not a row whose title may lag behind Search's ({@link MentionLocalRow.synced} unset) that the
 *   sections list, so the server's item, its title and its payload stand alone (the merge would
 *   give the local title the win);
 * - at most the best `max(limit, what the server listed)`: the merge keeps no more items in Pages,
 *   where rows join, so no row past that many can make it in, whatever else the section holds.
 */
export function mentionLocalRowsForSections(
  rows: readonly MentionLocalRowLaneItem[],
  sections: readonly MentionSearchSection[],
  limit: number
): readonly MentionLocalRowLaneItem[] {
  const pages = sections.find((section) => section.kind === MentionSearchSectionKind.Pages)?.items.length ?? 0;
  const keep = Math.max(limit, pages);
  let kept = rows;

  if (rows.some((row) => !row.synced)) {
    const listed = new Set(sections.flatMap((section) => section.items.map(mentionItemNavKey)));

    if (rows.some((row) => !row.synced && listed.has(row.key))) {
      kept = rows.filter((row) => row.synced || !listed.has(row.key));
    }
  }

  return kept.length <= keep ? kept : kept.slice(0, keep);
}

export interface RankMentionLocalRowsInput {
  /** The typed query; a bare one matches nothing. */
  query: string;
  snapshot: MentionLocalRowsSnapshot;
  /** The view an inserted row mention opens the row in. */
  databaseViewId: string;
  /** Pick memory's scores for the typed query, by navigation key: they order rows inside a tier. */
  picks?: ReadonlyMap<string, MentionPickScore>;
  /** The clock, in epoch milliseconds. */
  nowMs: number;
  /** The most rows returned, the best first; {@link MENTION_LOCAL_ROWS_LIMIT} by default. */
  limit?: number;
  /**
   * The row the editor is in, as the request's `context.row_id` names it: never returned. A row
   * page's title is saved on every keystroke, so while the picker is open there, the row's title
   * holds the query being typed and would match it (and Search gives the open row no personal
   * signal either: it is rarely its own mention target).
   */
  contextRowId?: string;
}

/**
 * The rows that match the typed query at T3 or better, ranked as the contract's merge ranks
 * local-only items (tier, pick memory, length, then the navigation key) and cut to `limit`, as lane
 * items the merge takes: keyed and inserted as Search's rows, with the creation time as when the row
 * changed, so one created at most 15 minutes ago is flagged fresh, and where the title came from.
 * The row the editor is in is left out before ranking. Rows carry no recency: the contract's
 * recency is the client's own open, creation or mention, which a row does not record.
 */
export function rankMentionLocalRows({
  query,
  snapshot,
  databaseViewId,
  picks,
  nowMs,
  limit = MENTION_LOCAL_ROWS_LIMIT,
  contextRowId,
}: RankMentionLocalRowsInput): MentionLocalRowLaneItem[] {
  if (snapshot.rows.length === 0 || limit <= 0) return [];

  const prepared = prepareMentionQuery(query);
  const matched = mentionLocalRowCandidates(prepared, snapshot.rows);
  const candidates = (contextRowId ? matched.filter((row) => row.rowId !== contextRowId) : matched).map((row) => {
    const key = mentionLocalRowNavKey(snapshot.databaseId, row.rowId);
    const pick = picks?.get(key);

    return { key, title: row.title, adaptive: pick?.adaptive, lift: pick?.lift, row };
  });

  return rankSection(prepared, 'objects', candidates, nowMs, limit).map(({ key, row }) => ({
    key,
    title: row.title,
    icon: null,
    changedMs: row.createdAtMs,
    item: mentionLocalRowItem(snapshot.databaseId, databaseViewId, row),
    synced: row.synced === true,
  }));
}
