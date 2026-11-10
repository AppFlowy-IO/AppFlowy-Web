/**
 * Who the comment @ pickers suggest, and in what order (MEN-WEB-14). Row comments, Feed cards and
 * document comments all ask {@link commentMentionSuggestions}, through `useCommentMentionPicker`.
 *
 * `legacy` is the order these pickers have always had, and it stays the default
 * ({@link COMMENT_MENTION_RANKING_DEFAULT}): everyone whose name or address contains the typed text,
 * in roster order. `ranked` matches people by the @-mention typeahead contract's classes
 * (`personTier`, pinned by `mention-parity/people.json`): C0 every token starts a name word, or the
 * address's local part or one of its words starts with the query; C1 the name contains it; C2 the
 * local part does; C3 a query holding `@` or `.` that the full address contains. The domain alone
 * never matches, so `flow` finds no one at `appflowy.io`. Inside a class people sort by:
 *
 * 1. the requester last (contract decision D10);
 * 2. the discussion's participants first, the most recent participant first;
 * 3. people on the page now;
 * 4. the requester's latest mention of the person (`last_mentioned_at`), the most recent first and
 *    never-mentioned people last;
 * 5. for a typed query, the shorter display name;
 * 6. the display name lowercased (the address when the name is blank), by code point;
 * 7. the person id.
 *
 * A bare `@` lists everyone by the same keys without the class and the length. Keys 1 and 4 to 7
 * are Cloud's people order for the editor's @ picker (`mentions/people/ranking.rs`), so a comment
 * picker and the editor agree whenever no one takes part or is present. Both orders stop at
 * {@link COMMENT_MENTION_LIMIT} people.
 *
 * Nothing here depends on React, the DOM or the network.
 */
import { InlineComment } from '@/application/inline-comment';
import { RowComment } from '@/application/row-comment.type';
import { MentionablePerson } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { personTier, prepareMentionQuery } from '@/components/editor/components/panels/mention-panel/mentionLocalRanker';
import { compareCodePoints, compareCodeUnits, countCodePoints, isMentionBlankText } from '@/utils/normalize-text';

/** `legacy`: substring in roster order. `ranked`: people classes, then the context keys above. */
export type CommentMentionRanking = 'legacy' | 'ranked';

/**
 * The order comment pickers use unless the browser overrides it. It stays `legacy` until the
 * ranked order passes the replay gate and product signs off on the requester's place (MEN-X-07).
 */
export const COMMENT_MENTION_RANKING_DEFAULT: CommentMentionRanking = 'legacy';
/** `localStorage` key that picks the order of comment pickers: `ranked` or `legacy`. */
export const COMMENT_MENTION_RANKING_OVERRIDE_KEY = '__comment_mention_ranking';
/** A comment picker lists at most this many people. */
export const COMMENT_MENTION_LIMIT = 8;

/**
 * The order a comment picker mounted now uses: {@link COMMENT_MENTION_RANKING_DEFAULT}, unless
 * `localStorage.__comment_mention_ranking` is `ranked` or `legacy`. Storage can be denied, by the
 * getter or the read itself, and the default then applies.
 */
export function readCommentMentionRanking(): CommentMentionRanking {
  let override: string | null;

  try {
    override =
      typeof window === 'undefined' ? null : window.localStorage?.getItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY) ?? null;
  } catch {
    override = null;
  }

  return override === 'ranked' || override === 'legacy' ? override : COMMENT_MENTION_RANKING_DEFAULT;
}

/** The `legacy` order: everyone whose name or address contains `query`, in roster order. */
export function legacyCommentMentionCandidates(
  query: string,
  people: readonly MentionablePerson[],
  limit = COMMENT_MENTION_LIMIT
): MentionablePerson[] {
  const text = query.toLocaleLowerCase();

  return people
    .filter((person) => person.person_id && `${person.name} ${person.email}`.toLocaleLowerCase().includes(text))
    .slice(0, limit);
}

/** What the `ranked` order knows about the discussion a comment joins. */
export interface CommentMentionContext {
  /**
   * People who took part in the discussion, the most recent first: person ids, or the numeric uids
   * older row comments were written with. Ids the roster does not know are ignored.
   */
  participantIds?: readonly string[];
  /** People on the page now, by person id or uid. */
  presentIds?: Iterable<string>;
  /** The commenter, by person id or uid; they come last in their class. */
  requesterId?: string | null;
}

