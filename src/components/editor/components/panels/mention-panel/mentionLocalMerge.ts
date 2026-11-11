/**
 * The @-mention typeahead contract's merge (MEN-WEB-09): a typed query's two lane answers combined
 * into one, and a server answer merged with the client's local lane by navigation key. The contract
 * is `doc/context/workspace/mention_typeahead_contract.md` in AppFlowy-Cloud-Premium, version 1,
 * section Merge; its Rust reference is `mention_typeahead::combine_lane_answers` and
 * `merge_sections`, and `__fixtures__/mention-parity/merge.json` pins this port to it.
 *
 * - {@link combineMentionLaneAnswers}: the rows answer joins the primary answer after its Pages
 *   items, a key the primary answer holds stays where it put it, and a section takes the worse
 *   status (decision D17). Only the parity tests call it: the picker combines its lanes with
 *   `mergeMentionSearchResponses` (`mentionSearchFetch.ts`), as before the contract, which keeps a
 *   kind's first status and every item. For the picker's split they agree on screen: its primary
 *   request asks for no rows, so no key comes from both answers, and it reads a status only from
 *   one request's answer (an interim primary answer, or each request's outcome).
 * - {@link mergeMentionSections}: an item both have keeps the server's payload and takes the local
 *   title and icon, so a rename shows at once and is tiered by its new title (a person's blank local
 *   name or address takes the server's, D21). A typed query adds the local-only people, pages,
 *   databases and rows that match at C3 or T3 or better and that the server could have returned
 *   (D19); one created or renamed at most 15 minutes ago is flagged `fresh`. Sections are ranked by
 *   the client ranking (`rankSection`), and a bare `@` keeps the server's sections and order and adds
 *   no local-only item (D13).
 *
 * The picker passes `rank` to keep a section in the server's order (MEN-WEB-08 keeps Databases so
 * until the contract decides a database's view-name tier); local-only items then follow the server's
 * items, ranked among themselves. Nothing here depends on React, the DOM or the network.
 */
