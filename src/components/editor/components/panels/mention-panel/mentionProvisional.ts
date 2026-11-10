/**
 * Keep-and-narrow first paint (MEN-WEB-08), behind the picker's `mentionTypeaheadV2` switch
 * (`mentionTypeaheadFlag.ts`).
 *
 * When a keystroke's answer is not cached, the picker does not blank its list while the server
 * answers. It builds provisional sections in the same render, from what it already has: the
 * sections on screen, the cached answer of the longest typed prefix of the query, and the cached
 * bare `@` answer of the same picker ({@link buildMentionProvisionalSections}). Only items that
 * still match the new query by the typeahead contract's matcher are kept:
 *
 * - pages, databases and rows whose title matches at T3 or better, and people whose name or
 *   address matches at C3 or better (`objectTier`, `personTier`). A body-only hit cannot be checked
 *   on the client, since the client holds no body text, so it waits for the server;
 * - date and reminder quick picks whose title matches at T2 or better, as Cloud matches them;
 * - no link: links derive from the query that answered them.
 *
 * An item listed by several sources is listed once, by its navigation key, with the first source's
 * body. Items keep their sources' order, so the picker can rank them as it ranks an answer. A quick
 * pick is the exception: Cloud computes its time when it answers (Today is that day, "Reminder 1
 * week" a week from then) under a key without the time, so each comes from the newest cached
 * answer that lists it, never from the list on screen, which can still show an older answer's
 * after a newer one was cached.
 *
 * Once the server answers, its answer replaces them. While a request of the answer is still
 * pending, or failed, its kinds are missing from the answer, and the provisional items of those
 * kinds stay ({@link withProvisionalItems}): the rows a slower rows request has not answered yet,
 * or the pages whose search failed, next to the "unavailable, retry" row.
 *
 * Nothing here depends on React or the network.
 */