export interface CommentMentionRankInput extends CommentMentionContext {
  /** The text typed after the `@`; empty, or only White_Space, for a bare `@`. */
  query: string;
  /** The workspace roster, in the server's order. */
  people: readonly MentionablePerson[];
  limit?: number;
}

/** The mentionable people of a roster, and how ids from comments and awareness name them. */
interface CommentPeopleIndex {
  /** People with a person id, each once, in roster order. */
  readonly people: readonly MentionablePerson[];
  readonly byPersonId: ReadonlyMap<string, MentionablePerson>;
  /** Empty when the server sends no `uid` (before 0.18.2); an id that only a uid names then names no one. */
  readonly byUid: ReadonlyMap<string, MentionablePerson>;
}

// A roster is one shared snapshot (`useMentionableUsers`), indexed once whatever is typed.
const peopleIndexes = new WeakMap<readonly MentionablePerson[], CommentPeopleIndex>();

function indexPeople(roster: readonly MentionablePerson[]): CommentPeopleIndex {
  const cached = peopleIndexes.get(roster);

  if (cached) return cached;

  const people: MentionablePerson[] = [];
  const byPersonId = new Map<string, MentionablePerson>();
  const byUid = new Map<string, MentionablePerson>();

  for (const person of roster) {
    if (!person.person_id || byPersonId.has(person.person_id)) continue;
    people.push(person);
    byPersonId.set(person.person_id, person);

    const uid = canonicalizeUserUid(person.uid);

    if (uid && !byUid.has(uid)) byUid.set(uid, person);
  }

  const index = { people, byPersonId, byUid };

  peopleIndexes.set(roster, index);
  return index;
}

/** The person id that `id` names: a person id in any letter case, or a numeric uid. */
function resolvePersonId(index: CommentPeopleIndex, id: string | null | undefined): string | undefined {
  if (!id) return undefined;

  const person = index.byPersonId.get(id) ?? index.byPersonId.get(id.toLowerCase());

  if (person) return person.person_id;

  const uid = canonicalizeUserUid(id);

  return uid ? index.byUid.get(uid)?.person_id : undefined;
}

/**
 * The person ids that `ids` name in `roster`, as the ranked order resolves them: person ids in any
 * letter case, or numeric uids through the roster's `uid`. An id that names no one is left out. The
 * editor's @ picker reads who is on the page this way too (MEN-WEB-09).
 */
export function resolveMentionablePersonIds(roster: readonly MentionablePerson[], ids: Iterable<string>): Set<string> {
  const index = indexPeople(roster);
  const resolved = new Set<string>();

  for (const id of ids) {
    const personId = resolvePersonId(index, id);

    if (personId) resolved.add(personId);
  }

  return resolved;
}

/** Cloud's display name: the address stands in for a name that is blank. */
function sortName(person: MentionablePerson): string {
  const name = person.name ?? '';

  return (isMentionBlankText(name) ? person.email ?? '' : name).toLowerCase();
}

/** When the requester last mentioned the person, in epoch milliseconds; `undefined` for never. */
function lastMentionedMs(person: MentionablePerson): number | undefined {
  const at = person.last_mentioned_at ? Date.parse(person.last_mentioned_at) : Number.NaN;

  return Number.isFinite(at) ? at : undefined;
}

/** The place of someone who did not take part: after every participant. */
const NOT_A_PARTICIPANT = Number.MAX_SAFE_INTEGER;

interface CommentMentionEntry {
  readonly person: MentionablePerson;
  /** C0 to C3; 0 for everyone on a bare `@`. */
  readonly tier: number;
  readonly requester: boolean;
  /** 0 for the most recent participant, {@link NOT_A_PARTICIPANT} for others. */
  readonly participant: number;
  readonly present: boolean;
  readonly mentionedAt: number | undefined;
  /** Code points of {@link name}; 0 on a bare `@`, where length does not count. */
  readonly length: number;
  readonly name: string;
}

function compareMentionedAt(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}

