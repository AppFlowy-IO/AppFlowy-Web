/**
 * The replay of the @-mention sessions (MEN-X-07): every prefix of every pick, ranked by four arms
 * against the workspace as it was at the pick.
 *
 * - `ranker`: the production client ranking (`rankSection`, MEN-WEB-06) with production pick memory
 *   (`MentionPickMemory`, MEN-WEB-10) as the picker keeps it: the local lane as the picker ranks it
 *   before an answer arrives, offline, or for a one-letter query that stays local.
 * - `ranker_no_picks`: the same ranking without pick memory, which is off by default.
 * - `mru`: the candidates whose title matches at a word start or better (T0 to T2), or people of
 *   the prefix class C0, that the user used, most recently used first, as MEN-X-04's server
 *   baseline orders them.
 * - `substring`: today's local filter, a lowercase substring of the title, or of a person's name or
 *   address, in the outline's or roster's order.
 *
 * The rules, which Desktop's replay (`mention_eval_parity_test.dart`) follows too, are in
 * `__fixtures__/mention-eval/README.md`. Only `ranker` is recorded for that parity check.
 */
import {
  MentionQuery,
  MentionRankCandidate,
  MentionRankLane,
  objectTier,
  personTier,
  prepareMentionQuery,
  rankSection,
} from '@/components/editor/components/panels/mention-panel/mentionLocalRanker';
import {
  MENTION_PICK_MAX_INPUT_CODE_POINTS,
  MentionPickMemory,
  MentionPickScore,
} from '@/components/editor/components/panels/mention-panel/mentionPickMemory';
import { compareCodePoints } from '@/utils/normalize-text';

import { MentionEvalEvent, MentionEvalSessions, MentionEvalView } from './sessions';

/** Each arm's ranking is cut to its best eight, as MEN-X-04 grades the server. */
export const MENTION_EVAL_TOP = 8;

export const MENTION_EVAL_ARMS = ['ranker', 'ranker_no_picks', 'mru', 'substring'] as const;
export type MentionEvalArm = (typeof MENTION_EVAL_ARMS)[number];

/** The picker section a target is ranked in: people, or pages and databases apart. */
export type MentionEvalSection = 'people' | 'pages' | 'databases';

/** The event list a case comes from: the user's behavior, which the gates grade, or the probes. */
export type MentionEvalReplay = 'events' | 'probes';

/** One prefix of one pick, ranked by every arm. */
export interface MentionEvalCase {
  readonly replay: MentionEvalReplay;
  /** The pick's position among the picks of the events, then of the probes, from 0. */
  readonly pick: number;
  /** The prefix as typed. */
  readonly prefix: string;
  /** Code points of the prefix once normalized: what decides its bucket. */
  readonly codePoints: number;
  /** The normalized prefix holds a Han, kana or Hangul code point. */
  readonly cjk: boolean;
  readonly section: MentionEvalSection;
  /** The id of the person or view the user picked. */
  readonly target: string;
  /**
   * A page or database target whose title the prefix matches exactly (T0): `unique` when no other
   * candidate's title does, else `duplicate`.
   */
  readonly exactTitle?: 'unique' | 'duplicate';
  /** Each arm's best ids, best first, at most {@link MENTION_EVAL_TOP}. */
  readonly top: Readonly<Record<MentionEvalArm, readonly string[]>>;
  /**
   * Pages and databases: how many T0 or T1 titles the ranker's whole order puts after a T3 or T4
   * title. Always 0 for people.
   */
  readonly tierOrderViolations: number;
}

/** A candidate as every arm reads it. */
interface Candidate {
  readonly id: string;
  readonly key: string;
  /** A title, or a person's name. */
  readonly title: string;
  readonly email?: string;
  /** Today's filter reads these, lowercased by JavaScript. */
  readonly lowerTitle: string;
  readonly lowerEmail: string;
  readonly createdMs: number;
}

interface RankedCandidate extends MentionRankCandidate {
  readonly id: string;
}

/**
 * The prefixes of `typed` that are replayed: the first one, two, ... code points, each once its
 * normalized form is not empty and differs from the previous replayed prefix's (a trailing space
 * adds nothing).
 */
