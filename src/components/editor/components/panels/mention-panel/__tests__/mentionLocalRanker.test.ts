import { performance } from 'perf_hooks';

import {
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import {
  assignMentionTokens,
  clearMentionRankerCache,
  MENTION_MAX_MATCH_TOKENS,
  MENTION_MAX_MATCH_WORDS,
  MentionRankCandidate,
  MentionRankLane,
  mentionRecencyBucket,
  MentionRecencyBucket,
  mentionServerCandidate,
  mentionTokensStartDistinctWords,
  MentionTier,
  mentionWords,
  objectTier,
  personTier,
  prepareMentionQuery,
  prepareMentionRankCandidates,
  rankSection,
  retierServerSection,
} from '../mentionLocalRanker';
import { mentionItemNavKey } from '../mentionUtils';

import { loadMentionParityFixture } from './mention-parity-helpers';

interface Cases<T> {
  cases: T[];
}

interface TierCase {
  id: string;
  query: string;
  title: string;
  tier: string | null;
}

interface PeopleCase {
  id: string;
  query: string;
  name: string;
  email: string;
  class: string | null;
}

/** A `rank.json` item; omitted fields take the fixture README's defaults. */
interface RankItem {
  key: string;
  title: string;
  email?: string;
  adaptive?: number;
  lift?: boolean;
  present?: boolean;
  used_ago_ms?: number | null;
  server_rank?: number | null;
  requester?: boolean;
}

interface RankCase {
  id: string;
  query: string;
  lane: MentionRankLane;
  limit?: number;
  items: RankItem[];
  expected: string[];
}

interface RankFixture {
  now_ms: number;
  cases: RankCase[];
}

const tiers = loadMentionParityFixture<Cases<TierCase>>('tiers.json').cases;
const people = loadMentionParityFixture<Cases<PeopleCase>>('people.json').cases;
const rank = loadMentionParityFixture<RankFixture>('rank.json');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function tierName(prefix: 'T' | 'C', tier: MentionTier | undefined): string | null {
  return tier === undefined ? null : `${prefix}${tier}`;
}

function rankCandidate(item: RankItem, nowMs: number): MentionRankCandidate {
  return {
    key: item.key,
    title: item.title,
    email: item.email ?? '',
    adaptive: item.adaptive ?? 0,
    lift: item.lift ?? false,
    present: item.present ?? false,
    lastUsedMs: item.used_ago_ms === undefined || item.used_ago_ms === null ? undefined : nowMs - item.used_ago_ms,
    serverRank: item.server_rank ?? undefined,
    requester: item.requester ?? false,
  };
}

function rankKeys(entry: RankCase, items: RankItem[]): string[] {
  const candidates = items.map((item) => rankCandidate(item, rank.now_ms));

  return rankSection(entry.query, entry.lane, candidates, rank.now_ms, entry.limit ?? 20).map(
    (candidate) => candidate.key
  );
}

/** Every order of `n` items. */
function permutations(n: number): number[][] {
  if (n === 0) return [[]];

  return permutations(n - 1).flatMap((rest) =>
    Array.from({ length: rest.length + 1 }, (_, position) => [
      ...rest.slice(0, position),
      n - 1,
      ...rest.slice(position),
    ])
  );
}

/** A small seeded generator (mulberry32), so every run draws the same values. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);

    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The reversed order and `count` seeded shuffles of `n` items. */
function sampledPermutations(n: number, count: number): number[][] {
  const random = seeded(0x2545f491);
  const orders = [Array.from({ length: n }, (_, index) => n - 1 - index)];

  for (let sample = 0; sample < count; sample += 1) {
    const order = Array.from({ length: n }, (_, index) => index);

    for (let index = n - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));

      [order[index], order[swap]] = [order[swap], order[index]];
    }

    orders.push(order);
  }

  return orders;
}

function pageItem(id: string, title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Page,
    object_id: id,
    title,
    mention: { type: MentionTargetKind.Page, page_id: id },
  };
}

function personItem(id: string, title: string, email: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: id,
    title,
    subtitle: email,
    mention: { type: MentionTargetKind.Person, person_id: id, person_name: title, page_id: 'page-open' },
  };
}

function databaseItem(databaseId: string, viewId: string, title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Database,
    object_id: databaseId,
    title,
    database_id: databaseId,
    database_view_id: viewId,
    mention: { type: MentionTargetKind.Database, database_id: databaseId, database_view_id: viewId },
  };
}

function rowItem(databaseId: string, rowId: string, title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.DatabaseRow,
    object_id: rowId,
    title,
    mention: { type: MentionTargetKind.DatabaseRow, database_id: databaseId, row_id: rowId },
  };
}

