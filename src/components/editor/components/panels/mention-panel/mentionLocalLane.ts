/**
 * The editor @ picker's local lane (MEN-WEB-09), behind its `mentionTypeaheadV2` switch
 * (`mentionTypeaheadFlag.ts`): the candidates this tab holds without asking the server, as the
 * typeahead contract's merge takes them (`mentionLocalMerge.ts`).
 *
 * - {@link buildMentionLocalLane}: the local index's pages and databases (MEN-WEB-07) and its roster.
 *   Each carries what the server's item would carry, so inserting it writes the same mention, and the
 *   client's own signals: when this tab created or renamed it (`fresh` within 15 minutes), when the
 *   user last opened, created or mentioned it (the recency bucket of the contract's in-tier keys),
 *   and, for people, whether they are on the page (awareness). A view the user lost access to in this
 *   session is left out, and so is every view below it as far as the index knows their parents.
 * - {@link patchMentionBareSections}: the bare `@` patch. Another Cloud replica can serve a bare
 *   answer that is up to a minute old, and Cloud never lists a page that was created but not opened,
 *   so the pages and databases this tab opened or created since the answer's cutoff come first,
 *   newest first; then the people this tab picked, the most recent first, then up to three people on
 *   the page, then the server's order. The requester stays where the server puts them, last.
 * - This tab's person picks ({@link recordMentionSessionPersonPick}), kept in memory per workspace
 *   until the session ends.
 *
 * Nothing here depends on React or the network.
 */
import { resolveMentionablePersonIds } from '@/application/comment-mention-ranking';
import { EventType, on } from '@/application/session/event';
import {
  MentionablePerson,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  ViewIcon,
} from '@/application/types';
import { compareCodePoints } from '@/utils/normalize-text';

import { MENTION_FRESH_MS, MentionLocalItem } from './mentionLocalMerge';
import {
  mentionLocalItemSection,
  mentionLocalPersonItem,
  mentionLocalPickUnderAnyView,
  mentionLocalViewItem,
  MentionPickRequest,
} from './mentionPickRanking';
import { mentionItemShowsAnyView } from './mentionSearchCache';
import { mentionItemNavKey, mentionSectionOrder } from './mentionUtils';

import type { MentionLocalSnapshot } from './mentionLocalIndex';

/**
 * How old a bare answer can be when it arrives: Cloud keeps a bare answer for 30 s per process, built
 * from a working set it keeps for 30 s, and another replica learns of an open only through them.
 * This tab's opens and creations from that long before an answer arrived come first in it.
 */
export const MENTION_BARE_REPLICA_STALE_MS = 60_000;
/** At most this many people on the page come first in a bare answer, after this tab's picks. */
export const MENTION_BARE_PRESENT_LIFT = 3;
/** This tab's person picks kept per workspace, the oldest dropped first. */
export const MENTION_SESSION_PICK_LIMIT = 20;

/** A local lane candidate: the contract's local item with what the picker inserts for it. */
export interface MentionLaneItem extends MentionLocalItem<ViewIcon> {
  readonly item: MentionSearchResultItem;
  /** When this tab last opened or created the view, for the bare `@` patch. */
  readonly tabUsedMs?: number;
}

export interface MentionLocalLaneInput {
  snapshot: MentionLocalSnapshot;
  /** People on the page, by person id. */
  presentPersonIds?: ReadonlySet<string>;
  /** Views the user lost access to in this session: they and the views below them stay out. */
  revokedViews?: ReadonlySet<string>;
  /** This tab's person picks: person id to when ({@link getMentionSessionPersonPicks}). */
  personPicks?: ReadonlyMap<string, number>;
}

const NO_IDS: ReadonlySet<string> = new Set();
const NO_PICKS: ReadonlyMap<string, number> = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The person ids of the people on the page, from the ids awareness names them by
 * (`usePresentPersonIds`): a person id or a Desktop uid, resolved through `roster`, or a person id
 * the roster does not list yet, lowercased. The requester, by person id or uid, is left out.
 */
export function mentionPresentPersonIds(
  roster: readonly MentionablePerson[],
  ids: ReadonlySet<string>,
  requester?: { uuid?: string | null; uid?: string | null }
): ReadonlySet<string> {
  if (ids.size === 0) return NO_IDS;

  const present = new Set<string>();
  const requesterIds = new Set([requester?.uuid, requester?.uid].flatMap((id) => (id ? [id.toLowerCase()] : [])));

  ids.forEach((id) => {
    if (requesterIds.has(id.toLowerCase())) return;

    const [personId] = resolveMentionablePersonIds(roster, [id]);
    const resolved = personId ?? (UUID.test(id) ? id.toLowerCase() : undefined);

    if (resolved && !requesterIds.has(resolved.toLowerCase())) present.add(resolved);
  });

  return present.size > 0 ? present : NO_IDS;
}