export function mentionEvalPrefixes(typed: string): string[] {
  const codePoints = Array.from(typed);
  const prefixes: string[] = [];
  let previous = '';

  for (let length = 1; length <= codePoints.length; length += 1) {
    const prefix = codePoints.slice(0, length).join('');
    const { normalized } = prepareMentionQuery(prefix);

    if (normalized && normalized !== previous) {
      previous = normalized;
      prefixes.push(prefix);
    }
  }

  return prefixes;
}

function viewCandidate(view: MentionEvalView): Candidate {
  return {
    id: view.id,
    key: view.key,
    title: view.title,
    lowerTitle: view.title.toLowerCase(),
    lowerEmail: '',
    createdMs: view.created_ms,
  };
}

/** The candidates of `list` that exist at `t`: `list` is in creation order. */
function existingAt(list: readonly Candidate[], t: number): readonly Candidate[] {
  let count = 0;

  while (count < list.length && list[count].createdMs <= t) count += 1;
  return count === list.length ? list : list.slice(0, count);
}

function ids(ranked: readonly { readonly id: string }[]): string[] {
  return ranked.map((candidate) => candidate.id);
}

/** Whether MRU lists `candidate`: a title at a word start or better, or a person of class C0. */
function mruMatches(query: MentionQuery, lane: MentionRankLane, candidate: Candidate): boolean {
  if (lane === 'people') return personTier(query, candidate.title, candidate.email ?? '') === 0;

  const tier = objectTier(query, candidate.title);

  return tier !== undefined && tier <= 2;
}

function mruTop(
  query: MentionQuery,
  lane: MentionRankLane,
  candidates: readonly Candidate[],
  lastUsed: ReadonlyMap<string, number>
): string[] {
  const used = (candidate: Candidate) => lastUsed.get(candidate.id) ?? 0;

  return ids(
    candidates
      .filter((candidate) => lastUsed.has(candidate.id) && mruMatches(query, lane, candidate))
      .sort((a, b) => used(b) - used(a) || compareCodePoints(a.key, b.key))
      .slice(0, MENTION_EVAL_TOP)
  );
}

/** Today's filter: `MentionPanel.tsx`'s local fallback for titles, Desktop's roster filter for people. */
function substringTop(prefix: string, lane: MentionRankLane, candidates: readonly Candidate[]): string[] {
  const query = prefix.trim().toLowerCase();
  const top: string[] = [];

  for (const candidate of candidates) {
    if (top.length >= MENTION_EVAL_TOP) break;
    if (candidate.lowerTitle.includes(query) || (lane === 'people' && candidate.lowerEmail.includes(query))) {
      top.push(candidate.id);
    }
  }

  return top;
}

/** T0 or T1 titles that come after a T3 or T4 title in `ranked`. */
function tierOrderViolations(query: MentionQuery, ranked: readonly RankedCandidate[]): number {
  let afterWeak = false;
  let violations = 0;

  ranked.forEach((candidate) => {
    const tier = objectTier(query, candidate.title) ?? 4;

    if (tier >= 3) afterWeak = true;
    else if (tier <= 1 && afterWeak) violations += 1;
  });
  return violations;
}

/** The workspace as every replay reads it. */
interface ReplayContext {
  readonly requesterKey?: string;
  readonly people: readonly Candidate[];
  readonly peopleIds: ReadonlySet<string>;
  readonly viewKinds: ReadonlyMap<string, MentionEvalView['kind']>;
  readonly sections: Readonly<Record<Exclude<MentionEvalSection, 'people'>, readonly Candidate[]>>;
}

/**
 * Replays `sessions` (see the module header and the fixture README): its events, then its probes,
 * each from an empty state (no recency, an empty pick memory) over the same workspace. Picks are
 * numbered through both lists.
 */