function linkItem(text: string): MentionSearchResultItem {
  const url = `https://${text}`;

  return {
    kind: MentionTargetKind.ExternalLink,
    title: text,
    subtitle: url,
    mention: { type: MentionTargetKind.ExternalLink, url },
  };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

function titles(found: MentionSearchSection): string[] {
  return found.items.map((item) => item.title);
}

describe('mention-parity tiers.json', () => {
  it.each(tiers.map((entry) => [entry.id, entry] as const))('%s', (_, entry) => {
    expect(tierName('T', objectTier(entry.query, entry.title))).toBe(entry.tier);
  });
});

describe('mention-parity people.json', () => {
  it.each(people.map((entry) => [entry.id, entry] as const))('%s', (_, entry) => {
    expect(tierName('C', personTier(entry.query, entry.name, entry.email))).toBe(entry.class);
  });
});

describe('mention-parity rank.json', () => {
  it.each(rank.cases.map((entry) => [entry.id, entry] as const))('%s', (_, entry) => {
    expect(rankKeys(entry, entry.items)).toEqual(entry.expected);
  });

  // The order is total, as it must be for Dart's unstable sort: every permutation of a small case,
  // and the reversed order plus 200 shuffles of a larger one, rank alike.
  it.each(rank.cases.map((entry) => [entry.id, entry] as const))('%s does not depend on the input order', (_, entry) => {
    const orders =
      entry.items.length <= 6 ? permutations(entry.items.length) : sampledPermutations(entry.items.length, 200);

    orders.forEach((order) => {
      expect(
        rankKeys(
          entry,
          order.map((index) => entry.items[index])
        )
      ).toEqual(entry.expected);
    });
  });
});

describe('the plan vectors', () => {
  it('tiers accents, CJK and the domain as the contract corrects them', () => {
    // MEN-X-02 decision D4: `cafe` is exact for `Café`, as `resume` is for `Résumé`.
    expect(objectTier('cafe', 'Café')).toBe(0);
    expect(objectTier('cafe', 'Café menu')).toBe(1);
    expect(objectTier('resume', 'Résumé')).toBe(0);
    expect(objectTier('路线', '产品路线图')).toBe(2);
    expect(personTier('app', '', 'x@appflowy.io')).toBeUndefined();
  });

  it('orders three Meeting notes pages by recency bucket and keeps an exact title above a recent prefix', () => {
    const now = 100 * DAY;
    const meeting = (key: string, ago: number, serverRank: number) => ({
      key,
      title: 'Meeting notes',
      lastUsedMs: now - ago,
      serverRank,
    });

    expect(
      rankSection(
        'meeting notes',
        'objects',
        [meeting('a', 10 * DAY, 0), meeting('b', 3 * HOUR, 1), meeting('c', 5 * MINUTE, 2)],
        now
      ).map((candidate) => candidate.key)
    ).toEqual(['c', 'b', 'a']);
    expect(
      rankSection(
        'road',
        'objects',
        [
          { key: 'prefix', title: 'Roadmap', lastUsedMs: now - MINUTE, serverRank: 0, adaptive: 900_000 },
          { key: 'exact', title: 'Road', lastUsedMs: now - 40 * DAY, serverRank: 1 },
        ],
        now
      ).map((candidate) => candidate.key)
    ).toEqual(['exact', 'prefix']);
  });
});

describe('the matcher', () => {
  it('prepares queries with at most one token past the bound', () => {
    const query = prepareMentionQuery('  Road\u0085MAP  ');

    expect(query).toEqual({ normalized: 'road map', tokens: ['road', 'map'], hasCjk: false, codePoints: 8 });
    expect(prepareMentionQuery('word '.repeat(100_000)).tokens).toHaveLength(MENTION_MAX_MATCH_TOKENS + 1);
    expect(prepareMentionQuery('word '.repeat(100_000)).codePoints).toBeLessThanOrEqual(512);
    expect(prepareMentionQuery('의록').hasCjk).toBe(true);
    expect(prepareMentionQuery('-')).toMatchObject({ normalized: '-', tokens: [] });
  });

  it('splits words on anything but letters and digits, keeping a CJK run whole', () => {
    expect(mentionWords('(road) map-2026 nathan\u2019s 产品路线图 x²')).toEqual([
      'road',
      'map',
      '2026',
      'nathan',
      's',
      '产品路线图',
      'x²',
    ]);
    expect(mentionWords('a b c', 2)).toEqual(['a', 'b']);
  });

  it('lets query tokens claim distinct title words', () => {
    expect(objectTier('a ab', 'ab a')).toBe(2);
    expect(objectTier('a ab', 'abc')).toBeUndefined();
    expect(objectTier('ab a abc', 'abc ab a')).toBe(2);
  });

  /** Every assignment of tokens to distinct words, tried exhaustively. */
  function bruteForce(tokens: string[], words: string[], used: boolean[]): boolean {
    if (tokens.length === 0) return true;

    const [token, ...rest] = tokens;

    return words.some((word, index) => {
      if (used[index] || !word.startsWith(token)) return false;
      used[index] = true;

      const matched = bruteForce(rest, words, used);

      used[index] = false;
      return matched;
    });
  }

  function sequences(pool: string[], maxLength: number): string[][] {
    const all: string[][] = [[]];
    let frontier: string[][] = [[]];

    for (let length = 0; length < maxLength; length += 1) {
      frontier = frontier.flatMap((prefix) => pool.map((item) => [...prefix, item]));
      all.push(...frontier);
    }

    return all;
  }

  it('assigns tokens to words like an exhaustive search', () => {
    let compared = 0;

    sequences(['a', 'ab', 'b', 'abc'], 3).forEach((tokens) => {
      sequences(['a', 'ab', 'abc', 'b', 'ba'], 4).forEach((words) => {
        const expected =
          tokens.length > 0 &&
          tokens.length <= words.length &&
          bruteForce(
            tokens,
            words,
            words.map(() => false)
          );

        if (assignMentionTokens(tokens, words).matched !== expected) {
          throw new Error(`${JSON.stringify(tokens)} into ${JSON.stringify(words)}: expected ${expected}`);
        }

        if (mentionTokensStartDistinctWords(tokens, words, words.join(' ')) !== expected) {
          throw new Error(`shortcut: ${JSON.stringify(tokens)} into ${JSON.stringify(words)}: expected ${expected}`);
        }

        compared += 1;
      });
    });
    expect(compared).toBeGreaterThan(40_000);
  });

  it('keeps crafted titles from making matching explode', () => {
    const title = `ab ${Array(199).fill('a').join(' ')}`;
    const tokens = ['a', 'a', 'a', 'a', 'a', 'ab'];
    const { matched, steps } = assignMentionTokens(tokens, mentionWords(title));

    expect(matched).toBe(true);
    expect(steps).toBeLessThanOrEqual(tokens.length * tokens.length * MENTION_MAX_MATCH_WORDS);
    expect(objectTier('a a a a a ab', title)).toBe(2);

    const flat = Array(200).fill('a').join(' ');

    expect(objectTier('a a a a a b', flat)).toBeUndefined();
    // A query longer than the token bound still matches as a whole.
    expect(objectTier(Array(13).fill('a').join(' '), flat)).toBe(1);
    // Only the first 64 words take part in word-start matching.
    expect(objectTier('b a', `${flat} b`)).toBeUndefined();
    expect(assignMentionTokens(['b'], [...Array(64).fill('a'), 'b']).matched).toBe(false);
    expect(mentionTokensStartDistinctWords(['b'], [...Array(64).fill('a'), 'b'], 'a b')).toBe(false);
  });

  it('cuts huge queries, titles, names and addresses at 512 code points', () => {
    const huge = `Roadmap ${'x'.repeat(1_000_000)}`;

    expect(objectTier('road', huge)).toBe(1);
    // 507 emoji, a space and `road` are 512 code points but 1,019 UTF-16 units.
    expect(objectTier('road', `${'😀'.repeat(507)} road`)).toBe(2);
    expect(objectTier('road', `${'😀'.repeat(508)} road`)).toBeUndefined();
    expect(personTier('ann', huge.replace('Roadmap', 'Ann'), huge)).toBe(0);
  });

  it('counts Hangul as CJK once NFKD turns it into Jamo', () => {
    expect(objectTier('의록', '주간 회의록')).toBe(2);
    expect(personTier('민수', '김민수', 'minsu@appflowy.io')).toBe(0);
  });

  it('matches queries without letters or digits only literally, never through the domain', () => {
    expect(personTier('-', 'Mary-Jane Watson', 'mj@appflowy.io')).toBe(1);
    expect(personTier('.', 'Anh Nguyen', 'anh.nguyen@appflowy.io')).toBe(2);
    ['@', '.', '-'].forEach((query) => {
      expect([query, personTier(query, 'Brian Chen', 'brian@appflowy.io')]).toEqual([query, undefined]);
    });
    expect(personTier('  ', 'Ann', 'ann@appflowy.io')).toBeUndefined();
    expect(personTier('app', 'Brian Chen', 'brian@appflowy.io')).toBeUndefined();
  });

  it('reuses one prepared text for every query and survives a cleared cache', () => {
    expect(objectTier('road', 'Roadmap')).toBe(1);
    clearMentionRankerCache();
    expect(objectTier(prepareMentionQuery('roadmap'), 'Roadmap')).toBe(0);
    expect(objectTier('', 'Roadmap')).toBeUndefined();
  });
});

describe('client ranking', () => {
  it('puts recency into inclusive buckets and counts a future time as now', () => {
    const now = 100 * DAY;
    const bucket = (age: number) => mentionRecencyBucket(now, now - age);

    expect(bucket(15 * MINUTE)).toBe(MentionRecencyBucket.Within15Minutes);
    expect(bucket(15 * MINUTE + 1)).toBe(MentionRecencyBucket.WithinHour);
    expect(bucket(HOUR)).toBe(MentionRecencyBucket.WithinHour);
    expect(bucket(DAY)).toBe(MentionRecencyBucket.WithinDay);
    expect(bucket(DAY + 1)).toBe(MentionRecencyBucket.Older);
    expect(bucket(-HOUR)).toBe(MentionRecencyBucket.Within15Minutes);
    expect(mentionRecencyBucket(now, undefined)).toBe(MentionRecencyBucket.Never);
    expect(mentionRecencyBucket(now, Number.NaN)).toBe(MentionRecencyBucket.Never);
  });

  it('decides each in-tier key only when every earlier key ties', () => {
    const now = 10 * DAY;
    const page = (key: string, title: string, fields: Partial<MentionRankCandidate> = {}) => ({ key, title, ...fields });
    const ranked = rankSection(
      'plan',
      'objects',
      [
        page('page:8', 'Plan tie'),
        page('page:6', 'Plan s'),
        page('page:5', 'Plan server 1', { serverRank: 1 }),
        page('page:7', 'Plan tie'),
        page('page:4', 'Plan server 0', { serverRank: 0 }),
        page('page:3', 'Plan recent', { lastUsedMs: now - MINUTE }),
        page('page:2', 'Plan present', { present: true }),
        page('page:1', 'Plan picked', { adaptive: 100_000 }),
        page('page:0', 'Plan requester', { requester: true, adaptive: 900_000, present: true }),
      ],
      now
    );

    expect(ranked.map((candidate) => candidate.key)).toEqual([
      'page:1',
      'page:2',
      'page:3',
      'page:4',
      'page:5',
      'page:6',
      'page:7',
      'page:8',
      'page:0',
    ]);
  });

  it('keeps a key listed twice at its better place and applies the limit after ranking', () => {
    const ranked = rankSection(
      'road',
      'objects',
      [
        { key: 'page:1', title: 'Roadmap', serverRank: 3 },
        { key: 'page:2', title: 'Road trip' },
        { key: 'page:1', title: 'Road' },
      ],
      0,
      2
    );

    expect(ranked.map((candidate) => candidate.title)).toEqual(['Road', 'Road trip']);
  });

  it('orders full ties by code point, not UTF-16 unit', () => {
    // U+FF21 sorts before U+1F600 by code point but after its surrogates by UTF-16 unit.
    const ranked = rankSection(
      'notes',
      'objects',
      [
        { key: 'date:\ud83d\ude00', title: 'Notes' },
        { key: 'date:\uff21', title: 'Notes' },
      ],
      0
    );

    expect(ranked.map((candidate) => candidate.key)).toEqual(['date:\uff21', 'date:\ud83d\ude00']);
  });

  it('measures a person with a blank name by their address', () => {
    // The blank name is 21 code points long, the address 6 and the other name 8.
    const blank = { key: 'person:b', title: `${' '.repeat(20)}\u3000`, email: 'x@y.io' };
    const named = { key: 'person:a', title: 'Xavier L', email: 'xl@appflowy.io' };

    expect(rankSection('x', 'people', [named, blank], 0).map((candidate) => candidate.key)).toEqual([
      'person:b',
      'person:a',
    ]);
    // Objects are measured the same way, by what the picker shows.
    expect(rankSection('x', 'objects', [{ key: 'page:a', title: 'Xavier L' }], 0)).toHaveLength(1);
  });

  it('keeps the server order for a bare query and drops local-only candidates', () => {
    const ranked = rankSection(
      ' \u3000',
      'objects',
      [
        { key: 'page:b', title: 'B', serverRank: 1, present: true },
        { key: 'page:local', title: 'Local', lastUsedMs: 0 },
        { key: 'page:a', title: 'A', serverRank: 0 },
        { key: 'page:a', title: 'A again', serverRank: 2 },
      ],
      0
    );

    expect(ranked.map((candidate) => candidate.title)).toEqual(['A', 'B']);
  });

  // MEN-WEB-06 Done-when: an exact title never sorts below a non-exact match, except through the
  // exact-stored-input lift; for people, a better class never sorts below a worse one except so.
  it.each(['objects', 'people'] as const)('never ranks a %s match above a better tier without a lift', (lane) => {
    const random = seeded(lane === 'objects' ? 7 : 11);
    const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];
    const words = ['road', 'roadmap', 'map', 'broad', 'notes', 'plan', 'q3', 'trip', 'ann', 'annie', 'joan', 'x'];
    const queries = ['road', 'roadmap', 'map', 'an', 'ann', 'notes', 'plan', 'road map', 'x'];
    const now = 50 * DAY;
    let checked = 0;

    for (let round = 0; round < 300; round += 1) {
      const query = pick(queries);
      const candidates = Array.from({ length: 12 }, (_, index): MentionRankCandidate => {
        const title =
          random() < 0.25 ? query : Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(words)).join(' ');
        const email = `${pick(words)}.${pick(words)}@appflowy.io`;

        return {
          key: `${lane}:${round}:${index}`,
          title,
          email: lane === 'people' ? email : undefined,
          adaptive: pick([0, 0, 150_000, 600_000, 1_000_000]),
          lift: random() < 0.2,
          present: random() < 0.3,
          lastUsedMs: random() < 0.5 ? now - Math.floor(random() * 3 * DAY) : undefined,
          serverRank: random() < 0.5 ? index : undefined,
          requester: lane === 'people' && random() < 0.1,
        };
      });
      const lexical = (candidate: MentionRankCandidate) =>
        (lane === 'objects'
          ? objectTier(query, candidate.title)
          : personTier(query, candidate.title, candidate.email ?? '')) ?? 4;
      const ranked = rankSection(query, lane, candidates, now);

      ranked.forEach((earlier, position) => {
        ranked.slice(position + 1).forEach((later) => {
          if (lexical(earlier) <= lexical(later)) return;
          // Only a lift moves an item, by exactly one tier.
          expect({ lift: earlier.lift, by: lexical(earlier) - lexical(later) }).toEqual({ lift: true, by: 1 });
          checked += 1;
        });
      });
    }

    expect(checked).toBeGreaterThan(0);
  });
});