function latest(...times: (number | undefined)[]): number | undefined {
  let found: number | undefined;

  times.forEach((time) => {
    if (time !== undefined && !Number.isNaN(time) && (found === undefined || time > found)) found = time;
  });
  return found;
}

function parseTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;

  const time = Date.parse(value);

  return Number.isNaN(time) ? undefined : time;
}

/**
 * The local lane for one snapshot (see the module header): the views first, in the index's order,
 * then the roster, each navigation key once. A database whose database id the index does not know,
 * and a person without a person id, are left out.
 */
export function buildMentionLocalLane({
  snapshot,
  presentPersonIds = NO_IDS,
  revokedViews = NO_IDS,
  personPicks = NO_PICKS,
}: MentionLocalLaneInput): MentionLaneItem[] {
  const lane: MentionLaneItem[] = [];
  const keys = new Set<string>();

  snapshot.views.forEach((view) => {
    if (keys.has(view.navKey)) return;

    const item = mentionLocalViewItem(view);

    if (!item) return;
    if (
      revokedViews.size > 0 &&
      (mentionItemShowsAnyView(item, revokedViews) || mentionLocalPickUnderAnyView(snapshot, view.navKey, revokedViews))
    ) {
      return;
    }

    const tabUsedMs = latest(view.sessionOpenedAt, view.sessionCreatedAt);

    keys.add(view.navKey);
    lane.push({
      key: view.navKey,
      title: view.name,
      icon: view.icon,
      changedMs: latest(view.sessionCreatedAt, view.sessionRenamedAt),
      lastUsedMs: latest(tabUsedMs, view.lastViewedAt),
      tabUsedMs,
      item,
    });
  });

  snapshot.people.forEach((person: MentionablePerson) => {
    const key = `person:${person.person_id}`;

    if (!person.person_id || keys.has(key)) return;
    keys.add(key);
    lane.push({
      key,
      title: person.name ?? '',
      email: person.email ?? '',
      icon: null,
      lastUsedMs: latest(personPicks.get(person.person_id), parseTime(person.last_mentioned_at)),
      present: presentPersonIds.has(person.person_id),
      item: mentionLocalPersonItem(person),
    });
  });

  return lane;
}

// This tab's person picks by workspace, each map replaced on a pick so readers see a new one.
const sessionPersonPicks = new Map<string, ReadonlyMap<string, number>>();

/** The user inserted a mention of `personId` in `workspaceId`; the bare `@` lists them first. */
export function recordMentionSessionPersonPick(workspaceId: string | undefined, personId: string, at = Date.now()) {
  if (!workspaceId || !personId) return;

  const picks = new Map(sessionPersonPicks.get(workspaceId) ?? NO_PICKS);

  picks.delete(personId);
  picks.set(personId, at);
  if (picks.size > MENTION_SESSION_PICK_LIMIT) {
    const oldest = picks.keys().next().value;

    if (oldest !== undefined) picks.delete(oldest);
  }

  sessionPersonPicks.set(workspaceId, picks);
}

/** This tab's person picks in `workspaceId`: person id to when, the oldest first. A new map after each pick. */
export function getMentionSessionPersonPicks(workspaceId: string | undefined): ReadonlyMap<string, number> {
  return (workspaceId && sessionPersonPicks.get(workspaceId)) || NO_PICKS;
}

/** Forgets every tab pick: the session ended, or a test starts. */
export function clearMentionSessionPersonPicks() {
  sessionPersonPicks.clear();
}

// The picks are the signed-in account's. Sign-out emits this too.
on(EventType.SESSION_INVALID, clearMentionSessionPersonPicks);

export interface MentionBarePatchInput {
  /** The bare answer as the picker shows it, with the local titles merged in. */
  sections: MentionSearchSection[];
  lane: readonly MentionLaneItem[];
  /**
   * This tab's opens and creations at or after this time come first: the answer's arrival less
   * {@link MENTION_BARE_REPLICA_STALE_MS}. Unset when there is no answer, as after a failure: then
   * every open and creation of this tab counts.
   */
  liftAfterMs?: number;
  /** This tab's person picks: person id to when. */
  personPicks: ReadonlyMap<string, number>;
  /** People on the page, by person id. */
  presentPersonIds: ReadonlySet<string>;
  /** The requester's person id: they are never lifted. */
  requesterPersonId?: string;
  /** Which kinds the picker asked for, as the merge reads it (D19). */
  request: MentionPickRequest;
  /** The fewest items a section may keep; one never drops below what the server listed. */
  limit: number;
  /** The title of a section the server did not list. */
  sectionTitle: (kind: MentionSearchSectionKind) => string;
  /** The clock, in epoch milliseconds, for the fresh flag. */
  nowMs: number;
}

export interface MentionBarePatch {
  sections: MentionSearchSection[];
  /** Navigation keys of the lifted items the server's answer did not list. */
  localKeys: ReadonlySet<string>;
  /** Those of them this tab created or renamed in the last 15 minutes. */
  freshKeys: ReadonlySet<string>;
}