function compareEntries(a: CommentMentionEntry, b: CommentMentionEntry): number {
  return (
    a.tier - b.tier ||
    Number(a.requester) - Number(b.requester) ||
    a.participant - b.participant ||
    Number(b.present) - Number(a.present) ||
    compareMentionedAt(a.mentionedAt, b.mentionedAt) ||
    a.length - b.length ||
    compareCodePoints(a.name, b.name) ||
    compareCodeUnits(a.person.person_id, b.person.person_id)
  );
}

/** The `ranked` order (see the module comment): the best {@link COMMENT_MENTION_LIMIT} people, best first. */
export function rankCommentMentionCandidates({
  query,
  people,
  participantIds = [],
  presentIds = [],
  requesterId,
  limit = COMMENT_MENTION_LIMIT,
}: CommentMentionRankInput): MentionablePerson[] {
  const index = indexPeople(people);
  const participants = new Map<string, number>();
  const present = new Set<string>();

  for (const id of participantIds) {
    const personId = resolvePersonId(index, id);

    if (personId && !participants.has(personId)) participants.set(personId, participants.size);
  }

  for (const id of presentIds) {
    const personId = resolvePersonId(index, id);

    if (personId) present.add(personId);
  }

  const requester = resolvePersonId(index, requesterId);
  const prepared = prepareMentionQuery(query);
  const typed = prepared.normalized !== '';
  const entries: CommentMentionEntry[] = [];

  for (const person of index.people) {
    const tier = typed ? personTier(prepared, person.name ?? '', person.email ?? '') : 0;

    if (tier === undefined) continue;

    const name = sortName(person);

    entries.push({
      person,
      tier,
      requester: person.person_id === requester,
      participant: participants.get(person.person_id) ?? NOT_A_PARTICIPANT,
      present: present.has(person.person_id),
      mentionedAt: lastMentionedMs(person),
      length: typed ? countCodePoints(name) : 0,
      name,
    });
  }

  return entries
    .sort(compareEntries)
    .slice(0, limit)
    .map((entry) => entry.person);
}

/** The people a comment picker suggests for `query`, in the `ranking` order. */
export function commentMentionSuggestions(
  ranking: CommentMentionRanking,
  input: CommentMentionRankInput
): MentionablePerson[] {
  return ranking === 'ranked'
    ? rankCommentMentionCandidates(input)
    : legacyCommentMentionCandidates(input.query, input.people, input.limit);
}

/**
 * The authors of `comments`, each once, the most recent first. Of two comments made at the same
 * time the one listed later counts as the more recent, and a comment without a valid time counts
 * as the oldest.
 */
export function commentAuthorsByRecency<T>(
  comments: readonly T[],
  authorOf: (comment: T) => string | null | undefined,
  createdAtOf: (comment: T) => number
): string[] {
  const order = comments.map((comment, position) => {
    const at = createdAtOf(comment);

    return { author: authorOf(comment), at: Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY, position };
  });

  order.sort((a, b) => (a.at === b.at ? b.position - a.position : b.at > a.at ? 1 : -1));

  const authors = new Set<string>();

  for (const { author } of order) {
    if (author) authors.add(author);
  }

  return [...authors];
}

/**
 * The participants a row comment composer ranks first: for a reply, the thread's authors and then
 * the row's other commenters; for a new comment, which continues the row's discussion, everyone
 * who commented on the row. The most recent first in each part.
 */
export function rowCommentMentionParticipants(
  comments: readonly RowComment[],
  parentCommentId?: string | null
): string[] {
  const authors = (list: readonly RowComment[]) =>
    commentAuthorsByRecency(
      list,
      (comment) => comment.authorId,
      (comment) => comment.createdAt
    );

  if (!parentCommentId) return authors(comments);

  const thread = comments.filter(
    (comment) => comment.id === parentCommentId || comment.parentCommentId === parentCommentId
  );

  return [...new Set([...authors(thread), ...authors(comments)])];
}

/** The participants of a document comment thread (its comment and replies), the most recent first. */
export function inlineCommentMentionParticipants(thread: readonly InlineComment[]): string[] {
  return commentAuthorsByRecency(
    thread.filter((comment) => !comment.isDeleted),
    (comment) => comment.user?.uuid,
    (comment) => Date.parse(comment.createdAt)
  );
}
