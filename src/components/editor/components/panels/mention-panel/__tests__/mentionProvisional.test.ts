import {
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
} from '@/application/types';

import {
  buildMentionProvisionalSections,
  capMentionSections,
  longestCachedMentionPrefixSections,
  MENTION_PROVISIONAL_PREFIX_STEPS,
  mentionAnswerMissingKinds,
  mentionInterimMissingKinds,
  mentionProvisionalItemMatches,
  MentionProvisionalInput,
  mentionProvisionalSectionKind,
  withoutMentionKeys,
  withProvisionalItems,
} from '../mentionProvisional';
import { MentionLaneOutcome } from '../mentionSearchFetch';
import { buildMentionSearchCacheKey, mentionItemNavKey } from '../mentionUtils';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function page(n: number, title: string): MentionSearchResultItem {
  const id = uuid(n);

  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

function database(n: number, title: string, viewN: number): MentionSearchResultItem {
  const id = uuid(n);
  const viewId = uuid(viewN);

  return {
    kind: MentionTargetKind.Database,
    object_id: id,
    title,
    database_id: id,
    database_view_id: viewId,
    mention: { type: MentionTargetKind.Database, database_id: id, database_view_id: viewId },
  };
}

function row(n: number, title: string): MentionSearchResultItem {
  const id = uuid(n);

  return {
    kind: MentionTargetKind.DatabaseRow,
    object_id: id,
    title,
    mention: { type: MentionTargetKind.DatabaseRow, database_id: uuid(500), database_view_id: uuid(501), row_id: id },
  };
}

// Cloud titles a person with a blank name by their address, and sends the address as the subtitle.
function person(n: number, name: string, email: string): MentionSearchResultItem {
  const id = uuid(n);

  return {
    kind: MentionTargetKind.Person,
    object_id: id,
    title: name || email,
    subtitle: email,
    mention: { type: MentionTargetKind.Person, person_id: id, person_name: name, page_id: uuid(999) },
  };
}

function quickPick(kind: MentionTargetKind.Date | MentionTargetKind.Reminder, title: string): MentionSearchResultItem {
  return {
    kind,
    title,
    subtitle: '2026-11-10',
    mention: { type: MentionTargetKind.Date, start: '2026-11-10T00:00:00Z' },
  };
}

function link(url: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.ExternalLink,
    title: url,
    subtitle: url,
    mention: { type: MentionType.externalLink, url },
  };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[], status = 'ok'): MentionSearchSection {
  return { kind, title: `${kind} title`, items, has_more: false, status };
}

function titlesOf(sections: readonly MentionSearchSection[]) {
  return sections.map((found) => [found.kind, found.items.map((item) => item.title)]);
}

const ALL_KINDS = Object.values(MentionTargetKind);
const ROADMAP = page(1, 'Roadmap');
const BUDGET = page(2, 'Budget');
const ROAD_TRIP = page(3, 'Road trip');
const WEEKLY = page(4, 'Weekly notes');

function provisional(
  query: string,
  sources: MentionProvisionalInput['sources'],
  extra: Partial<MentionProvisionalInput> = {}
) {
  return buildMentionProvisionalSections({
    query,
    sources,
    include: ALL_KINDS,
    sectionTitle: (kind) => `fallback ${kind}`,
    ...extra,
  });
}