describe('retierServerSection', () => {
  const now = 100 * DAY;

  it('moves a body-only hit below every title match and keeps the server order inside a tier', () => {
    const pages = section(MentionSearchSectionKind.Pages, [
      pageItem('p1', 'Weekly notes'),
      pageItem('p2', 'Broadway notes'),
      pageItem('p3', 'Roadmap 2026'),
      pageItem('p4', 'Roadmap Q3'),
      pageItem('p5', 'Road'),
    ]);

    // T0 `Road`, T1 in the server's order (not by length), T3, then the body hit.
    expect(titles(retierServerSection('road', pages, { nowMs: now }))).toEqual([
      'Road',
      'Roadmap 2026',
      'Roadmap Q3',
      'Broadway notes',
      'Weekly notes',
    ]);
    // MEN-WEB-08's vector: the body match no longer comes first.
    expect(
      titles(
        retierServerSection(
          'road',
          section(MentionSearchSectionKind.Pages, [pageItem('w', 'Weekly notes'), pageItem('r', 'Roadmap 2026')]),
          { nowMs: now }
        )
      )
    ).toEqual(['Roadmap 2026', 'Weekly notes']);
  });

  it('ranks people from an older server by class, never through the domain', () => {
    const team = section(MentionSearchSectionKind.People, [
      personItem('u1', 'Brian Chen', 'brian@appflowy.io'),
      personItem('u2', 'x@appflowy.io', 'x@appflowy.io'),
      personItem('u3', 'Annie Wang', 'annie@appflowy.io'),
    ]);

    expect(titles(retierServerSection('an', team, { nowMs: now }))).toEqual([
      'Annie Wang',
      'Brian Chen',
      'x@appflowy.io',
    ]);
    expect(titles(retierServerSection('app', team, { nowMs: now }))).toEqual([
      'Brian Chen',
      'x@appflowy.io',
      'Annie Wang',
    ]);
    expect(mentionServerCandidate(team.items[1], 1)).toMatchObject({ title: '', email: 'x@appflowy.io' });
  });

  it("applies the client's signals inside a tier and a lift across one", () => {
    const pages = section(MentionSearchSectionKind.Pages, [
      pageItem('p1', 'Road'),
      pageItem('p2', 'Roadmap 2026'),
      pageItem('p3', 'Roadmap Q3'),
      pageItem('p4', 'Roadster'),
    ]);
    const signals = new Map<string, { lastUsedMs?: number; present?: boolean; adaptive?: number; lift?: boolean }>([
      [mentionItemNavKey(pages.items[2]), { lastUsedMs: now - 5 * MINUTE }],
      [mentionItemNavKey(pages.items[3]), { adaptive: 700_000, lift: true }],
    ]);

    expect(titles(retierServerSection('road', pages, { nowMs: now, signals: (key) => signals.get(key) }))).toEqual([
      'Roadster',
      'Road',
      'Roadmap Q3',
      'Roadmap 2026',
    ]);

    const team = section(MentionSearchSectionKind.People, [
      personItem('me', 'Ann Lee', 'ann@appflowy.io'),
      personItem('u2', 'Anna Bell', 'anna@appflowy.io'),
    ]);

    expect(
      titles(
        retierServerSection('ann', team, {
          nowMs: now,
          signals: (key) => (key === 'person:me' ? { requester: true } : undefined),
        })
      )
    ).toEqual(['Anna Bell', 'Ann Lee']);
  });

  it('keeps Dates, Links, a bare query and an ordered section as they are', () => {
    const dates = section(MentionSearchSectionKind.Dates, [
      {
        kind: MentionTargetKind.Date,
        title: 'Tomorrow',
        mention: { type: MentionTargetKind.Date, date: '2026-01-02T00:00:00Z' },
      },
      {
        kind: MentionTargetKind.Date,
        title: 'Today',
        mention: { type: MentionTargetKind.Date, date: '2026-01-01T00:00:00Z' },
      },
    ]);
    const pages = section(MentionSearchSectionKind.Pages, [pageItem('p1', 'Weekly notes'), pageItem('p2', 'Roadmap')]);
    const ordered = section(MentionSearchSectionKind.Pages, [pageItem('p2', 'Roadmap'), pageItem('p1', 'Weekly notes')]);
    // Ranked as objects, the second link would move first.
    const links = section(MentionSearchSectionKind.Links, [linkItem('example.com/notes'), linkItem('road.example.com')]);

    expect(retierServerSection('to', dates, { nowMs: now })).toBe(dates);
    expect(retierServerSection('road', links, { nowMs: now })).toBe(links);
    expect(retierServerSection('', pages, { nowMs: now })).toBe(pages);
    expect(retierServerSection(' ', pages, { nowMs: now })).toBe(pages);
    expect(retierServerSection('road', ordered, { nowMs: now })).toBe(ordered);
    expect(
      retierServerSection('road', section(MentionSearchSectionKind.Suggested, pages.items), { nowMs: now }).items
    ).toBe(pages.items);
  });

  it('re-tiers Databases and Database rows sections as it does Pages', () => {
    // A database Search found through a view name or a row's cells: neither title matches.
    const databases = section(MentionSearchSectionKind.Databases, [
      databaseItem('db1', 'grid1', 'Team tasks'),
      databaseItem('db2', 'board2', 'Broadway shows'),
      databaseItem('db3', 'grid3', 'Roadmap'),
    ]);
    const rows = section(MentionSearchSectionKind.DatabaseRows, [
      rowItem('db1', 'r1', 'Q3 budget'),
      rowItem('db1', 'r2', 'Road trip'),
      rowItem('db1', 'r3', 'Broadway'),
    ]);

    expect(titles(retierServerSection('road', databases, { nowMs: now }))).toEqual([
      'Roadmap',
      'Broadway shows',
      'Team tasks',
    ]);
    expect(titles(retierServerSection('road', rows, { nowMs: now }))).toEqual(['Road trip', 'Broadway', 'Q3 budget']);
  });

  it('keeps an item listed twice at its first place', () => {
    const pages = section(MentionSearchSectionKind.Pages, [
      pageItem('p1', 'Roadmap'),
      pageItem('p2', 'Road trip'),
      pageItem('p1', 'Roadmap'),
    ]);

    expect(retierServerSection('road', pages, { nowMs: now }).items.map(mentionItemNavKey)).toEqual([
      'page:p1',
      'page:p2',
    ]);
  });

  // `merge.json` cases with no local items, picks or rows answer are the server's sections re-tiered.
  describe('mention-parity merge.json, server-only cases', () => {
    interface MergeCase {
      id: string;
      request: { query: string };
      local: unknown[];
      picks?: unknown[];
      rows_server?: unknown;
      server: { sections: MentionSearchSection[] };
      expected: { kind: string; items: { key: string; title: string }[] }[];
    }

    const merge = loadMentionParityFixture<{ now_ms: number; cases: MergeCase[] }>('merge.json');
    const serverOnly = merge.cases.filter(
      (entry) => entry.local.length === 0 && (entry.picks ?? []).length === 0 && entry.rows_server === undefined
    );

    it('include typed and bare cases', () => {
      expect(serverOnly.map((entry) => entry.id)).toEqual(
        expect.arrayContaining(['rows-stay-inside-pages', 'a-blank-name-never-matches-through-the-domain'])
      );
    });

    it.each(serverOnly.map((entry) => [entry.id, entry] as const))('%s', (_, entry) => {
      const sections = entry.server.sections.map((found) =>
        retierServerSection(entry.request.query, found, { nowMs: merge.now_ms })
      );

      expect(
        sections.map((found) => ({
          kind: found.kind,
          items: found.items.map((item) => ({ key: mentionItemNavKey(item), title: item.title })),
        }))
      ).toEqual(
        entry.expected.map((found) => ({
          kind: found.kind,
          items: found.items.map(({ key, title }) => ({ key, title })),
        }))
      );
    });
  });
});

