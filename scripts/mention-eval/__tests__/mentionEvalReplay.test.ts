/**
 * @jest-environment node
 */
import * as ranker from '@/components/editor/components/panels/mention-panel/mentionLocalRanker';
import {
  MentionQuery,
  MentionRankCandidate,
  MentionRankLane,
  prepareMentionQuery,
  rankSection,
} from '@/components/editor/components/panels/mention-panel/mentionLocalRanker';

import { mentionEvalPrefixes, MentionEvalCase, replayMentionEvalSessions } from '../replay';
import { MentionEvalEvent, MentionEvalSessions, MentionEvalView } from '../sessions';

const MINUTE = 60_000;
const DAY = 86_400_000;
const T0 = 1_791_158_400_000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const page = (id: string, n: number, title: string, createdMs = T0 - DAY): MentionEvalView => ({
  id,
  key: `page:${uuid(n)}`,
  kind: 'page',
  title,
  created_ms: createdMs,
});

/** Five pages (two created during the replay), a database and five people, the requester first. */
function sessionsOf(events: MentionEvalEvent[], probes: MentionEvalEvent[] = []): MentionEvalSessions {
  return {
    version: 1,
    about: 'test',
    generator: { name: 'test', params: {} },
    start_ms: T0,
    end_ms: T0 + 10 * DAY,
    requester: 'p0',
    views: [
      page('v0', 1, 'Roadmap'),
      page('v1', 2, 'Roadmap 2026'),
      page('v2', 3, 'Product roadmap'),
      { id: 'v3', key: `database:${uuid(4)}:${uuid(5)}`, kind: 'database', title: 'Road tracker', created_ms: T0 - DAY },
      page('v4', 6, 'Roadshow', T0 + 5 * MINUTE),
      page('v5', 7, 'Roadmap', T0 + 6 * MINUTE),
    ],
    people: [
      { id: 'p0', key: `person:${uuid(10)}`, name: 'Avery Quinn', email: 'avery.quinn@acme.example' },
      { id: 'p1', key: `person:${uuid(11)}`, name: 'Rosa Diaz', email: 'rosa.diaz@acme.example' },
      { id: 'p2', key: `person:${uuid(12)}`, name: 'Robert Ro', email: 'robert.ro@acme.example' },
      { id: 'p3', key: `person:${uuid(13)}`, name: '', email: 'ops@acme.example' },
      { id: 'p4', key: `person:${uuid(14)}`, name: 'Quentin Lowe', email: 'quentin.lowe@acme.example' },
    ],
    events,
    probes,
  };
}

function find(cases: MentionEvalCase[], pick: number, prefix: string): MentionEvalCase {
  const found = cases.find((testCase) => testCase.pick === pick && testCase.prefix === prefix);

  if (!found) throw new Error(`no case ${pick} ${prefix}`);
  return found;
}