describe('mentionProvisional', () => {
  describe('buildMentionProvisionalSections', () => {
    it('keeps what still matches the new query: Roadmap for r, not Budget', () => {
      const bare = [section(MentionSearchSectionKind.Pages, [ROADMAP, BUDGET])];

      expect(titlesOf(provisional('r', [undefined, undefined, bare]))).toEqual([
        [MentionSearchSectionKind.Pages, ['Roadmap']],
      ]);
    });

    it('keeps pages, databases and rows at T3 or better, and drops a title that only the body could match', () => {
      const sources = [
        [
          section(MentionSearchSectionKind.Pages, [
            page(10, 'ad'),
            page(11, 'Advent'),
            page(12, 'Road to ad hoc'),
            page(13, 'Roadside'),
            // Only the body matched `ad`.
            WEEKLY,
            row(14, 'Leadership row'),
          ]),
          section(MentionSearchSectionKind.Databases, [database(15, 'Ad tracker', 16), database(17, 'Inventory', 18)]),
        ],
      ];

      expect(titlesOf(provisional('ad', sources))).toEqual([
        [MentionSearchSectionKind.Pages, ['ad', 'Advent', 'Road to ad hoc', 'Roadside', 'Leadership row']],
        [MentionSearchSectionKind.Databases, ['Ad tracker']],
      ]);
      expect(mentionProvisionalItemMatches('ad', WEEKLY)).toBe(false);
      // One code point matches no substring (T3 needs two).
      expect(mentionProvisionalItemMatches('d', page(19, 'Roadside'))).toBe(false);
    });

    it('matches people by name and address local part, never by the domain alone', () => {
      const people = [
        section(MentionSearchSectionKind.People, [
          person(20, 'Annie Wang', 'annie@appflowy.io'),
          person(21, 'Dana Andersen', 'dana@example.com'),
          person(22, 'Brian Chen', 'brian@appflowy.io'),
          // A blank name is titled by the address, whose domain never matches as a name.
          person(23, '', 'zed@appflowy.io'),
        ]),
      ];

      // Annie and Dana at C0 (a name word starts with `an`), Brian at C1 (his name contains it).
      expect(titlesOf(provisional('an', [people]))).toEqual([
        [MentionSearchSectionKind.People, ['Annie Wang', 'Dana Andersen', 'Brian Chen']],
      ]);
      expect(titlesOf(provisional('app', [people]))).toEqual([]);
      expect(titlesOf(provisional('zed', [people]))).toEqual([[MentionSearchSectionKind.People, ['zed@appflowy.io']]]);
      expect(titlesOf(provisional('brian@app', [people]))).toEqual([[MentionSearchSectionKind.People, ['Brian Chen']]]);
    });

    it('keeps quick picks that match at a word start, as Cloud does, and never a link', () => {
      const sources = [
        [
          section(MentionSearchSectionKind.Dates, [
            quickPick(MentionTargetKind.Date, 'Today'),
            quickPick(MentionTargetKind.Date, 'Tomorrow'),
            quickPick(MentionTargetKind.Date, 'Yesterday'),
            quickPick(MentionTargetKind.Reminder, 'Reminder tomorrow 9 AM'),
          ]),
          section(MentionSearchSectionKind.Links, [link('https://to.example')]),
        ],
      ];

      expect(titlesOf(provisional('to', sources))).toEqual([
        [MentionSearchSectionKind.Dates, ['Today', 'Tomorrow', 'Reminder tomorrow 9 AM']],
      ]);
      // `es` is inside "Yesterday", which Cloud does not offer for it (T3).
      expect(titlesOf(provisional('es', sources))).toEqual([]);
    });

    it('lists an item once, with the first source body, and keeps the sources order', () => {
      const renamed = { ...ROADMAP, title: 'Budget plan' };
      const screen = [section(MentionSearchSectionKind.Pages, [ROAD_TRIP, renamed])];
      const prefix = [section(MentionSearchSectionKind.Pages, [page(30, 'Roast'), ROAD_TRIP])];
      const bare = [section(MentionSearchSectionKind.Pages, [ROADMAP, page(31, 'Robot')])];

      // The screen renamed Roadmap away, so its older title in the bare answer does not bring it back.
      expect(titlesOf(provisional('ro', [screen, prefix, bare]))).toEqual([
        [MentionSearchSectionKind.Pages, ['Road trip', 'Roast', 'Robot']],
      ]);
    });

    it('puts each kind in its section, in the canonical order, rows inside Pages', () => {
      const sources = [
        [
          section(MentionSearchSectionKind.DatabaseRows, [row(40, 'Road row')]),
          section(MentionSearchSectionKind.Dates, [quickPick(MentionTargetKind.Date, 'Road day')]),
        ],
        [
          section(MentionSearchSectionKind.Databases, [database(41, 'Road database', 42)]),
          section(MentionSearchSectionKind.Pages, [page(43, 'Road page')]),
          section(MentionSearchSectionKind.People, [person(44, 'Road Runner', 'runner@example.com')]),
          section(MentionSearchSectionKind.Suggested, [page(45, 'Road suggestion')]),
        ],
      ];
      const sections = provisional('road', sources);

      expect(titlesOf(sections)).toEqual([
        [MentionSearchSectionKind.People, ['Road Runner']],
        [MentionSearchSectionKind.Pages, ['Road row', 'Road page', 'Road suggestion']],
        [MentionSearchSectionKind.Databases, ['Road database']],
        [MentionSearchSectionKind.Dates, ['Road day']],
      ]);
      // Titles come from a source section of the same kind; rows from a rows section do not title Pages.
      expect(sections.map(({ title }) => title)).toEqual([
        'people title',
        'pages title',
        'databases title',
        'dates title',
      ]);
      expect(provisional('road', [sources[0]]).map(({ title }) => title)).toEqual(['fallback pages', 'dates title']);
      expect(sections.every(({ status, has_more }) => status === 'ok' && !has_more)).toBe(true);
    });

    it('skips kinds the picker did not ask for, and items the caller hides', () => {
      const sources = [
        [
          section(MentionSearchSectionKind.Pages, [], 'failed'),
          section(MentionSearchSectionKind.People, [person(50, 'Rosa', 'rosa@example.com')]),
          section(MentionSearchSectionKind.Pages, [ROADMAP, ROAD_TRIP, row(51, 'Roadmap row')]),
        ],
      ];

      expect(
        titlesOf(
          provisional('ro', sources, {
            include: [MentionTargetKind.Page, MentionTargetKind.Database],
            hides: (item) => item === ROAD_TRIP,
          })
        )
      ).toEqual([[MentionSearchSectionKind.Pages, ['Roadmap']]]);
    });

    it('narrows nothing for a query that normalizes to nothing', () => {
      const bare = [section(MentionSearchSectionKind.Pages, [ROADMAP, BUDGET])];

      expect(provisional('', [bare])).toEqual([]);
      expect(provisional(' 　', [bare])).toEqual([]);
    });

    it('never lists a link section or an item from it', () => {
      expect(mentionProvisionalSectionKind(MentionTargetKind.ExternalLink)).toBeUndefined();
      expect(mentionProvisionalSectionKind(MentionTargetKind.DatabaseRow)).toBe(MentionSearchSectionKind.Pages);
    });
  });

  describe('longestCachedMentionPrefixSections', () => {
    const request = { limit: 20, include: [MentionTargetKind.Page] };
    const keyOf = (prefix: string) =>
      prefix.trim() ? buildMentionSearchCacheKey({ ...request, query: prefix }) : undefined;

    function cacheOf(entries: Record<string, MentionSearchSection[]>) {
      const cache = new Map(Object.entries(entries).map(([query, sections]) => [keyOf(query), sections]));
      const read = jest.fn((key: string) => cache.get(key));

      return { read };
    }

    it('finds the longest cached prefix, shorter by one code point at a time', () => {
      const ro = [section(MentionSearchSectionKind.Pages, [ROADMAP])];
      const r = [section(MentionSearchSectionKind.Pages, [ROAD_TRIP])];
      const { read } = cacheOf({ ro, r });

      expect(longestCachedMentionPrefixSections('road', keyOf, read)).toBe(ro);
      expect(read).toHaveBeenCalledTimes(2);
      expect(longestCachedMentionPrefixSections('rx', keyOf, read)).toBe(r);
    });

    it('stops at one code point and never reads the query itself or a bare prefix', () => {
      const { read } = cacheOf({ road: [section(MentionSearchSectionKind.Pages, [ROADMAP])] });

      expect(longestCachedMentionPrefixSections('road', keyOf, read)).toBeUndefined();
      expect(longestCachedMentionPrefixSections(' r', keyOf, read)).toBeUndefined();
      expect(read.mock.calls.map(([key]) => JSON.parse(key).query)).toEqual(['roa', 'ro', 'r']);
    });

    it('counts code points, and reads a key once however many prefixes share it', () => {
      const emoji = [section(MentionSearchSectionKind.Pages, [page(60, '😀 notes')])];
      const { read } = cacheOf({ '😀': emoji });

      expect(longestCachedMentionPrefixSections('😀😀', keyOf, read)).toBe(emoji);
      expect(longestCachedMentionPrefixSections('Ro  x', keyOf, cacheOf({}).read)).toBeUndefined();

      const once = cacheOf({});

      longestCachedMentionPrefixSections('ro   x', keyOf, once.read);
      // `ro   ` and `ro  ` and `ro ` all key as `ro`.
      expect(once.read.mock.calls.map(([key]) => JSON.parse(key).query)).toEqual(['ro', 'r']);
    });

    it(`looks at most ${MENTION_PROVISIONAL_PREFIX_STEPS} prefixes back, counted in code points`, () => {
      const { read } = cacheOf({ a: [section(MentionSearchSectionKind.Pages, [page(61, 'a')])] });
      const long = `a${'b'.repeat(MENTION_PROVISIONAL_PREFIX_STEPS + 1)}`;

      expect(longestCachedMentionPrefixSections(long, keyOf, read)).toBeUndefined();
      expect(read).toHaveBeenCalledTimes(MENTION_PROVISIONAL_PREFIX_STEPS);
      expect(longestCachedMentionPrefixSections(long.slice(0, -1), keyOf, read)).toBeDefined();
      // 64 emoji are 128 UTF-16 units, and 64 prefixes still reach `a`.
      expect(
        longestCachedMentionPrefixSections(`a${'😀'.repeat(MENTION_PROVISIONAL_PREFIX_STEPS)}`, keyOf, read)
      ).toBeDefined();
    });
  });

  describe('missing kinds', () => {
    const primary: MentionSearchRequest = {
      query: 'road',
      include: [MentionTargetKind.Person, MentionTargetKind.Page, MentionTargetKind.Database, MentionTargetKind.Date],
    };
    const rows: MentionSearchRequest = { query: 'road', include: [MentionTargetKind.DatabaseRow] };
    const answered = (request: MentionSearchRequest, response: MentionSearchResponse): MentionLaneOutcome => ({
      request,
      status: 'ok',
      response,
    });

    it('lacks nothing when every request answered completely', () => {
      expect(
        mentionAnswerMissingKinds([
          answered(primary, { sections: [section(MentionSearchSectionKind.Pages, [ROADMAP])], partial: true }),
          answered(rows, { sections: [] }),
        ]).size
      ).toBe(0);
    });

    it('lacks every kind of a request that did not answer', () => {
      expect([
        ...mentionAnswerMissingKinds([
          answered(primary, { sections: [] }),
          { request: rows, status: 'timeout', error: new Error('deadline') },
        ]),
      ]).toEqual([MentionTargetKind.DatabaseRow]);
      expect(
        new Set(mentionAnswerMissingKinds([{ request: primary, status: 'failed' }, answered(rows, { sections: [] })]))
      ).toEqual(new Set(primary.include));
      expect(new Set(mentionAnswerMissingKinds([{ request: { query: 'road' }, status: 'offline' }]))).toEqual(
        new Set(ALL_KINDS)
      );
    });

    it('lacks the kinds of a failed section, as far as the request asked for them', () => {
      const failedPages = { sections: [section(MentionSearchSectionKind.Pages, [], 'failed')], partial: true };

      expect([...mentionAnswerMissingKinds([answered(primary, failedPages)])]).toEqual([MentionTargetKind.Page]);
      // Search returns rows inside Pages, so a failed Pages section of the rows request lacks the rows.
      expect([...mentionAnswerMissingKinds([answered(rows, failedPages)])]).toEqual([MentionTargetKind.DatabaseRow]);
    });

    it('lacks the rows of a rows answer that was superseded', () => {
      expect([...mentionAnswerMissingKinds([answered(rows, { sections: [], partial: true })])]).toEqual([
        MentionTargetKind.DatabaseRow,
      ]);
    });

    it('lacks the rows while an early answer waits for them, and the kinds of its failed sections', () => {
      expect([...mentionInterimMissingKinds([section(MentionSearchSectionKind.Pages, [ROADMAP])])]).toEqual([
        MentionTargetKind.DatabaseRow,
      ]);
      expect(
        new Set(
          mentionInterimMissingKinds([
            section(MentionSearchSectionKind.People, [], 'failed'),
            section(MentionSearchSectionKind.Pages, [ROADMAP]),
          ])
        )
      ).toEqual(new Set([MentionTargetKind.DatabaseRow, MentionTargetKind.Person]));
    });
  });

  describe('withProvisionalItems', () => {
    const provisionalSections = [
      section(MentionSearchSectionKind.People, [person(70, 'Rosa', 'rosa@example.com')]),
      section(MentionSearchSectionKind.Pages, [ROADMAP, row(71, 'Roadmap row'), row(72, 'Road row')]),
    ];

    it('adds the provisional items of the missing kinds after the answer items, once', () => {
      const answer = [section(MentionSearchSectionKind.Pages, [ROAD_TRIP, row(72, 'Road row')])];
      const { sections, carriedKeys } = withProvisionalItems(
        answer,
        provisionalSections,
        new Set([MentionTargetKind.DatabaseRow])
      );

      expect(titlesOf(sections)).toEqual([[MentionSearchSectionKind.Pages, ['Road trip', 'Road row', 'Roadmap row']]]);
      expect([...carriedKeys]).toEqual([mentionItemNavKey(row(71, 'Roadmap row'))]);
      expect(answer[0].items).toHaveLength(2);
    });

    it('creates the section of a missing kind in its canonical place', () => {
      const answer = [section(MentionSearchSectionKind.Dates, [quickPick(MentionTargetKind.Date, 'Today')])];
      const { sections } = withProvisionalItems(
        answer,
        provisionalSections,
        new Set([MentionTargetKind.Person, MentionTargetKind.Page])
      );

      expect(titlesOf(sections)).toEqual([
        [MentionSearchSectionKind.People, ['Rosa']],
        [MentionSearchSectionKind.Pages, ['Roadmap']],
        [MentionSearchSectionKind.Dates, ['Today']],
      ]);
      expect(sections[0].title).toBe('people title');
    });

    it('returns the answer itself when nothing is missing or nothing is added', () => {
      const answer = [section(MentionSearchSectionKind.Pages, [ROADMAP])];

      expect(withProvisionalItems(answer, provisionalSections, new Set()).sections).toBe(answer);
      expect(withProvisionalItems(answer, [], new Set([MentionTargetKind.Page])).sections).toBe(answer);
      expect(withProvisionalItems(answer, provisionalSections, new Set([MentionTargetKind.Database])).sections).toBe(
        answer
      );
    });
  });

  describe('helpers', () => {
    it('drops the items of given navigation keys, and keeps an array without them', () => {
      const sections = [section(MentionSearchSectionKind.Pages, [ROADMAP, BUDGET])];

      expect(titlesOf(withoutMentionKeys(sections, new Set([mentionItemNavKey(BUDGET)])))).toEqual([
        [MentionSearchSectionKind.Pages, ['Roadmap']],
      ]);
      expect(withoutMentionKeys(sections, new Set(['page:other']))).toBe(sections);
      expect(withoutMentionKeys(sections, new Set())).toBe(sections);
    });

    it('caps every section at the limit', () => {
      const sections = [
        section(
          MentionSearchSectionKind.Pages,
          Array.from({ length: 25 }, (_, index) => page(80 + index, `Road ${index}`))
        ),
        section(MentionSearchSectionKind.People, [person(200, 'Rosa', 'rosa@example.com')]),
      ];
      const capped = capMentionSections(sections, 20);

      expect(capped[0].items.map(({ title }) => title)).toEqual(
        Array.from({ length: 20 }, (_, index) => `Road ${index}`)
      );
      expect(capped[1]).toBe(sections[1]);
      expect(capMentionSections(capped, 20)).toBe(capped);
    });
  });
});