/** The order people on the page come in: as the server lists them, then by name. */
function presentOrder(
  sections: MentionSearchSection[],
  lane: ReadonlyMap<string, MentionLaneItem>,
  ids: ReadonlySet<string>
) {
  const listed = new Map<string, number>();

  sections
    .find((section) => section.kind === MentionSearchSectionKind.People)
    ?.items.forEach((item, index) => listed.set(mentionItemNavKey(item), index));

  return [...ids]
    .map((id) => `person:${id}`)
    .sort((left, right) => {
      const leftAt = listed.get(left);
      const rightAt = listed.get(right);

      if (leftAt !== undefined || rightAt !== undefined) {
        return (leftAt ?? Number.MAX_SAFE_INTEGER) - (rightAt ?? Number.MAX_SAFE_INTEGER);
      }

      return compareCodePoints(lane.get(left)?.item.title ?? left, lane.get(right)?.item.title ?? right);
    });
}

/**
 * The bare `@` answer with this tab's recent activity first (see the module header). Each lifted
 * item is the server's own when its section lists it, moved to the top, else the local lane's. A
 * section the server did not list is added in its canonical place when something is lifted into it.
 * Returns `sections` itself when nothing is lifted.
 */
export function patchMentionBareSections({
  sections,
  lane,
  liftAfterMs,
  personPicks,
  presentPersonIds,
  requesterPersonId,
  request,
  limit,
  sectionTitle,
  nowMs,
}: MentionBarePatchInput): MentionBarePatch {
  const laneByKey = new Map(lane.map((entry) => [entry.key, entry]));
  const requesterKey = requesterPersonId ? `person:${requesterPersonId.toLowerCase()}` : undefined;
  const isRequester = (key: string) => requesterKey !== undefined && key.toLowerCase() === requesterKey;
  const lifted = new Map<MentionSearchSectionKind, string[]>();
  const lift = (key: string) => {
    const kind = mentionLocalItemSection(request, key);

    if (!kind || isRequester(key)) return;

    const keys = lifted.get(kind) ?? [];

    if (!keys.includes(key)) keys.push(key);
    lifted.set(kind, keys);
  };

  // Pages and databases this tab opened or created, the most recent first.
  lane
    .filter(
      (entry) =>
        entry.tabUsedMs !== undefined &&
        (liftAfterMs === undefined || entry.tabUsedMs >= liftAfterMs) &&
        !entry.key.startsWith('person:')
    )
    .sort((left, right) => (right.tabUsedMs ?? 0) - (left.tabUsedMs ?? 0) || compareCodePoints(left.key, right.key))
    .forEach((entry) => lift(entry.key));

  // People: this tab's picks, the most recent first, then up to three people on the page.
  [...personPicks.entries()]
    .sort(([leftId, leftAt], [rightId, rightAt]) => rightAt - leftAt || compareCodePoints(leftId, rightId))
    .forEach(([personId]) => lift(`person:${personId}`));

  const picked = new Set(lifted.get(MentionSearchSectionKind.People) ?? []);

  presentOrder(sections, laneByKey, presentPersonIds)
    .filter((key) => !picked.has(key) && !isRequester(key))
    .slice(0, MENTION_BARE_PRESENT_LIFT)
    .forEach(lift);

  if (lifted.size === 0) return { sections, localKeys: NO_IDS, freshKeys: NO_IDS };

  const localKeys = new Set<string>();
  const freshKeys = new Set<string>();
  const patched = [...sections];

  lifted.forEach((keys, kind) => {
    const index = patched.findIndex((section) => section.kind === kind);
    const existing = index === -1 ? undefined : patched[index];
    const listed = new Map(existing?.items.map((item) => [mentionItemNavKey(item), item]));
    const items = keys.flatMap((key) => {
      const entry = laneByKey.get(key);
      const item = listed.get(key) ?? entry?.item;

      if (!item) return [];
      if (!listed.has(key)) {
        localKeys.add(key);
        if (entry?.changedMs !== undefined && nowMs - entry.changedMs <= MENTION_FRESH_MS) freshKeys.add(key);
      }

      return [item];
    });

    if (items.length === 0) return;

    const liftedKeys = new Set(keys);
    const rest = existing?.items.filter((item) => !liftedKeys.has(mentionItemNavKey(item))) ?? [];
    const section: MentionSearchSection = {
      ...(existing ?? { kind, title: sectionTitle(kind), has_more: false, status: 'ok' }),
      items: [...items, ...rest].slice(0, Math.max(limit, existing?.items.length ?? 0)),
    };

    if (existing) {
      patched[index] = section;
      return;
    }

    const at = patched.findIndex((found) => mentionSectionOrder(found.kind) > mentionSectionOrder(kind));

    patched.splice(at === -1 ? patched.length : at, 0, section);
  });

  return { sections: patched, localKeys, freshKeys };
}