import {
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';
import { isMentionBlankText } from '@/utils/normalize-text';

import {
  MentionQuery,
  MentionRankCandidate,
  MentionRankLane,
  mentionSectionRankLane,
  objectTier,
  personTier,
  prepareMentionQuery,
  rankSection,
} from './mentionLocalRanker';
import { mentionLocalItemSection, MentionPickRequest } from './mentionPickRanking';
import { mentionItemNavKey, mentionSectionOrder } from './mentionUtils';

import type { MentionPickScore } from './mentionPickMemory';

/** A local-only item created or renamed at most this long ago, or at a time ahead of the clock, is fresh. */
export const MENTION_FRESH_MS = 15 * 60_000;
/** The limit of a request that names none, as Cloud reads it. */
export const MENTION_DEFAULT_LIMIT = 8;
/** The largest limit Cloud accepts. */
export const MENTION_MAX_LIMIT = 20;

/**
 * An item the client knows without asking the server (the contract's `merge::LocalItem`): an
 * outline page or database view, a recent view, a page created in this tab, or a roster member.
 */
export interface MentionLocalItem<Icon = unknown> {
  /** The navigation key, as `mentionItemNavKey` gives the server's item. */
  readonly key: string;
  /** The title the client shows, or a person's name, which may be blank. */
  readonly title: string;
  /** A person's address; empty or absent for objects. */
  readonly email?: string;
  readonly icon?: Icon | null;
  /** When the item was created or renamed on this client, in epoch milliseconds. */
  readonly changedMs?: number;
  /** When the client last opened, created or mentioned the item, in epoch milliseconds. */
  readonly lastUsedMs?: number;
  /** The object is already mentioned on the open page, or the person is on it. */
  readonly present?: boolean;
  /** What the picker inserts when no server item has the key; the server's payload wins otherwise. */
  readonly item?: MentionSearchResultItem;
}

/** Where a merged item came from: the server, the local lane, or both (the local title and icon win). */
export type MentionItemSource = 'server' | 'local' | 'both';

/** One item of a merged section (the contract's `merge::MergedItem`). */
export interface MentionMergedItem<Icon = unknown> {
  readonly key: string;
  /** What the picker shows: the title, a person's name, or their address when the name is blank. */
  readonly title: string;
  /** The local icon, else the server's (an object as servers type it; no server sets one yet). */
  readonly icon: Icon | NonNullable<MentionSearchResultItem['icon']> | null;
  readonly source: MentionItemSource;
  /** A local-only item created or renamed in the last 15 minutes, which the index may not hold yet. */
  readonly fresh: boolean;
  /** The server's item, when it sent one: its payload is what the picker inserts. */
  readonly serverItem?: MentionSearchResultItem;
  readonly localItem?: MentionLocalItem<Icon>;
}

/** One merged section. Status and message are the server's; a section only local items fill is `ok`. */
export interface MentionMergedSection<Icon = unknown> {
  readonly kind: MentionSearchSectionKind;
  readonly status: string;
  readonly message?: string;
  readonly items: MentionMergedItem<Icon>[];
  /** The server's section, absent for one only local items fill. */
  readonly serverSection?: MentionSearchSection;
}

/** The picker's request before the lanes split it: its query, limit, kinds and filter apply. */
export interface MentionMergeRequest extends MentionPickRequest {
  query?: string;
  limit?: number;
}

export interface MentionMergeInput<Icon = unknown> {
  request: MentionMergeRequest;
  /**
   * The server's answer, combined across lanes (the picker's `mergeMentionSearchResponses`, or
   * {@link combineMentionLaneAnswers}), or its sections.
   */
  server: MentionSearchResponse | readonly MentionSearchSection[];
  local: readonly MentionLocalItem<Icon>[];
  /** Pick memory's scores for the typed query, by navigation key. */
  picks?: ReadonlyMap<string, MentionPickScore>;
  /**
   * Navigation keys the client knows are present without a local item for them, such as a
   * collaborator on the page whom the roster does not list yet. A local item's own `present` counts
   * too.
   */
  present?: ReadonlySet<string>;
  /** The requester's person id: the requester comes last in their class. */
  requesterPersonId?: string;
  /** The clock, in epoch milliseconds. */
  nowMs: number;
  /**
   * Whether a typed query's section of `kind`, holding items with `keys`, is ranked by the client
   * ranking. The contract ranks People, Pages, Databases and Database rows; a section the picker
   * keeps in the server's order lists its local-only items after the server's, ranked among
   * themselves. Dates, Links and Suggested always keep the server's order.
   */
  rank?: (kind: MentionSearchSectionKind, keys: readonly string[]) => boolean;
  /**
   * The most items a section keeps, after ranking, given how many items the server listed in it:
   * the request's normalized limit by default, as in the contract.
   */
  limit?: (kind: MentionSearchSectionKind, serverItems: number) => number;
}

/** A request's limit as Cloud reads it: 8 when absent or not positive, at most 20. */
export function mentionNormalizedLimit(limit: number | undefined): number {
  return limit !== undefined && limit > 0 ? Math.min(Math.floor(limit), MENTION_MAX_LIMIT) : MENTION_DEFAULT_LIMIT;
}

const STATUS_SEVERITY: Record<string, number> = { ok: 0, partial: 1, failed: 2 };

function worseStatus(left: string, right: string): string {
  return (STATUS_SEVERITY[right] ?? 0) > (STATUS_SEVERITY[left] ?? 0) ? right : left;
}

function bySectionOrder(left: { kind: MentionSearchSectionKind }, right: { kind: MentionSearchSectionKind }) {
  return mentionSectionOrder(left.kind) - mentionSectionOrder(right.kind);
}

/**
 * A typed query's primary and rows answers as one answer (`combine_lane_answers`, D17): the rows
 * answer's items follow the primary's own in a section of the same kind (Search returns rows in
 * Pages), a key the primary answer holds stays where it put it, and a section kind the primary
 * answer lacks is added. A section takes the worse status (failed, then partial, then ok) and the
 * primary's message, else the rows answer's; the answer is `partial` when either is. The contract's
 * port, pinned by `merge.json`; no picker calls it yet (see the module header).
 */
export function combineMentionLaneAnswers(
  primary: MentionSearchResponse,
  rows: MentionSearchResponse
): MentionSearchResponse {
  const sections = primary.sections.map((section) => ({ ...section, items: [...section.items] }));

  rows.sections.forEach((section) => {
    const existing = sections.find((found) => found.kind === section.kind);

    if (!existing) {
      sections.push({ ...section, items: [...section.items] });
      return;
    }

    const keys = new Set(existing.items.map(mentionItemNavKey));

    section.items.forEach((item) => {
      const key = mentionItemNavKey(item);

      if (keys.has(key)) return;
      keys.add(key);
      existing.items.push(item);
    });
    existing.status = worseStatus(existing.status, section.status);
    existing.has_more = existing.has_more || section.has_more;
    existing.message ??= section.message;
  });

  // A stable sort keeps each answer's order, which already is the canonical one.
  sections.sort(bySectionOrder);
  return { sections, partial: Boolean(primary.partial) || Boolean(rows.partial) };
}

interface Entry<Icon> {
  key: string;
  server?: { rank: number; item: MentionSearchResultItem };
  local?: MentionLocalItem<Icon>;
}

interface BuildingSection<Icon> {
  kind: MentionSearchSectionKind;
  status: string;
  message?: string;
  serverSection?: MentionSearchSection;
  entries: Entry<Icon>[];
}

interface EntryCandidate<Icon> extends MentionRankCandidate {
  readonly entry: Entry<Icon>;
}

/** `local`, or `server` when `local` holds only Unicode White_Space. */
function localUnlessBlank(local: string, server: string): string {
  return isMentionBlankText(local) ? server : local;
}

/**
 * A server item's title and, for a person, address. Cloud titles a person whose name is blank by
 * their address and sends the address as the subtitle; such a name is blank here too, so the domain
 * never matches as a name.
 */
function serverText(item: MentionSearchResultItem): [string, string] {
  if (item.kind !== MentionTargetKind.Person) return [item.title, ''];

  const email = item.subtitle ?? '';

  return [item.title === email ? '' : item.title, email];
}

/**
 * The title, or a person's name, and the person's address that an entry is ranked and shown by. An
 * object takes the local title when the client has the item; a person the local name and address,
 * each replaced by the server's when it is blank.
 */
function entryText<Icon>({ key, server, local }: Entry<Icon>): [string, string] {
  const fromServer = server ? serverText(server.item) : undefined;

  if (local && fromServer && key.startsWith('person:')) {
    return [localUnlessBlank(local.title, fromServer[0]), localUnlessBlank(local.email ?? '', fromServer[1])];
  }

  if (local) return [local.title, local.email ?? ''];
  return fromServer ?? ['', ''];
}

/** What the picker shows for an item: its title, or the address of a person whose name is blank. */
export function mentionShownText(title: string, email: string): string {
  return isMentionBlankText(title) && email ? email : title;
}

function laneOf(key: string): MentionRankLane {
  return key.startsWith('person:') ? 'people' : 'objects';
}

/** Whether a local-only item matches the typed query, which ranking requires of it. */
function localItemMatches<Icon>(query: MentionQuery, item: MentionLocalItem<Icon>): boolean {
  return laneOf(item.key) === 'people'
    ? personTier(query, item.title, item.email ?? '') !== undefined
    : objectTier(query, item.title) !== undefined;
}

function mergedItem<Icon>(nowMs: number, entry: Entry<Icon>): MentionMergedItem<Icon> {
  const { key, server, local } = entry;
  const [name, email] = entryText(entry);
  const source: MentionItemSource = local ? (server ? 'both' : 'local') : 'server';
  // A time ahead of the clock, from a clock that stepped back, counts as now.
  const fresh = source === 'local' && local?.changedMs !== undefined && nowMs - local.changedMs <= MENTION_FRESH_MS;

  return {
    key,
    title: mentionShownText(name, email),
    icon: (local ? local.icon ?? server?.item.icon : server?.item.icon) ?? null,
    source,
    fresh,
    serverItem: server?.item,
    localItem: local,
  };
}

const CONTRACT_RANKS_EVERY_SECTION = () => true;

/**
 * Merges a server answer with the local lane by navigation key (`merge_sections`; see the module
 * header). A key that appears in two sections stays only in the first; sections follow the
 * canonical order, and a section only local items fill takes its place in it. A failed section
 * keeps its status and message, so the picker can show local results next to its retry.
 */
export function mergeMentionSections<Icon = unknown>(input: MentionMergeInput<Icon>): MentionMergedSection<Icon>[] {
  const { request, local, nowMs } = input;
  const query = request.query ?? '';
  const prepared = prepareMentionQuery(query);
  const typed = !isMentionBlankText(query);
  const serverSections = Array.isArray(input.server)
    ? (input.server as readonly MentionSearchSection[])
    : (input.server as MentionSearchResponse).sections;
  const defaultLimit = mentionNormalizedLimit(request.limit);
  const limitOf = input.limit ?? (() => defaultLimit);
  const ranks = input.rank ?? CONTRACT_RANKS_EVERY_SECTION;
  const requesterKey = input.requesterPersonId ? `person:${input.requesterPersonId.toLowerCase()}` : undefined;
  const localByKey = new Map<string, MentionLocalItem<Icon>>();

  local.forEach((item) => {
    if (!localByKey.has(item.key)) localByKey.set(item.key, item);
  });

  const placed = new Set<string>();
  const sections: BuildingSection<Icon>[] = serverSections.map((section) => {
    const entries: Entry<Icon>[] = [];

    section.items.forEach((item, rank) => {
      const key = mentionItemNavKey(item);

      if (placed.has(key)) return;
      placed.add(key);
      entries.push({ key, server: { rank, item }, local: localByKey.get(key) });
    });

    return { kind: section.kind, status: section.status, message: section.message, serverSection: section, entries };
  });

  if (typed) {
    // Each key once, its first item (the contract places the first item that passes the request's
    // kinds and filter, which depend on the key alone). Ranking drops a local-only item that does not
    // match, so the cheap match comes first: a typed query matches few of a large lane's titles.
    localByKey.forEach((item, key) => {
      if (placed.has(key) || !localItemMatches(prepared, item)) return;

      const kind = mentionLocalItemSection(request, key);

      if (!kind) return;
      placed.add(key);

      const entry: Entry<Icon> = { key, local: item };
      const section = sections.find((found) => found.kind === kind);

      if (section) section.entries.push(entry);
      else sections.push({ kind, status: 'ok', entries: [entry] });
    });
  }

  const candidate = (entry: Entry<Icon>): EntryCandidate<Icon> => {
    const [title, email] = entryText(entry);
    const pick = input.picks?.get(entry.key);

    return {
      key: entry.key,
      title,
      email,
      adaptive: pick?.adaptive,
      lift: pick?.lift,
      present: Boolean(entry.local?.present) || Boolean(input.present?.has(entry.key)),
      lastUsedMs: entry.local?.lastUsedMs,
      serverRank: entry.server?.rank,
      requester: requesterKey !== undefined && entry.key.toLowerCase() === requesterKey,
      entry,
    };
  };

  const sectionItems = (section: BuildingSection<Icon>): Entry<Icon>[] => {
    const { kind, entries } = section;
    const lane = mentionSectionRankLane(kind);
    const limit = limitOf(kind, entries.filter((entry) => entry.server).length);

    if (!typed || !lane) return entries.slice(0, limit);

    if (
      ranks(
        kind,
        entries.map((entry) => entry.key)
      )
    ) {
      return rankSection(prepared, lane, entries.map(candidate), nowMs, limit).map((ranked) => ranked.entry);
    }

    // The server's order, then the local-only items, ranked among themselves.
    const localOnly = entries.filter((entry) => !entry.server).map(candidate);
    const ranked = rankSection(prepared, lane, localOnly, nowMs).map((entry) => entry.entry);

    return [...entries.filter((entry) => entry.server), ...ranked].slice(0, limit);
  };

  // A stable sort keeps the server's order, which already is the canonical one.
  sections.sort(bySectionOrder);

  return sections.flatMap((section) => {
    const items = sectionItems(section).map((entry) => mergedItem(nowMs, entry));

    if (!section.serverSection && items.length === 0) return [];
    return [
      {
        kind: section.kind,
        status: section.status,
        message: section.message,
        items,
        serverSection: section.serverSection,
      },
    ];
  });
}

const UNKNOWN_VIEW_DATABASE_KEY = /^database:([^:]+):-$/;

/** Whether `key` names a database whose view is not known (`database:<id>:-`). */
export function isMentionUnknownViewDatabaseKey(key: string): boolean {
  return UNKNOWN_VIEW_DATABASE_KEY.test(key);
}

/**
 * `local` with each database whose view the client does not know (`database:<id>:-`, as one this
 * tab just created until the outline lists its views) keyed as `sections` list that database, so
 * the two merge as one item: databases dedupe by database id when one side lacks the view. A
 * database the sections list under several views takes the first. The same array when no key
 * changes.
 */
export function mentionLocalItemsKeyedLike<T extends MentionLocalItem<unknown>>(
  local: readonly T[],
  sections: readonly MentionSearchSection[]
): readonly T[] {
  if (!local.some((item) => UNKNOWN_VIEW_DATABASE_KEY.test(item.key))) return local;

  const listedKeys = new Map<string, string>();

  sections.forEach((section) =>
    section.items.forEach((item) => {
      if (item.kind !== MentionTargetKind.Database) return;

      const key = mentionItemNavKey(item);
      const [, databaseId] = /^database:([^:]+):/.exec(key) ?? [];

      if (databaseId && databaseId !== '-' && !listedKeys.has(databaseId)) listedKeys.set(databaseId, key);
    })
  );

  let changed = false;
  const keyed = local.map((item) => {
    const databaseId = UNKNOWN_VIEW_DATABASE_KEY.exec(item.key)?.[1];
    const key = databaseId === undefined ? undefined : listedKeys.get(databaseId);

    if (key === undefined || key === item.key) return item;
    changed = true;
    return { ...item, key };
  });

  return changed ? keyed : local;
}

/** Merged sections as the picker shows them, with the keys of their local-only and fresh items. */
export interface MentionMergedPickerSections {
  sections: MentionSearchSection[];
  /** Navigation keys of the items only the local lane listed. */
  localKeys: ReadonlySet<string>;
  /** Navigation keys of the local-only items created or renamed in the last 15 minutes. */
  freshKeys: ReadonlySet<string>;
}

/**
 * `merged` as the picker's sections: a server item keeps its payload and takes the shown title, a
 * local-only item is the local lane's item with that title, and a section only local items fill is
 * titled `sectionTitle(kind)`. A local-only item without an item to insert is left out.
 */
export function mentionMergedPickerSections<Icon>(
  merged: readonly MentionMergedSection<Icon>[],
  sectionTitle: (kind: MentionSearchSectionKind) => string
): MentionMergedPickerSections {
  const localKeys = new Set<string>();
  const freshKeys = new Set<string>();
  const sections = merged.map(({ kind, status, message, items, serverSection }) => {
    const pickerItems = items.flatMap((merged) => {
      const item = merged.serverItem ?? merged.localItem?.item;

      if (!item) return [];
      if (merged.source === 'local') localKeys.add(merged.key);
      if (merged.fresh) freshKeys.add(merged.key);
      return [item.title === merged.title ? item : { ...item, title: merged.title }];
    });

    return {
      ...serverSection,
      kind,
      title: serverSection?.title ?? sectionTitle(kind),
      items: pickerItems,
      has_more: serverSection?.has_more ?? false,
      status,
      message,
    };
  });

  return { sections, localKeys, freshKeys };
}
