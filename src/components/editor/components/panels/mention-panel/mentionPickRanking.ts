/**
 * Pick memory applied to the answer the picker shows for a typed query (MEN-WEB-10).
 *
 * A section where a pick scores (People, Pages, Databases, Database rows) is ranked with the
 * typeahead contract's client ranking (`retierServerSection`): pick memory's `adaptive` is the
 * first key inside a tier, and the entry for exactly the typed input lifts an item one tier, never
 * more. A section no pick scores keeps the server's order, so the picker changes only where the
 * memory has something to say. With the picker's `mentionTypeaheadV2` on, MEN-WEB-08 re-tiers every
 * typed answer's People, Pages and Database rows too (`retierKinds`), with or without pick memory.
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

/** The local index's view under navigation key `key`, from the maps built once per snapshot. */
export function mentionLocalViewOfKey(snapshot: MentionLocalSnapshot, key: string): MentionLocalView | undefined {
  return keysOf(snapshot).views.get(key);
}

/** The local index's roster member with `personId`, from the maps built once per snapshot. */
export function mentionLocalPersonOfId(snapshot: MentionLocalSnapshot, personId: string): MentionablePerson | undefined {
  return keysOf(snapshot).people.get(personId);
}

/**
 * A local index view as the server would list it: a page, or a database by its database and the
 * view Search answers for it. A database whose answered view the index does not know yet (one this
 * tab just created, or a container whose children the outline has not loaded) names the view the
 * index lists it by, which the app opens, as its `object_id`: the picker inserts a database as a
 * page reference to `database_view_id || object_id`, and a database id there opens nothing in any
 * client. Its key stays `database:<id>:-`, since the payload names the database. `undefined` for a
 * database whose database id the index does not know.
 */
export function mentionLocalViewItem(view: MentionLocalView): MentionSearchResultItem | undefined {
  if (view.navKey.startsWith('database:')) {
    if (!view.databaseId) return undefined;

    return {
      kind: MentionTargetKind.Database,
      object_id: view.databaseViewId ? view.databaseId : view.viewId,
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
 * A roster member as the server would list them: titled and named by name, or by address when the
 * name is blank (decision D21, Cloud's `person_mention_item`), with the address as the subtitle. The
 * picker fills the page on insertion.
 */
export function mentionLocalPersonItem(person: MentionablePerson): MentionSearchResultItem {
  const name = person.name ?? '';
  const title = isMentionBlankText(name) && person.email ? person.email : name;

  return {
    kind: MentionTargetKind.Person,
    object_id: person.person_id,
    title,
    subtitle: person.email || undefined,
    mention: { type: MentionTargetKind.Person, person_id: person.person_id, person_name: title, page_id: '' },
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

    return person ? mentionLocalPersonItem(person) : undefined;
  }

  if (!key.startsWith('page:') && !key.startsWith('database:')) return undefined;

  const view = keysOf(snapshot).views.get(key);

  return view ? mentionLocalViewItem(view) : undefined;
}

/**
 * Whether the local index's view for navigation key `key` is one of `viewIds` or lies below one,
 * as far as the index knows the views above it: the parents that the outline, the recent views and
 * this tab's creations give, followed up to the first parent the index does not list. The pages
 * below a page inherit its access, while the app names only the page whose share changed; one with
 * access of its own still shows when the server's answer lists it. A database starts from the view
 * the index lists it by, a container included, which its item may not show. `false` for people,
 * rows and keys the index does not hold.
 */
export function mentionLocalPickUnderAnyView(
  snapshot: MentionLocalSnapshot,
  key: string,
  viewIds: ReadonlySet<string>
): boolean {
  if (viewIds.size === 0) return false;

  const followed = new Set<string>();
  let viewId = keysOf(snapshot).views.get(key)?.viewId;

  // Parents that lead back to a view already followed end the walk.
  while (viewId !== undefined && !followed.has(viewId)) {
    if (viewIds.has(viewId)) return true;
    followed.add(viewId);
    viewId = snapshot.viewsById.get(viewId)?.parentViewId;
  }

  return false;
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
  /**
   * The local index's item for a picked navigation key the answer lacks, or `undefined` when none
   * may join: the index does not hold it, or the user lost access to it or to a view above it
   * ({@link mentionLocalPickUnderAnyView}).
   */
  localItem?: (key: string) => MentionSearchResultItem | undefined;
  /** The title of a section only picked local items fill. */
  sectionTitle: (kind: MentionSearchSectionKind) => string;
  /** The clock in epoch milliseconds. */
  nowMs: number;
  /**
   * Section kinds ranked by the client ranking even where no pick scores, as the picker's
   * `mentionTypeaheadV2` re-tiers every typed answer (MEN-WEB-08). Other kinds keep the server's
   * order unless a pick scores in them.
   */
  retierKinds?: ReadonlySet<MentionSearchSectionKind>;
}

export interface MentionSectionsByPicks {
  /** `sections` itself when no pick scores, else the sections with their new order. */
  sections: MentionSearchSection[];
  /** Navigation keys of the picked targets the local index added. */
  localKeys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The client's signals for an item by its navigation key: pick memory's `adaptive` and `lift` from
 * `scores`, and whether the person is the requester, who stays last in their class (D10).
 */
export function mentionPickSignals(
  scores: ReadonlyMap<string, MentionPickScore>,
  requesterPersonId: string | undefined
): (key: string) => MentionRankSignals | undefined {
  const requesterKey = requesterPersonId ? `person:${requesterPersonId.toLowerCase()}` : undefined;

  return (key) => {
    const score = scores.get(key);
    const requester = requesterKey !== undefined && key.toLowerCase() === requesterKey;

    return score || requester ? { adaptive: score?.adaptive, lift: score?.lift, requester } : undefined;
  };
}

/**
 * `sections` ordered by pick memory (see the module header): each section with a scored item, or a
 * picked target that joins, or of one of `retierKinds`, ranked by the contract's client ranking;
 * the others as they are. A bare query, or a query no pick scores without `retierKinds`, returns
 * `sections` itself.
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
  retierKinds,
}: RankMentionSectionsByPicksInput): MentionSectionsByPicks {
  if (scores.size === 0 && !retierKinds?.size) return { sections, localKeys: NO_KEYS };

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

  const signals = mentionPickSignals(scores, requesterPersonId);

  function rank(section: MentionSearchSection, localItems: MentionSearchResultItem[] = []) {
    return retierServerSection(query, section, { nowMs, signals, localItems });
  }

  const ranked = sections.map((section) => {
    const localItems = joining.get(section.kind);

    joining.delete(section.kind);
    if (!mentionSectionRankLane(section.kind)) return section;
    if (
      !localItems &&
      !retierKinds?.has(section.kind) &&
      !section.items.some((item) => scores.has(mentionItemNavKey(item)))
    ) {
      return section;
    }

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
