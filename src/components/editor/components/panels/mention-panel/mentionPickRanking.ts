/**
 * Pick memory applied to the answer the picker shows for a typed query (MEN-WEB-10).
 *
 * A section where a pick scores (People, Pages, Databases, Database rows) is ranked with the
 * typeahead contract's client ranking (`retierServerSection`): pick memory's `adaptive` is the
 * first key inside a tier, and the entry for exactly the typed input lifts an item one tier, never
 * more. A section no pick scores keeps the server's order, so the picker changes only where the
 * memory has something to say; MEN-WEB-08 re-tiers every typed answer.
 *
 * A picked target the answer lacks (the index has not caught up with a rename, or the server's
 * window missed it) joins from the local index (MEN-WEB-07), as the contract's merge adds a
 * local-only item: when the server could have returned it for the picker's request (decision D19:
 * the picker asked for its kind, and it passes the request's filter as Search applies it) and its
 * current title or name still matches the query at C3 or T3 or better, so a target renamed away is
 * never brought back. It joins the section of its kind, which is created when the answer has none.
 * The local index holds pages, databases and people; rows, which would join Pages, it does not
 * (D16).
 *
 * Nothing here depends on React.
 */
import {
  MentionablePerson,
  MentionSearchFilter,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';
import { isMentionBlankText } from '@/utils/normalize-text';

import { MentionRankSignals, mentionSectionRankLane, retierServerSection } from './mentionLocalRanker';
import { mentionItemNavKey, mentionSectionOrder } from './mentionUtils';

import type { MentionLocalSnapshot, MentionLocalView } from './mentionLocalIndex';
import type { MentionPickScore } from './mentionPickMemory';

/** The picker's request, before the lanes split it: an empty or absent `include` asks for every kind. */
export interface MentionPickRequest {
  include?: readonly MentionTargetKind[];
  filter?: MentionSearchFilter;
}

const NAV_KEY = /^(person|page|database|row):([^:]+)(?::([^:]+))?$/;

function includes(request: MentionPickRequest, kind: MentionTargetKind): boolean {
  const include = request.include ?? [];

  return include.length === 0 || include.includes(kind);
}

function lowercased(ids: readonly string[] | undefined): string[] {
  return (ids ?? []).map((id) => id.toLowerCase());
}

/**
 * The section a local-only item with navigation key `key` joins, or `undefined` when the server
 * could not have returned it for `request` (the contract's `merge::local_section`, decision D19).
 * The picker must ask for its kind, and it must pass the filter as Search applies it: a filter
 * that names any database, view or row admits no page; a database passes when the filter names no
 * rows and names its database and its view wherever it names any; a row passes when the filter
 * names its database and its row wherever it names any, and names no view, since a row's key holds
 * none. People ignore the filter, as Cloud does. Rows join Pages, where Search returns them, and
 * dates, reminders and links never join.
 */
export function mentionLocalItemSection(request: MentionPickRequest, key: string): MentionSearchSectionKind | undefined {
  const match = NAV_KEY.exec(key);

  if (!match) return undefined;

  const [, kind, first, second] = match;
  const databaseIds = lowercased(request.filter?.database_ids);
  const viewIds = lowercased(request.filter?.database_view_ids);
  const rowIds = lowercased(request.filter?.database_row_ids);
  const named = (ids: string[], id: string) => ids.length === 0 || ids.includes(id.toLowerCase());

  switch (kind) {
    case 'person':
      return second === undefined && includes(request, MentionTargetKind.Person)
        ? MentionSearchSectionKind.People
        : undefined;
    case 'page':
      return second === undefined &&
        includes(request, MentionTargetKind.Page) &&
        databaseIds.length === 0 &&
        viewIds.length === 0 &&
        rowIds.length === 0
        ? MentionSearchSectionKind.Pages
        : undefined;
    case 'database':
      return second !== undefined &&
        includes(request, MentionTargetKind.Database) &&
        rowIds.length === 0 &&
        named(databaseIds, first) &&
        (viewIds.length === 0 || (second !== '-' && viewIds.includes(second.toLowerCase())))
        ? MentionSearchSectionKind.Databases
        : undefined;
    default:
      return second !== undefined &&
        includes(request, MentionTargetKind.DatabaseRow) &&
        viewIds.length === 0 &&
        named(databaseIds, first) &&
        named(rowIds, second)
        ? MentionSearchSectionKind.Pages
        : undefined;
  }
}

interface LocalIndexKeys {
  views: ReadonlyMap<string, MentionLocalView>;
  people: ReadonlyMap<string, MentionablePerson>;
}

const localIndexKeys = new WeakMap<MentionLocalSnapshot, LocalIndexKeys>();

/** The snapshot's views by navigation key and its people by person id, built once per snapshot. */
function keysOf(snapshot: MentionLocalSnapshot): LocalIndexKeys {
  let keys = localIndexKeys.get(snapshot);

  if (!keys) {
    const views = new Map<string, MentionLocalView>();
    const people = new Map<string, MentionablePerson>();

    snapshot.views.forEach((view) => {
      if (!views.has(view.navKey)) views.set(view.navKey, view);
    });
    snapshot.people.forEach((person) => {
      if (person.person_id && !people.has(person.person_id)) people.set(person.person_id, person);
    });
    keys = { views, people };
    localIndexKeys.set(snapshot, keys);
  }

  return keys;
}

function localViewItem(view: MentionLocalView): MentionSearchResultItem | undefined {
  if (view.navKey.startsWith('database:')) {
    if (!view.databaseId) return undefined;

    return {
      kind: MentionTargetKind.Database,
      object_id: view.databaseId,
      title: view.name,
      database_id: view.databaseId,
      database_view_id: view.databaseViewId,
      mention: { type: MentionTargetKind.Database, database_id: view.databaseId, database_view_id: view.databaseViewId },
    };
  }

  return {
    kind: MentionTargetKind.Page,
    object_id: view.viewId,
    title: view.name,
    mention: { type: MentionTargetKind.Page, page_id: view.viewId },
  };
}

/**
 * A roster member as the server would list them: titled by name, or by address when the name is
 * blank (decision D21), with the address as the subtitle. The picker fills the page on insertion.
 */
function localPersonItem(person: MentionablePerson): MentionSearchResultItem {
  const name = person.name ?? '';

  return {
    kind: MentionTargetKind.Person,
    object_id: person.person_id,
    title: isMentionBlankText(name) && person.email ? person.email : name,
    subtitle: person.email || undefined,
    mention: { type: MentionTargetKind.Person, person_id: person.person_id, person_name: name, page_id: '' },
  };
}

/**
 * The local index's item for navigation key `key`, as the picker would show a server's: a page, a
 * database (by database and view) or a roster member. `undefined` for anything the index does not
 * hold, rows and quick picks included.
 */
export function mentionLocalPickItem(snapshot: MentionLocalSnapshot, key: string): MentionSearchResultItem | undefined {
  if (key.startsWith('person:')) {
    const person = keysOf(snapshot).people.get(key.slice('person:'.length));

    return person ? localPersonItem(person) : undefined;
  }

  if (!key.startsWith('page:') && !key.startsWith('database:')) return undefined;

  const view = keysOf(snapshot).views.get(key);

  return view ? localViewItem(view) : undefined;
}

export interface RankMentionSectionsByPicksInput {
  /** The typed query the sections answer. */
  query: string;
  sections: MentionSearchSection[];
  /** Pick memory's scores for the query (`MentionPickMemory.scores`). */
  scores: ReadonlyMap<string, MentionPickScore>;
  /** Which local items may join (D19). */
  request: MentionPickRequest;
  /** The requester's person id: the requester stays last in their class. */
  requesterPersonId?: string;
  /** The local index's item for a picked navigation key the answer lacks. */
  localItem?: (key: string) => MentionSearchResultItem | undefined;
  /** The title of a section only picked local items fill. */
  sectionTitle: (kind: MentionSearchSectionKind) => string;
  /** The clock in epoch milliseconds. */
  nowMs: number;
}

export interface MentionSectionsByPicks {
  /** `sections` itself when no pick scores, else the sections with their new order. */
  sections: MentionSearchSection[];
  /** Navigation keys of the picked targets the local index added. */
  localKeys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * `sections` ordered by pick memory (see the module header): each section with a scored item, or a
 * picked target that joins, ranked by the contract's client ranking; the others as they are. A
 * bare query, or a query no pick scores, returns `sections` itself.
 */
export function rankMentionSectionsByPicks({
  query,
  sections,
  scores,
  request,
  requesterPersonId,
  localItem,
  sectionTitle,
  nowMs,
}: RankMentionSectionsByPicksInput): MentionSectionsByPicks {
  if (scores.size === 0) return { sections, localKeys: NO_KEYS };

  const listed = new Set<string>();

  sections.forEach((section) => section.items.forEach((item) => listed.add(mentionItemNavKey(item))));

  // Picked targets the answer lacks, by the section they join.
  const joining = new Map<MentionSearchSectionKind, MentionSearchResultItem[]>();
  const joined = new Set<MentionSearchResultItem>();

  if (localItem) {
    scores.forEach((_, key) => {
      if (listed.has(key)) return;

      const kind = mentionLocalItemSection(request, key);
      const item = kind && localItem(key);

      if (!kind || !item || mentionItemNavKey(item) !== key) return;

      joining.set(kind, [...(joining.get(kind) ?? []), item]);
      joined.add(item);
    });
  }

  const requesterKey = requesterPersonId ? `person:${requesterPersonId.toLowerCase()}` : undefined;
  const signals = (key: string): MentionRankSignals | undefined => {
    const score = scores.get(key);
    const requester = requesterKey !== undefined && key.toLowerCase() === requesterKey;

    return score || requester ? { adaptive: score?.adaptive, lift: score?.lift, requester } : undefined;
  };

  function rank(section: MentionSearchSection, localItems: MentionSearchResultItem[] = []) {
    return retierServerSection(query, section, { nowMs, signals, localItems });
  }

  const ranked = sections.map((section) => {
    const localItems = joining.get(section.kind);

    joining.delete(section.kind);
    if (!mentionSectionRankLane(section.kind)) return section;
    if (!localItems && !section.items.some((item) => scores.has(mentionItemNavKey(item)))) return section;
    return rank(section, localItems);
  });

  // A section only picked targets fill takes its place in the canonical order.
  joining.forEach((localItems, kind) => {
    const section = rank({ kind, title: sectionTitle(kind), items: [], has_more: false, status: 'ok' }, localItems);

    if (section.items.length === 0) return;

    const at = ranked.findIndex((existing) => mentionSectionOrder(existing.kind) > mentionSectionOrder(kind));

    ranked.splice(at === -1 ? ranked.length : at, 0, section);
  });

  const localKeys = new Set<string>();

  ranked.forEach((section) =>
    section.items.forEach((item) => {
      if (joined.has(item)) localKeys.add(mentionItemNavKey(item));
    })
  );

  const unchanged = localKeys.size === 0 && ranked.every((section, index) => section === sections[index]);

  return { sections: unchanged ? sections : ranked, localKeys: localKeys.size === 0 ? NO_KEYS : localKeys };
}