describe('mentionLocalRanker dependencies', () => {
  it('loads without React', () => {
    jest.isolateModules(() => {
      jest.doMock('react', () => {
        throw new Error('the ranker must not load React');
      });

      const ranker = require('../mentionLocalRanker') as typeof import('../mentionLocalRanker');

      expect(ranker.objectTier('road', 'Roadmap')).toBe(1);
    });
    jest.dontMock('react');
  });
});

describe('the prepared-text cache', () => {
  /** How often `String.prototype.normalize` runs while `run` does, which only preparing a non-ASCII text does. */
  function countNormalizeCalls(run: () => void): number {
    const spy = jest.spyOn(String.prototype, 'normalize');

    try {
      run();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  const accented = (count: number): MentionRankCandidate[] =>
    Array.from({ length: count }, (_, index) => ({ key: `page:${index}`, title: `Caf\u00e9 ${index}` }));

  it('prepares each title once, not on every keystroke', () => {
    clearMentionRankerCache();

    const pages = accented(3000);

    expect(countNormalizeCalls(() => rankSection('cafe', 'objects', pages, 0, 20))).toBe(pages.length);
    expect(
      countNormalizeCalls(() =>
        ['c', 'ca', 'caf', 'cafe 1', 'cafe 12'].forEach((query) => rankSection(query, 'objects', pages, 0, 20))
      )
    ).toBe(0);
  });

  it('can prepare candidates before the first keystroke', () => {
    clearMentionRankerCache();

    const team = accented(500).map((candidate) => ({ ...candidate, email: `jos\u00e9.${candidate.key}@appflowy.io` }));

    prepareMentionRankCandidates(team);
    expect(countNormalizeCalls(() => rankSection('jose', 'people', team, 0, 20))).toBe(0);
  });

  /** Accented candidates of a section other than Pages, whose titles are their own. */
  const accentedSection = (kind: string, count: number): MentionRankCandidate[] =>
    Array.from({ length: count }, (_, index) => ({ key: `${kind}:${index}`, title: `${kind} café ${index}` }));
  const accentedTeam = (count: number): MentionRankCandidate[] =>
    Array.from({ length: count }, (_, index) => ({
      key: `person:${index}`,
      title: `José ${index}`,
      email: `josé.${index}@appflowy.io`,
    }));
  /** A server answer of new titles, accented unless `ascii`, which `normalize` never sees. */
  const answer = (keystroke: number, count: number, ascii = false): MentionRankCandidate[] =>
    Array.from({ length: count }, (_, index) => ({
      key: `page:s${keystroke}-${index}`,
      title: ascii ? `Notes ${keystroke}-${index}` : `Résumé ${keystroke}-${index}`,
      serverRank: index,
    }));

  afterEach(() => clearMentionRankerCache());

  it('keeps every section a keystroke ranks, however many texts they hold together', () => {
    clearMentionRankerCache();

    // 16,000 titles and names in three sections: past the 10,000 a cache holds before it first
    // sweeps, and enough for a second sweep in the same keystroke.
    const pages = accented(8000);
    const databases = accentedSection('database', 4000);
    const team = accentedTeam(4000);
    const keystroke = (query: string) => {
      rankSection(query, 'objects', pages, 0, 20);
      rankSection(query, 'objects', databases, 0, 20);
      rankSection(query, 'people', team, 0, 20);
    };

    expect(countNormalizeCalls(() => keystroke('c'))).toBe(8000 + 4000 + 2 * 4000);
    ['ca', 'caf', 'cafe'].forEach((query) => {
      expect([query, countNormalizeCalls(() => keystroke(query))]).toEqual([query, 0]);
    });
  });

  it("prepares only each keystroke's new titles and forgets past server answers", () => {
    clearMentionRankerCache();

    const pages = accented(1500);
    const databases = accentedSection('database', 500);
    const team = accentedTeam(500);
    // The new titles come first, so a sweep runs before the keystroke reads anything else.
    const keystroke = (n: number) => {
      rankSection(`q${n}`, 'objects', [...answer(n, 100), ...pages], 0, 20);
      rankSection(`q${n}`, 'objects', databases, 0, 20);
      rankSection(`q${n}`, 'people', team, 0, 20);
    };

    keystroke(0);
    // 2,600 texts and 100 more a keystroke: the cache sweeps three times.
    for (let n = 1; n <= 200; n += 1) {
      expect([n, countNormalizeCalls(() => keystroke(n))]).toEqual([n, 100]);
    }

    expect(countNormalizeCalls(() => rankSection('again', 'objects', answer(1, 100), 0, 20))).toBe(100);
    expect(countNormalizeCalls(() => rankSection('again', 'objects', answer(200, 100), 0, 20))).toBe(0);
  });

  it('keeps a section ranked only now and then, and texts read before a stale query', () => {
    clearMentionRankerCache();

    const pages = accented(2000);
    const team = accentedTeam(1000);
    // Each keystroke also ranks the previous answer with the previous query, then its own again,
    // so three passes go by; people are ranked every fifth keystroke only.
    const keystroke = (n: number) => {
      rankSection(`q${n}`, 'objects', [...answer(n, 200), ...pages], 0, 20);
      if (n > 0) rankSection(`q${n - 1}`, 'objects', answer(n - 1, 200), 0, 20);
      rankSection(`q${n}`, 'objects', answer(n, 200), 0, 20);
      if (n % 5 === 0) rankSection(`q${n}`, 'people', team, 0, 20);
    };

    keystroke(0);
    for (let n = 1; n <= 150; n += 1) {
      expect([n, countNormalizeCalls(() => keystroke(n))]).toEqual([n, 200]);
    }
  });

  it("keeps the previous keystroke's texts when new titles fill the cache on every keystroke", () => {
    clearMentionRankerCache();

    const pages = accented(3000);
    // 12,000 new titles around the pages make the cache sweep before and after it reads them.
    const keystroke = (n: number) => {
      const fresh = answer(n, 12_000, true);

      rankSection(`q${n}`, 'objects', [...fresh.slice(0, 6000), ...pages, ...fresh.slice(6000)], 0, 20);
    };

    keystroke(0);
    for (let n = 1; n <= 10; n += 1) {
      expect([n, countNormalizeCalls(() => keystroke(n))]).toEqual([n, 0]);
    }
  });

  it('prepares texts too long to key a cache on every ranking', () => {
    clearMentionRankerCache();

    // Equal-length titles past the 16,383 UTF-16 units above which V8 hashes a string by its
    // length alone; uncached, each costs its first 512 code points and a count of the rest.
    const long = Array.from({ length: 20 }, (_, index) => ({
      key: `page:long${index}`,
      title: `Café ${'x'.repeat(20_000)} ${String(index).padStart(3, '0')}`,
    }));
    const short = { key: 'page:short', title: 'Café court' };

    expect(countNormalizeCalls(() => rankSection('cafe', 'objects', [...long, short], 0, 30))).toBe(21);
    expect(countNormalizeCalls(() => rankSection('cafe x', 'objects', [...long, short], 0, 30))).toBe(20);
    expect(long.map((candidate) => objectTier('cafe', candidate.title))).toEqual(long.map(() => 1));

    const address = `zoë.${'x'.repeat(20_000)}@appflowy.io`;

    expect(countNormalizeCalls(() => personTier('zoe', 'Zoë', address))).toBe(2);
    expect(countNormalizeCalls(() => personTier('zoe', 'Zoë', address))).toBe(1);
  });
});

describe('mention ranker performance', () => {
  const PAGES = 5000;
  const PEOPLE = 500;
  const vocabulary = [
    'road',
    'roadmap',
    'meeting',
    'notes',
    'weekly',
    'sync',
    'plan',
    'planning',
    'q3',
    'q4',
    '2026',
    'design',
    'review',
    'spec',
    'launch',
    'résumé',
    'café',
    'budget',
    'team',
    'offsite',
    'retro',
    'okr',
    'product',
    'marketing',
    'hiring',
    'onboarding',
    'broadway',
    'trip',
    '产品路线图',
    '会议',
    '주간',
    '회의록',
  ];
  const names = [
    'Annie',
    'Andy',
    'Brian',
    'Joan',
    'José',
    'Zoë',
    'Nathan',
    'Lucas',
    'Mia',
    'Chen',
    'Wang',
    'Lee',
    '王小明',
  ];
  const queries = [
    'r',
    'ro',
    'roa',
    'road',
    'roadm',
    'meet',
    'meeting n',
    'q3',
    'pl',
    'plan',
    'an',
    'ann',
    'jo',
    'jose',
    'x@',
    'appflowy.io',
    '路线',
    '회의',
    'notes',
    'résumé',
  ];

  function build(random: () => number) {
    const now = 400 * DAY;
    const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];
    const pages: MentionRankCandidate[] = Array.from({ length: PAGES }, (_, index) => ({
      key: `page:00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      title: Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(vocabulary)).join(' '),
      lastUsedMs: random() < 0.3 ? now - Math.floor(random() * 30 * DAY) : undefined,
      present: random() < 0.02,
      serverRank: index < 20 ? index : undefined,
    }));
    const team: MentionRankCandidate[] = Array.from({ length: PEOPLE }, (_, index) => {
      const first = pick(names);
      const last = pick(names);

      return {
        key: `person:00000000-0000-4000-9000-${index.toString(16).padStart(12, '0')}`,
        title: `${first} ${last}`,
        email: `${first}.${last}${index}@appflowy.io`.toLowerCase(),
        lastUsedMs: random() < 0.2 ? now - Math.floor(random() * 30 * DAY) : undefined,
        serverRank: index < 8 ? index : undefined,
      };
    });

    return { now, pages, team };
  }

  it('ranks 5,000 pages and 500 people per keystroke within the budget', () => {
    clearMentionRankerCache();

    const { now, pages, team } = build(seeded(42));
    const rankBoth = (query: string) => {
      const prepared = prepareMentionQuery(query);

      return (
        rankSection(prepared, 'objects', pages, now, 20).length + rankSection(prepared, 'people', team, now, 20).length
      );
    };
    // The first keystroke prepares every title, name and address.
    const coldStartedAt = performance.now();

    rankBoth(queries[0]);

    const cold = performance.now() - coldStartedAt;

    queries.forEach(rankBoth);

    const durations: number[] = [];
    let ranked = 0;

    for (let round = 0; round < 5; round += 1) {
      queries.forEach((query) => {
        const startedAt = performance.now();

        ranked += rankBoth(query);
        durations.push(performance.now() - startedAt);
      });
    }

    expect(ranked).toBeGreaterThan(0);

    durations.sort((left, right) => left - right);

    const median = durations[Math.floor(durations.length / 2)];
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1];

    if (process.env.MENTION_RANKER_PERF_LOG) {
      console.info(
        `mention ranker: ${PAGES} pages + ${PEOPLE} people, ${durations.length} keystrokes: median ${median.toFixed(
          2
        )} ms, p95 ${p95.toFixed(2)} ms, cold first keystroke ${cold.toFixed(2)} ms`
      );
    }

    // The plan's budget is 3 ms median and 6 ms p95; the bounds are looser for loaded CI machines and
    // coverage instrumentation, and still fail if titles were normalized on every keystroke.
    expect(median).toBeLessThan(15);
    expect(p95).toBeLessThan(30);
  });

  it('ranks the thousands of matches of a one-letter query best tier first', () => {
    const { now, pages } = build(seeded(7));
    const ranked = rankSection('r', 'objects', pages, now, 20);

    expect(ranked).toHaveLength(20);
    // Every result starts a word with `r`, best tier first.
    expect(ranked.map((candidate) => objectTier('r', candidate.title))).toEqual(
      [...ranked.map((candidate) => objectTier('r', candidate.title))].sort()
    );
  });
});