import {
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import { MentionQuery, objectTier, personTier, prepareMentionQuery } from './mentionLocalRanker';
import {
  isCompleteMentionResponse,
  MENTION_SECTION_STATUS_FAILED,
  mentionItemNavKey,
  mentionSectionOrder,
} from './mentionUtils';

import type { MentionLaneOutcome } from './mentionSearchFetch';

/** How many shorter prefixes of a query the picker looks up in the cache, longest first. */
export const MENTION_PROVISIONAL_PREFIX_STEPS = 64;
/** The worst title tier a provisional page, database or row keeps: T3, a substring. */
export const MENTION_PROVISIONAL_OBJECT_TIER = 3;
/** The worst class a provisional person keeps: C3, the full address. */
export const MENTION_PROVISIONAL_PERSON_TIER = 3;
/** The worst title tier a provisional date or reminder keeps: T2, as Cloud matches quick picks. */
export const MENTION_PROVISIONAL_DATE_TIER = 2;

/**
 * The section a provisional item is listed in: its kind's, rows in Pages, where Search returns
 * them. `undefined` for a link, which derives from the query that answered it.
 */
export function mentionProvisionalSectionKind(kind: MentionTargetKind): MentionSearchSectionKind | undefined {
  switch (kind) {
    case MentionTargetKind.Person:
      return MentionSearchSectionKind.People;
    case MentionTargetKind.Page:
    case MentionTargetKind.DatabaseRow:
      return MentionSearchSectionKind.Pages;
    case MentionTargetKind.Database:
      return MentionSearchSectionKind.Databases;
    case MentionTargetKind.Date:
    case MentionTargetKind.Reminder:
      return MentionSearchSectionKind.Dates;
    default:
      return undefined;
  }
}

/** The kinds a section of each kind lists; a Suggested section lists no kind of its own. */
const SECTION_TARGET_KINDS: Partial<Record<MentionSearchSectionKind, MentionTargetKind[]>> = {
  [MentionSearchSectionKind.People]: [MentionTargetKind.Person],
  // Search returns rows inside Pages.
  [MentionSearchSectionKind.Pages]: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
  [MentionSearchSectionKind.Databases]: [MentionTargetKind.Database],
  [MentionSearchSectionKind.DatabaseRows]: [MentionTargetKind.DatabaseRow],
  [MentionSearchSectionKind.Dates]: [MentionTargetKind.Date, MentionTargetKind.Reminder],
  [MentionSearchSectionKind.Links]: [MentionTargetKind.ExternalLink],
};

const ALL_TARGET_KINDS = Object.values(MentionTargetKind);

function includesKind(include: readonly MentionTargetKind[], kind: MentionTargetKind) {
  return include.length === 0 || include.includes(kind);
}

/** Date and reminder quick picks, whose time Cloud computes when it answers. */
function isQuickPick(kind: MentionTargetKind) {
  return kind === MentionTargetKind.Date || kind === MentionTargetKind.Reminder;
}

/**
 * The cached answer of the longest typed prefix of `query`, shorter by one code point at a time,
 * down to one code point, at most {@link MENTION_PROVISIONAL_PREFIX_STEPS} prefixes. `keyOf` gives
 * a prefix's cache key, or `undefined` for a bare one; `read` the cached answer of a key, such as
 * its sections.
 */
export function longestCachedMentionPrefix<T>(
  query: string,
  keyOf: (prefix: string) => string | undefined,
  read: (key: string) => T | undefined,
  maxSteps = MENTION_PROVISIONAL_PREFIX_STEPS
): T | undefined {
  const codePoints = Array.from(query);
  let previousKey: string | undefined;

  for (let length = codePoints.length - 1, steps = 0; length >= 1 && steps < maxSteps; length -= 1, steps += 1) {
    const key = keyOf(codePoints.slice(0, length).join(''));

    // Prefixes that differ only by case or by trailing white space share a key.
    if (key === undefined || key === previousKey) continue;
    previousKey = key;

    const answer = read(key);

    if (answer !== undefined) return answer;
  }

  return undefined;
}

function withinTier(tier: number | undefined, worst: number) {
  return tier !== undefined && tier <= worst;
}

/**
 * Whether `item` still matches the typed `query` as a provisional item. Cloud titles a person with
 * a blank name by their address, so a title equal to the subtitle is a blank name, and the domain
 * then never matches as a name.
 */
export function mentionProvisionalItemMatches(query: MentionQuery | string, item: MentionSearchResultItem): boolean {
  switch (item.kind) {
    case MentionTargetKind.Person: {
      const email = item.subtitle ?? '';
      const name = item.title === email ? '' : item.title;

      return withinTier(personTier(query, name, email), MENTION_PROVISIONAL_PERSON_TIER);
    }

    case MentionTargetKind.Page:
    case MentionTargetKind.Database:
    case MentionTargetKind.DatabaseRow:
      return withinTier(objectTier(query, item.title), MENTION_PROVISIONAL_OBJECT_TIER);
    case MentionTargetKind.Date:
    case MentionTargetKind.Reminder:
      return withinTier(objectTier(query, item.title), MENTION_PROVISIONAL_DATE_TIER);
    default:
      return false;
  }
}

/** A cached answer, with when its request was sent: the larger `sequence` was asked for later. */
export interface MentionProvisionalAnswer {
  sections: readonly MentionSearchSection[];
  sequence: number;
}

export interface MentionProvisionalInput {
  /** The typed query. A query that normalizes to nothing (a bare `@`) narrows nothing. */
  query: string;
  /**
   * The sections to narrow, best source first: the sections on screen, the longest cached prefix's
   * answer, the cached bare `@` answer. An absent source is skipped. They give every kind but the
   * date and reminder quick picks, which come from {@link quickPickSources}.
   */
  sources: readonly (readonly MentionSearchSection[] | undefined)[];
  /**
   * The cached answers that give the date and reminder quick picks, in any order: the longest
   * cached prefix's and the bare one. Each quick pick comes from the newest of them that lists it,
   * since its time is the one Cloud computed for that answer. An absent answer is skipped.
   */
  quickPickSources: readonly (MentionProvisionalAnswer | undefined)[];
  /** The picker's kinds; empty means every kind. */
  include: readonly MentionTargetKind[];
  /** Leaves out an item no source may show any more, such as a view the user lost access to. */
  hides?: (item: MentionSearchResultItem) => boolean;
  /** The title of a section none of the sources titles, such as Pages for rows from a rows section. */
  sectionTitle: (kind: MentionSearchSectionKind) => string;
}

/**
 * The provisional sections for `query` (see the module header): People, Pages (with rows),
 * Databases and Dates, in the canonical section order, each with the items that still match, in
 * their sources' order, the first listing of a navigation key only; quick picks from the newest
 * cached answer that lists them. Sections with no item are left out. They have status `ok`; the
 * picker ranks and caps them as it does an answer.
 */
export function buildMentionProvisionalSections({
  query,
  sources,
  quickPickSources,
  include,
  hides,
  sectionTitle,
}: MentionProvisionalInput): MentionSearchSection[] {
  const prepared = prepareMentionQuery(query);

  if (!prepared.normalized) return [];

  const seen = new Set<string>();
  const items = new Map<MentionSearchSectionKind, MentionSearchResultItem[]>();
  const titles = new Map<MentionSearchSectionKind, string>();

  // Lists the quick picks of `from` when `quickPicks` is set, else its items of every other kind.
  const collect = (from: MentionProvisionalInput['sources'], quickPicks: boolean) =>
    from.forEach((sections) =>
      sections?.forEach((section) => {
        section.items.forEach((item) => {
          const kind = mentionProvisionalSectionKind(item.kind);

          if (!kind || isQuickPick(item.kind) !== quickPicks || !includesKind(include, item.kind)) return;

          const navKey = mentionItemNavKey(item);

          if (seen.has(navKey)) return;
          seen.add(navKey);
          if (hides?.(item) || !mentionProvisionalItemMatches(prepared, item)) return;

          items.set(kind, [...(items.get(kind) ?? []), item]);
          if (section.kind === kind && !titles.has(kind)) titles.set(kind, section.title);
        });
      })
    );
  const newestFirst = quickPickSources
    .filter((answer): answer is MentionProvisionalAnswer => answer !== undefined)
    .sort((left, right) => right.sequence - left.sequence)
    .map((answer) => answer.sections);

  collect(sources, false);
  collect(newestFirst, true);

  return Array.from(items.entries())
    .sort(([left], [right]) => mentionSectionOrder(left) - mentionSectionOrder(right))
    .map(([kind, sectionItems]) => ({
      kind,
      title: titles.get(kind) ?? sectionTitle(kind),
      items: sectionItems,
      has_more: false,
      status: 'ok',
    }));
}

/** `sections` without the items whose navigation key is one of `keys`, the same array when none is. */
export function withoutMentionKeys(sections: MentionSearchSection[], keys: ReadonlySet<string>): MentionSearchSection[] {
  if (keys.size === 0) return sections;

  const lists = (item: MentionSearchResultItem) => keys.has(mentionItemNavKey(item));

  if (!sections.some((section) => section.items.some(lists))) return sections;

  return sections.map((section) => ({ ...section, items: section.items.filter((item) => !lists(item)) }));
}

/** `sections` with at most `limit` items in each, the same array when none has more. */
export function capMentionSections(sections: MentionSearchSection[], limit: number): MentionSearchSection[] {
  if (!sections.some((section) => section.items.length > limit)) return sections;

  return sections.map((section) =>
    section.items.length > limit ? { ...section, items: section.items.slice(0, limit) } : section
  );
}

function requestKinds(include: readonly MentionTargetKind[] | undefined): Set<MentionTargetKind> {
  return new Set(include && include.length > 0 ? include : ALL_TARGET_KINDS);
}

/**
 * The kinds a search's answer lacks because their request did not answer them completely: every
 * kind a request asked for when it failed, timed out, went offline, was asked to wait or was
 * cancelled; the kinds of the failed sections of one that answered; and the rows of a rows-only
 * answer of the superseded shape. Empty for a complete answer.
 */
export function mentionAnswerMissingKinds(outcomes: readonly MentionLaneOutcome[]): ReadonlySet<MentionTargetKind> {
  const missing = new Set<MentionTargetKind>();

  outcomes.forEach(({ request, status, response }) => {
    const asked = requestKinds(request.include);

    if (status !== 'ok' || !response) {
      asked.forEach((kind) => missing.add(kind));
      return;
    }

    if (isCompleteMentionResponse(request, response)) return;

    const failed = response.sections.filter((section) => section.status === MENTION_SECTION_STATUS_FAILED);

    // Without a failed section, the rows-only answer was superseded.
    if (failed.length === 0) {
      asked.forEach((kind) => missing.add(kind));
      return;
    }

    failed.forEach((section) =>
      SECTION_TARGET_KINDS[section.kind]?.forEach((kind) => {
        if (asked.has(kind)) missing.add(kind);
      })
    );
  });

  return missing;
}

/**
 * The kinds that sections a search shows while the rest of its answer is pending lack: the rows,
 * whose request has not answered yet or is retried, and the kinds of any failed section.
 */
export function mentionInterimMissingKinds(sections: readonly MentionSearchSection[]): ReadonlySet<MentionTargetKind> {
  const missing = new Set<MentionTargetKind>([MentionTargetKind.DatabaseRow]);

  sections.forEach((section) => {
    if (section.status === MENTION_SECTION_STATUS_FAILED) {
      SECTION_TARGET_KINDS[section.kind]?.forEach((kind) => missing.add(kind));
    }
  });

  return missing;
}

/** An answer with the provisional items it lacks, and the navigation keys of those items. */
export interface MentionSectionsWithProvisional {
  sections: MentionSearchSection[];
  /** Navigation keys of the provisional items added; empty when none was. */
  carriedKeys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * `answer` with the `provisional` items of the `missing` kinds that it does not list, after its own
 * items in the section of their kind, which is created in its canonical place when the answer has
 * none. The same `answer` when nothing is missing or nothing is added.
 */
export function withProvisionalItems(
  answer: MentionSearchSection[],
  provisional: readonly MentionSearchSection[],
  missing: ReadonlySet<MentionTargetKind>
): MentionSectionsWithProvisional {
  if (missing.size === 0 || provisional.length === 0) return { sections: answer, carriedKeys: NO_KEYS };

  const listed = new Set<string>();

  answer.forEach((section) => section.items.forEach((item) => listed.add(mentionItemNavKey(item))));

  const carried = new Map<MentionSearchSectionKind, { title: string; items: MentionSearchResultItem[] }>();
  const carriedKeys = new Set<string>();

  provisional.forEach((section) =>
    section.items.forEach((item) => {
      const kind = mentionProvisionalSectionKind(item.kind);
      const navKey = mentionItemNavKey(item);

      if (!kind || !missing.has(item.kind) || listed.has(navKey) || carriedKeys.has(navKey)) return;

      const entry = carried.get(kind) ?? { title: section.title, items: [] };

      entry.items.push(item);
      carried.set(kind, entry);
      carriedKeys.add(navKey);
    })
  );

  if (carried.size === 0) return { sections: answer, carriedKeys: NO_KEYS };

  const sections = answer.map((section) => {
    const entry = carried.get(section.kind);

    if (!entry) return section;
    carried.delete(section.kind);
    return { ...section, items: [...section.items, ...entry.items] };
  });

  carried.forEach(({ title, items }, kind) => {
    const at = sections.findIndex((section) => mentionSectionOrder(section.kind) > mentionSectionOrder(kind));

    sections.splice(at === -1 ? sections.length : at, 0, { kind, title, items, has_more: false, status: 'ok' });
  });

  return { sections, carriedKeys };
}