export function replayMentionEvalSessions(sessions: MentionEvalSessions): MentionEvalCase[] {
  const context: ReplayContext = {
    requesterKey: sessions.people.find((person) => person.id === sessions.requester)?.key,
    people: sessions.people.map((person) => ({
      id: person.id,
      key: person.key,
      title: person.name,
      email: person.email,
      lowerTitle: person.name.toLowerCase(),
      lowerEmail: person.email.toLowerCase(),
      createdMs: Number.NEGATIVE_INFINITY,
    })),
    peopleIds: new Set(sessions.people.map((person) => person.id)),
    viewKinds: new Map(sessions.views.map((view) => [view.id, view.kind])),
    sections: {
      pages: sessions.views.filter((view) => view.kind === 'page').map(viewCandidate),
      databases: sessions.views.filter((view) => view.kind === 'database').map(viewCandidate),
    },
  };
  const cases: MentionEvalCase[] = [];
  const picks = replayEvents(context, sessions.events, 'events', 0, cases);

  replayEvents(context, sessions.probes, 'probes', picks, cases);
  return cases;
}

/** Replays one event list from an empty state, adding its cases; returns the next pick's number. */
function replayEvents(
  context: ReplayContext,
  events: readonly MentionEvalEvent[],
  replay: MentionEvalReplay,
  firstPick: number,
  cases: MentionEvalCase[]
): number {
  // When the user last opened or created a view, or mentioned a person.
  const lastUsed = new Map<string, number>();
  // As the picker keeps it: the contract's capacity, inputs of at most 32 code points.
  const memory = new MentionPickMemory({ maxInputCodePoints: MENTION_PICK_MAX_INPUT_CODE_POINTS });
  let pick = firstPick;

  events.forEach((event) => {
    const [t, , id] = event;

    if (event[1] !== 'pick') {
      lastUsed.set(id, t);
      return;
    }

    const typed = event[3];
    const section: MentionEvalSection = context.peopleIds.has(id)
      ? 'people'
      : context.viewKinds.get(id) === 'page'
      ? 'pages'
      : 'databases';
    const lane: MentionRankLane = section === 'people' ? 'people' : 'objects';
    const candidates = section === 'people' ? context.people : existingAt(context.sections[section], t);
    const target = candidates.find((candidate) => candidate.id === id);

    if (!target) throw new Error(`pick ${pick} of ${id}, which does not exist at ${t}`);

    mentionEvalPrefixes(typed).forEach((prefix) => {
      const query = prepareMentionQuery(prefix);
      const scores = memory.scores(prefix, t);
      const rankCandidate = (candidate: Candidate, score?: MentionPickScore): RankedCandidate => ({
        id: candidate.id,
        key: candidate.key,
        title: candidate.title,
        email: candidate.email,
        adaptive: score?.adaptive,
        lift: score?.lift,
        lastUsedMs: lastUsed.get(candidate.id),
        requester: candidate.key === context.requesterKey,
      });
      const withPicks = candidates.map((candidate) => rankCandidate(candidate, scores.get(candidate.key)));
      const withoutPicks = candidates.map((candidate) => rankCandidate(candidate));
      let exactTitle: MentionEvalCase['exactTitle'];
      let violations = 0;

      if (lane === 'objects') {
        if (objectTier(query, target.title) === 0) {
          const exact = candidates.filter((candidate) => objectTier(query, candidate.title) === 0).length;

          exactTitle = exact === 1 ? 'unique' : 'duplicate';
        }

        violations = tierOrderViolations(query, rankSection(query, lane, withPicks, t));
      }

      cases.push({
        replay,
        pick,
        prefix,
        codePoints: query.codePoints,
        cjk: query.hasCjk,
        section,
        target: id,
        exactTitle,
        top: {
          ranker: ids(rankSection(query, lane, withPicks, t, MENTION_EVAL_TOP)),
          ranker_no_picks: ids(rankSection(query, lane, withoutPicks, t, MENTION_EVAL_TOP)),
          mru: mruTop(query, lane, candidates, lastUsed),
          substring: substringTop(prefix, lane, candidates),
        },
        tierOrderViolations: violations,
      });
    });

    // The picker records the query typed when the user inserted the mention, after ranking it.
    memory.recordPick(typed, target.key, t);
    if (section === 'people') lastUsed.set(id, t);
    pick += 1;
  });

  return pick;
}