describe('mention eval replay', () => {
  it('replays each code point prefix once its normalized form is new', () => {
    expect(mentionEvalPrefixes('road')).toEqual(['r', 'ro', 'roa', 'road']);
    expect(mentionEvalPrefixes('me  no')).toEqual(['m', 'me', 'me  n', 'me  no']);
    expect(mentionEvalPrefixes(' a')).toEqual([' a']);
    expect(mentionEvalPrefixes('🚀 la')).toEqual(['🚀', '🚀 l', '🚀 la']);
    // A combining mark alone normalizes to nothing new.
    expect(mentionEvalPrefixes('e\u0301t')).toEqual(['e', 'e\u0301t']);
    expect(mentionEvalPrefixes('회의')).toEqual(['회', '회의']);
  });

  it('ranks the section of the target against the workspace as it was at the pick', () => {
    const cases = replayMentionEvalSessions(
      sessionsOf([
        [T0 + MINUTE, 'open', 'v2'],
        [T0 + 2 * MINUTE, 'pick', 'v1', 'road'],
        [T0 + 5 * MINUTE, 'create', 'v4'],
        [T0 + 6 * MINUTE, 'create', 'v5'],
        [T0 + 7 * MINUTE, 'pick', 'v1', 'road'],
        [T0 + 8 * MINUTE, 'pick', 'p1', 'ro'],
        [T0 + 9 * MINUTE, 'pick', 'v3', 'road'],
        [T0 + 10 * MINUTE, 'pick', 'v0', 'roadmap'],
      ])
    );

    expect(cases.filter((testCase) => testCase.pick < 4).map((testCase) => [testCase.pick, testCase.prefix])).toEqual([
      [0, 'r'],
      [0, 'ro'],
      [0, 'roa'],
      [0, 'road'],
      [1, 'r'],
      [1, 'ro'],
      [1, 'roa'],
      [1, 'road'],
      [2, 'r'],
      [2, 'ro'],
      [3, 'r'],
      [3, 'ro'],
      [3, 'roa'],
      [3, 'road'],
    ]);

    // Before any pick, and before v4 and v5 exist: tiers, then length. The page opened a minute
    // ago (T2) leads only MRU, which lists used items alone.
    expect(find(cases, 0, 'r')).toMatchObject({ replay: 'events', section: 'pages', target: 'v1', codePoints: 1 });
    expect(find(cases, 0, 'r').top).toEqual({
      ranker: ['v0', 'v1', 'v2'],
      ranker_no_picks: ['v0', 'v1', 'v2'],
      mru: ['v2'],
      substring: ['v0', 'v1', 'v2'],
    });

    // The first pick of 'road' scores v1 first in T1; the new pages lead the rest of T1 by
    // recency, the shorter first; MRU lists what was used, the newest first.
    expect(find(cases, 1, 'r').top).toEqual({
      ranker: ['v1', 'v5', 'v4', 'v0', 'v2'],
      ranker_no_picks: ['v5', 'v4', 'v0', 'v1', 'v2'],
      mru: ['v5', 'v4', 'v2'],
      substring: ['v0', 'v1', 'v2', 'v4', 'v5'],
    });
    expect(find(cases, 1, 'road').exactTitle).toBeUndefined();
    // The tier check reads each ranker arm's whole order.
    expect(find(cases, 1, 'r').tierOrderViolations).toEqual({ ranker: 0, ranker_no_picks: 0 });

    // People: classes, then length, then key; the requester (C1 here) last. Nobody was mentioned
    // yet, and the blank-named address does not match.
    expect(find(cases, 2, 'r')).toMatchObject({
      section: 'people',
      tierOrderViolations: { ranker: 0, ranker_no_picks: 0 },
    });
    expect(find(cases, 2, 'r').top).toEqual({
      ranker: ['p1', 'p2', 'p0'],
      ranker_no_picks: ['p1', 'p2', 'p0'],
      mru: [],
      substring: ['p0', 'p1', 'p2'],
    });

    // A database pick ranks the databases alone.
    expect(find(cases, 3, 'road')).toMatchObject({ section: 'databases', top: { ranker: ['v3'] } });
    // v0 and v5 are both 'Roadmap': an exact title they share.
    expect(find(cases, 4, 'roadmap').exactTitle).toBe('duplicate');
    expect(find(cases, 4, 'roadma').exactTitle).toBeUndefined();
  });

  it('flags a unique exact title', () => {
    const cases = replayMentionEvalSessions(sessionsOf([[T0 + 2 * MINUTE, 'pick', 'v2', 'product roadmap']]));

    expect(find(cases, 0, 'product roadmap')).toMatchObject({ exactTitle: 'unique', top: { ranker: ['v2'] } });
    expect(find(cases, 0, 'product roadma').exactTitle).toBeUndefined();
  });

  it('puts the requester last in their class', () => {
    const cases = replayMentionEvalSessions(sessionsOf([[T0, 'pick', 'p4', 'qu']]));

    // Both start a name word with 'qu'; Avery Quinn's shorter name would come first.
    expect(find(cases, 0, 'qu').top.ranker).toEqual(['p4', 'p0']);
  });

  it("matches every address of the shared domain in today's filter, never in the ranker", () => {
    const cases = replayMentionEvalSessions(sessionsOf([[T0, 'pick', 'p1', 'a']]));

    expect(find(cases, 0, 'a').top).toMatchObject({
      ranker: ['p0', 'p1'],
      substring: ['p0', 'p1', 'p2', 'p3', 'p4'],
    });
  });

  it('records the typed query after ranking it, and a person pick as a use', () => {
    const cases = replayMentionEvalSessions(
      sessionsOf([
        [T0, 'pick', 'p1', 'rosa'],
        [T0 + MINUTE, 'pick', 'p2', 'ro'],
        [T0 + 3 * DAY, 'pick', 'p2', 'ro'],
      ])
    );

    // Pick 1 does not see its own pick; p1, picked a minute ago after 'rosa', leads.
    expect(find(cases, 1, 'ro').top).toMatchObject({ ranker: ['p1', 'p2'], ranker_no_picks: ['p1', 'p2'], mru: ['p1'] });
    // Three days on, both were mentioned more than a day ago: pick memory decides, MRU takes the newest.
    expect(find(cases, 2, 'ro').top).toMatchObject({
      ranker: ['p2', 'p1'],
      ranker_no_picks: ['p1', 'p2'],
      mru: ['p2', 'p1'],
    });
  });

  it('records no query longer than 32 code points, as the picker keeps its memory', () => {
    const replayed = (typed: string) =>
      find(
        replayMentionEvalSessions(
          sessionsOf([
            [T0, 'pick', 'p1', 'rosa'],
            [T0 + MINUTE, 'pick', 'p2', typed],
            [T0 + 3 * DAY, 'pick', 'p1', 'ro'],
          ])
        ),
        2,
        'ro'
      ).top;

    expect(replayed(`rob${' x'.repeat(16)}`)).toMatchObject({ ranker: ['p1', 'p2'], ranker_no_picks: ['p1', 'p2'] });
    expect(replayed(`rob${' x'.repeat(14)}`)).toMatchObject({ ranker: ['p2', 'p1'], ranker_no_picks: ['p1', 'p2'] });
  });

  it('replays the probes from an empty state, numbering their picks after the events', () => {
    const cases = replayMentionEvalSessions(
      sessionsOf(
        [
          [T0 + MINUTE, 'open', 'v1'],
          [T0 + 2 * MINUTE, 'pick', 'v1', 'r'],
        ],
        [[T0 + 3 * MINUTE, 'pick', 'v0', 'r']]
      )
    );

    expect(cases.map((testCase) => [testCase.replay, testCase.pick])).toEqual([
      ['events', 0],
      ['probes', 1],
    ]);
    // In the events, v1 was opened a minute ago; the probes know nothing of it.
    expect(cases[0].top.ranker).toEqual(['v1', 'v0', 'v2']);
    expect(cases[1].top).toMatchObject({ ranker: ['v0', 'v1', 'v2'], mru: [] });
  });

  it('ranks with the production client ranking', () => {
    const sessions = sessionsOf([
      [T0 + MINUTE, 'open', 'v2'],
      [T0 + 2 * MINUTE, 'pick', 'v2', 'roadmap'],
    ]);
    const testCase = find(replayMentionEvalSessions(sessions), 0, 'roadmap');
    const candidates: (MentionRankCandidate & { id: string })[] = sessions.views
      .filter((view) => view.kind === 'page' && view.created_ms <= T0 + 2 * MINUTE)
      .map((view) => ({
        id: view.id,
        key: view.key,
        title: view.title,
        lastUsedMs: view.id === 'v2' ? T0 + MINUTE : undefined,
      }));

    expect(testCase.top.ranker).toEqual(
      rankSection(prepareMentionQuery('roadmap'), 'objects', candidates, T0 + 2 * MINUTE, 8).map((found) => found.id)
    );
    expect(testCase.top.ranker).toEqual(['v0', 'v1', 'v2']);
  });

  it("checks the tiers of each ranker arm's own whole order", () => {
    // A ranker that reverses its order whenever pick memory scores a candidate: 'Map' (T0 for
    // 'map') then follows 'Roadmap' and 'Sitemap' (T3) only in the ranking with pick memory.
    const actual = ranker.rankSection;
    const reversedWithPicks = <C extends MentionRankCandidate>(
      query: MentionQuery | string,
      lane: MentionRankLane,
      candidates: readonly C[],
      nowMs: number,
      limit?: number
    ): C[] => {
      const ranked = actual(query, lane, candidates, nowMs, limit);

      return candidates.some((candidate) => candidate.adaptive !== undefined) ? [...ranked].reverse() : ranked;
    };

    const spy = jest.spyOn(ranker, 'rankSection').mockImplementation(reversedWithPicks);

    try {
      const cases = replayMentionEvalSessions({
        ...sessionsOf([
          [T0, 'pick', 'v0', 'map'],
          [T0 + MINUTE, 'pick', 'v0', 'map'],
        ]),
        views: [page('v0', 1, 'Map'), page('v1', 2, 'Roadmap'), page('v2', 3, 'Sitemap')],
      });

      expect(spy).toHaveBeenCalled();
      // Before any pick nothing is scored, so neither order is reversed.
      expect(find(cases, 0, 'map').tierOrderViolations).toEqual({ ranker: 0, ranker_no_picks: 0 });
      expect(find(cases, 1, 'ma').tierOrderViolations).toEqual({ ranker: 1, ranker_no_picks: 0 });
      expect(find(cases, 1, 'map').tierOrderViolations).toEqual({ ranker: 1, ranker_no_picks: 0 });
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a pick of a view before it exists', () => {
    expect(() => replayMentionEvalSessions(sessionsOf([[T0, 'pick', 'v4', 'road']]))).toThrow('does not exist');
  });
});
