import {
  MentionablePerson,
  MentionPersonRole,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  ViewLayout,
} from '@/application/types';

import { MentionLocalSnapshot, MentionLocalView } from '../mentionLocalIndex';
import { mentionItemNavKey, objectTier, personTier, retierServerSection } from '../mentionLocalRanker';
import { MentionPickMemory, MentionPickScore } from '../mentionPickMemory';
import {
  MentionPickRequest,
  mentionLocalItemSection,
  mentionLocalPickItem,
  mentionLocalPickUnderAnyView,
  mentionPickSignals,
  rankMentionSectionsByPicks,
  RankMentionSectionsByPicksInput,
} from '../mentionPickRanking';
import { mentionSearchItemToMention } from '../mentionUtils';

import { loadMentionParityFixture } from './mention-parity-helpers';

const NOW = 1_767_225_600_000;
const HOUR_MS = 3_600_000;

/** A UUID whose last group is `n`, so tests read which item is which. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function page(n: number, title: string): MentionSearchResultItem {
  const id = uuid(n);

  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

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

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

function pages(...items: MentionSearchResultItem[]) {
  return section(MentionSearchSectionKind.Pages, items);
}

function titlesOf(sections: MentionSearchSection[]) {
  return sections.map((found) => [found.kind, found.items.map((item) => item.title)]);
}

/** A memory with `times` picks of each `[input, item]`, an hour apart, the last one an hour ago. */
function memoryWith(...picks: [input: string, item: MentionSearchResultItem, times: number][]) {
  const memory = new MentionPickMemory();
  let at = NOW - HOUR_MS * (1 + picks.reduce((sum, [, , times]) => sum + times, 0));

  picks.forEach(([input, item, times]) => {
    for (let pick = 0; pick < times; pick += 1) {
      at += HOUR_MS;
      memory.recordPick(input, mentionItemNavKey(item), at);
    }
  });
  return memory;
}

function rank(
  query: string,
  sections: MentionSearchSection[],
  memory: MentionPickMemory,
  extra: Partial<RankMentionSectionsByPicksInput> = {}
) {
  return rankMentionSectionsByPicks({
    query,
    sections,
    scores: memory.scores(query, NOW),
    request: {},
    sectionTitle: (kind) => `title:${kind}`,
    nowMs: NOW,
    ...extra,
  });
}

function localView(n: number, name: string, extra: Partial<MentionLocalView> = {}): MentionLocalView {
  const viewId = uuid(n);

  return {
    viewId,
    name,
    layout: ViewLayout.Document,
    icon: null,
    isDatabase: false,
    navKey: `page:${viewId}`,
    source: 'outline',
    ...extra,
  };
}

function localDatabase(n: number, name: string, databaseN: number): MentionLocalView {
  const viewId = uuid(n);
  const databaseId = uuid(databaseN);

  return localView(n, name, {
    layout: ViewLayout.Grid,
    isDatabase: true,
    databaseId,
    databaseViewId: viewId,
    navKey: `database:${databaseId}:${viewId}`,
  });
}

function rosterPerson(n: number, name: string, email: string): MentionablePerson {
  return {
    uid: n,
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    email,
    name,
    role: MentionPersonRole.Member,
    person_id: uuid(n),
    invited: false,
    last_mentioned_at: null,
  };
}

function snapshot(views: MentionLocalView[], people: MentionablePerson[] = []): MentionLocalSnapshot {
  return {
    workspaceId: 'workspace',
    version: 1,
    views,
    viewsById: new Map(views.map((view) => [view.viewId, view])),
    people,
  };
}

describe('pick memory orders a typed answer', () => {
  const roadmap = page(1, 'Roadmap');
  const roadmap2026 = page(2, 'Roadmap 2026');
  const roadmapQ4 = page(3, 'Roadmap Q4');
  const road = page(4, 'Road');
  const answer = () => [pages(roadmap, roadmap2026, roadmapQ4)];

  it("puts 'Roadmap 2026', picked twice from @ro, first in its tier", () => {
    const memory = memoryWith(['ro', roadmap2026, 2]);

    expect(memory.score('ro', mentionItemNavKey(roadmap2026), NOW)).toEqual({ adaptive: 380_000, lift: false });
    expect(titlesOf(rank('ro', answer(), memory).sections)).toEqual([
      ['pages', ['Roadmap 2026', 'Roadmap', 'Roadmap Q4']],
    ]);
    // First in its tier only: an exact title stays above it.
    expect(titlesOf(rank('ro', [pages(roadmap, roadmap2026, page(5, 'Ro'))], memory).sections)).toEqual([
      ['pages', ['Ro', 'Roadmap 2026', 'Roadmap']],
    ]);
  });

  it('orders by the strongest pick, a stored input that the typed one starts counting too', () => {
    const memory = memoryWith(['ro', roadmapQ4, 1], ['roadmap q', roadmapQ4, 1], ['roa', roadmap2026, 2]);

    expect(titlesOf(rank('r', answer(), memory).sections)).toEqual([
      ['pages', ['Roadmap 2026', 'Roadmap Q4', 'Roadmap']],
    ]);
    // `roa` does not start `ro`'s entry, but does start `roadmap q`.
    expect(titlesOf(rank('roa', answer(), memory).sections)).toEqual([
      ['pages', ['Roadmap 2026', 'Roadmap Q4', 'Roadmap']],
    ]);
    expect(titlesOf(rank('roadm', answer(), memory).sections)).toEqual([
      ['pages', ['Roadmap Q4', 'Roadmap', 'Roadmap 2026']],
    ]);
  });

  it("never puts a pick above another item's exact title, unless it was picked for exactly the typed input", () => {
    const answerWithRoad = () => [pages(roadmap, road)];

    // Ten picks from a longer input: a full score, but no lift.
    const longer = memoryWith(['roadm', roadmap, 10]);

    expect(longer.score('road', mentionItemNavKey(roadmap), NOW)).toEqual({ adaptive: 651_321, lift: false });
    expect(titlesOf(rank('road', answerWithRoad(), longer).sections)).toEqual([['pages', ['Road', 'Roadmap']]]);

    // Three picks from exactly `road` reach 0.542, below the lift.
    const three = memoryWith(['road', roadmap, 3]);

    expect(three.score('road', mentionItemNavKey(roadmap), NOW)).toEqual({ adaptive: 542_000, lift: false });
    expect(titlesOf(rank('road', answerWithRoad(), three).sections)).toEqual([['pages', ['Road', 'Roadmap']]]);

    // The fourth lifts it one tier, into the exact titles, where its pick memory puts it first.
    const four = memoryWith(['road', roadmap, 4]);

    expect(four.score('road', mentionItemNavKey(roadmap), NOW)).toEqual({ adaptive: 687_800, lift: true });
    expect(titlesOf(rank('road', answerWithRoad(), four).sections)).toEqual([['pages', ['Roadmap', 'Road']]]);
  });

  it('lifts one tier only, however strong the pick', () => {
    // `Broadway` holds `road` inside a word (T3); a lift makes it T2, still below `Road trip` (T1).
    const broadway = page(6, 'Broadway');
    const memory = memoryWith(['road', broadway, 20]);

    expect(memory.score('road', mentionItemNavKey(broadway), NOW)).toEqual({ adaptive: 1_000_000, lift: true });
    expect(
      titlesOf(rank('road', [pages(broadway, page(7, 'Road trip'), page(8, 'Our road plan'))], memory).sections)
    ).toEqual([['pages', ['Road trip', 'Broadway', 'Our road plan']]]);
  });

  it('keeps a section no pick scores, and the whole answer when nothing scores', () => {
    // A server matched Zed by something the client cannot see; re-tiered, he would follow Rob.
    const sections = [
      section(MentionSearchSectionKind.People, [
        person(23, 'Zed Alpha', 'zed@appflowy.io'),
        person(20, 'Rob', 'rob@appflowy.io'),
      ]),
      pages(roadmap, roadmap2026),
      section(MentionSearchSectionKind.Dates, [
        { kind: MentionTargetKind.Date, title: 'Today', mention: { type: MentionTargetKind.Date, date: '2026-11-10' } },
      ]),
    ];
    const memory = memoryWith(['ro', roadmap2026, 1]);
    const ranked = rank('ro', sections, memory).sections;

    expect(ranked[0]).toBe(sections[0]);
    expect(titlesOf([ranked[0]])).toEqual([['people', ['Zed Alpha', 'Rob']]]);
    expect(ranked[2]).toBe(sections[2]);
    expect(titlesOf([ranked[1]])).toEqual([['pages', ['Roadmap 2026', 'Roadmap']]]);

    expect(rank('xy', sections, memory).sections).toBe(sections);
    expect(rank('', sections, memory).sections).toBe(sections);
    // The order is already the pick's: nothing moves, and the answer comes back as it was.
    const ordered = [pages(roadmap2026, roadmap)];

    expect(rank('ro', ordered, memory).sections).toBe(ordered);
  });

  it('keeps the requester last in their class, picked or not', () => {
    const me = person(21, 'Annie Wang', 'annie@appflowy.io');
    const andy = person(22, 'Andy Li', 'andy@appflowy.io');
    const memory = memoryWith(['an', me, 6]);
    const people = [section(MentionSearchSectionKind.People, [me, andy])];

    expect(titlesOf(rank('an', people, memory, { requesterPersonId: uuid(21).toUpperCase() }).sections)).toEqual([
      ['people', ['Andy Li', 'Annie Wang']],
    ]);
    expect(titlesOf(rank('an', people, memory).sections)).toEqual([['people', ['Annie Wang', 'Andy Li']]]);
  });

  it('passes the merge.json pick-memory case', () => {
    interface PickMergeCase {
      id: string;
      request: MentionPickRequest & { query: string };
      picks: { ago_ms: number; input: string; key: string }[];
      server: { sections: MentionSearchSection[] };
      expected: { kind: string; items: { key: string; title: string }[] }[];
    }

    const merge = loadMentionParityFixture<{ now_ms: number; cases: PickMergeCase[] }>('merge.json');
    const entry = merge.cases.find((found) => found.id === 'pick-memory-orders-merged-items');

    if (!entry) throw new Error('merge.json lost its pick-memory case');

    const memory = new MentionPickMemory();

    entry.picks.forEach((pick) => memory.recordPick(pick.input, pick.key, merge.now_ms - pick.ago_ms));

    const { sections } = rankMentionSectionsByPicks({
      query: entry.request.query,
      sections: entry.server.sections,
      scores: memory.scores(entry.request.query, merge.now_ms),
      request: entry.request,
      sectionTitle: String,
      nowMs: merge.now_ms,
    });

    expect(
      sections.map((found) => ({
        kind: found.kind,
        items: found.items.map((item) => ({ key: mentionItemNavKey(item), title: item.title })),
      }))
    ).toEqual(
      entry.expected.map((found) => ({ kind: found.kind, items: found.items.map(({ key, title }) => ({ key, title })) }))
    );
  });

  // Whatever the picks, an item ranks above a better-tiered one only through a lift, which needs
  // exactly the typed input picked often enough, and never by more than one tier. The server's
  // answer is in tier order, as current servers send it, or in any order, which a section keeps
  // only while no pick scores in it.
  it('lifts only through exactly the typed input, on random memories', () => {
    let seed = 17;
    // A linear congruential generator, read from its high bits: its low bits repeat quickly.
    const random = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return Math.floor((seed / 2_147_483_648) * below);
    };

    const titles = ['Road', 'Roadmap', 'Roadmap 2026', 'Road trip', 'Our road plan', 'Broadway', 'Railroad', 'Q3 notes'];
    const inputs = ['r', 'ro', 'roa', 'road', 'roadm', 'roadmap', 'oad'];
    let lifted = 0;
    let checked = 0;

    for (let round = 0; round < 400; round += 1) {
      const items = titles.map((title, index) => page(100 + index, title));
      const memory = new MentionPickMemory();

      // Up to three items, each picked one to seven times after one input, at random hours.
      for (let pair = random(4); pair > 0; pair -= 1) {
        const input = inputs[random(inputs.length)];
        const key = mentionItemNavKey(items[random(items.length)]);

        for (let pick = 1 + random(7); pick > 0; pick -= 1) memory.recordPick(input, key, NOW - random(5) * HOUR_MS);
      }

      const query = inputs[random(inputs.length)];
      const tierOf = (item: MentionSearchResultItem) => objectTier(query, item.title) ?? 4;
      const shuffled = [...items].sort(() => random(3) - 1);
      const inTierOrder = round % 2 === 0;
      const answer = inTierOrder ? [...shuffled].sort((a, b) => tierOf(a) - tierOf(b)) : shuffled;

      if (!inTierOrder && memory.scores(query, NOW).size === 0) continue;

      const ranked = rank(query, [pages(...answer)], memory).sections[0].items;

      checked += 1;
      ranked.forEach((item, index) => {
        ranked.slice(index + 1).forEach((below) => {
          if (tierOf(item) <= tierOf(below)) return;

          const exact = memory.useCount(query, mentionItemNavKey(item), NOW) ?? 0;

          expect({ round, query, item: item.title, below: below.title, lift: (exact * 2) / 10 >= 600_000 }).toEqual({
            round,
            query,
            item: item.title,
            below: below.title,
            lift: true,
          });
          expect(tierOf(item) - tierOf(below)).toBe(1);
          lifted += 1;
        });
      });
    }

    // The rounds did exercise lifts, and most of them ranked.
    expect(lifted).toBeGreaterThan(10);
    expect(checked).toBeGreaterThan(250);
  });
});

describe('a picked target the answer lacks', () => {
  const roadTrip = localView(31, 'Road trip');
  const renamed = localView(32, 'Budget');
  const tasks = localDatabase(33, 'Road tasks', 34);
  const annie = rosterPerson(35, 'Annie Wang', 'annie@appflowy.io');
  const blank = rosterPerson(36, ' ', 'ann.lee@appflowy.io');
  const index = snapshot([roadTrip, renamed, tasks], [annie, blank]);
  const localItem = (key: string) => mentionLocalPickItem(index, key);
  const roadmap = page(1, 'Roadmap');

  it('joins from the local index at the top of its tier, while its title still matches', () => {
    const memory = memoryWith(
      ['road', page(31, 'Road trip'), 1],
      ['road', page(32, 'Road budget'), 3],
      ['road', page(39, 'Road gone'), 3]
    );
    const { sections, localKeys } = rank('road', [pages(roadmap)], memory, { localItem });

    // 'Budget' no longer matches `road`, and page 39 is not in the index (trashed, or never loaded).
    expect(titlesOf(sections)).toEqual([['pages', ['Road trip', 'Roadmap']]]);
    expect([...localKeys]).toEqual([`page:${uuid(31)}`]);
    expect(sections[0].items[0]).toEqual({
      kind: MentionTargetKind.Page,
      object_id: uuid(31),
      title: 'Road trip',
      mention: { type: MentionTargetKind.Page, page_id: uuid(31) },
    });
  });

  it('joins People and Databases, creating a section the answer lacks in its canonical place', () => {
    const memory = memoryWith(
      ['an', person(35, 'Annie Wang', 'annie@appflowy.io'), 1],
      ['an', person(36, '', 'ann.lee@appflowy.io'), 2],
      ['road', databaseItem(34, 33, 'Road tasks'), 1]
    );
    const dates = section(MentionSearchSectionKind.Dates, []);

    expect(titlesOf(rank('an', [pages(page(40, 'Annual plan')), dates], memory, { localItem }).sections)).toEqual([
      ['people', ['ann.lee@appflowy.io', 'Annie Wang']],
      ['pages', ['Annual plan']],
      ['dates', []],
    ]);
    expect(rank('an', [dates], memory, { localItem }).sections[0].title).toBe('title:people');

    const { sections } = rank('road', [pages(roadmap), dates], memory, { localItem });

    expect(titlesOf(sections)).toEqual([
      ['pages', ['Roadmap']],
      ['databases', ['Road tasks']],
      ['dates', []],
    ]);
    expect(sections[1].items[0]).toMatchObject({ database_id: uuid(34), database_view_id: uuid(33) });
  });

  it('joins only where the server could have returned it: the kinds and filter the picker asked for', () => {
    const memory = memoryWith(['an', person(35, 'Annie Wang', 'annie@appflowy.io'), 1]);
    const pageReference: MentionPickRequest = {
      include: [MentionTargetKind.Page, MentionTargetKind.Database, MentionTargetKind.DatabaseRow],
    };

    expect(titlesOf(rank('an', [pages()], memory, { localItem, request: pageReference }).sections)).toEqual([
      ['pages', []],
    ]);
  });

  it('never joins when the answer lists it in another section, or for a row', () => {
    const suggested = section(MentionSearchSectionKind.Suggested, [page(31, 'Road trip')]);
    const memory = memoryWith(['road', page(31, 'Road trip'), 1], ['road', rowItem(34, 50, 'Road row'), 1]);
    const { sections, localKeys } = rank('road', [suggested, pages(roadmap)], memory, { localItem });

    expect(titlesOf(sections)).toEqual([
      ['suggested', ['Road trip']],
      ['pages', ['Roadmap']],
    ]);
    expect(localKeys.size).toBe(0);
    expect(mentionLocalPickItem(index, `row:${uuid(34)}:${uuid(50)}`)).toBeUndefined();
  });

  it('builds the items the picker inserts from the local index, keyed as the server keys them', () => {
    expect(mentionLocalPickItem(index, `page:${uuid(31)}`)).toEqual(
      expect.objectContaining({ kind: MentionTargetKind.Page, title: 'Road trip' })
    );
    expect(mentionLocalPickItem(index, tasks.navKey)).toEqual({
      kind: MentionTargetKind.Database,
      object_id: uuid(34),
      title: 'Road tasks',
      database_id: uuid(34),
      database_view_id: uuid(33),
      mention: { type: MentionTargetKind.Database, database_id: uuid(34), database_view_id: uuid(33) },
    });
    // A blank name is shown and inserted as the address, as Cloud names such a person.
    expect(mentionLocalPickItem(index, `person:${uuid(36)}`)).toEqual({
      kind: MentionTargetKind.Person,
      object_id: uuid(36),
      title: 'ann.lee@appflowy.io',
      subtitle: 'ann.lee@appflowy.io',
      mention: { type: MentionTargetKind.Person, person_id: uuid(36), person_name: 'ann.lee@appflowy.io', page_id: '' },
    });
    expect(mentionLocalPickItem(index, `person:${uuid(35)}`)?.mention).toEqual({
      type: MentionTargetKind.Person,
      person_id: uuid(35),
      person_name: 'Annie Wang',
      page_id: '',
    });
    // A database whose view the index does not know yet names the view it lists it by, which the
    // picker inserts as the mention's page.
    const created = localView(37, 'Road budget', {
      layout: ViewLayout.Grid,
      isDatabase: true,
      databaseId: uuid(38),
      navKey: `database:${uuid(38)}:-`,
      source: 'session',
    });
    const createdItem = mentionLocalPickItem(snapshot([created]), created.navKey);

    expect(createdItem).toEqual({
      kind: MentionTargetKind.Database,
      object_id: uuid(37),
      title: 'Road budget',
      database_id: uuid(38),
      database_view_id: undefined,
      mention: { type: MentionTargetKind.Database, database_id: uuid(38), database_view_id: undefined },
    });
    expect(createdItem && mentionItemNavKey(createdItem)).toBe(created.navKey);
    expect(createdItem && mentionSearchItemToMention(createdItem)).toMatchObject({
      page_id: uuid(37),
      database_id: uuid(38),
    });
    // A database's own view key is no page, and a page key is no database.
    expect(mentionLocalPickItem(index, `page:${uuid(33)}`)).toBeUndefined();
    expect(mentionLocalPickItem(index, 'date:Today')).toBeUndefined();
    [`page:${uuid(31)}`, tasks.navKey, `person:${uuid(35)}`].forEach((key) => {
      const item = mentionLocalPickItem(index, key);

      expect(item && mentionItemNavKey(item)).toBe(key);
    });
  });
});

describe('mentionLocalPickUnderAnyView', () => {
  // In space 1, page 10 holds page 11 (in the outline), which holds page 12 (only a recent view now).
  // Page 13 is a recent view below page 14, which no source lists any more. Database 21's container
  // 20 sits below page 10 and answers through its grid view 22.
  const projects = localView(10, 'Projects', { parentViewId: uuid(1) });
  const plans = localView(11, 'Plans', { parentViewId: uuid(10) });
  const roadmap2026 = localView(12, 'Roadmap 2026', { parentViewId: uuid(11), source: 'recent' });
  const roadmapQ4 = localView(13, 'Roadmap Q4', { parentViewId: uuid(14), source: 'recent' });
  const tracker = localView(20, 'Roadmap tracker', {
    layout: ViewLayout.Grid,
    isDatabase: true,
    databaseId: uuid(21),
    databaseViewId: uuid(22),
    navKey: `database:${uuid(21)}:${uuid(22)}`,
    parentViewId: uuid(10),
  });
  const annie = rosterPerson(35, 'Annie Wang', 'annie@appflowy.io');
  const index = snapshot([projects, plans, roadmap2026, roadmapQ4, tracker], [annie]);
  const under = (key: string, ...revoked: number[]) =>
    mentionLocalPickUnderAnyView(index, key, new Set(revoked.map(uuid)));

  it('finds a revoked view, and every view below it as far as the index knows the parents', () => {
    const key = `page:${uuid(12)}`;

    expect(under(key, 12)).toBe(true);
    expect(under(key, 11)).toBe(true);
    expect(under(key, 10)).toBe(true);
    // A parent the index does not list still counts by its id: here the space.
    expect(under(key, 1)).toBe(true);
    expect(under(key, 13, 14, 20)).toBe(false);
    expect(under(key)).toBe(false);
    // A view below a revoked one is no reason to hide the view above it.
    expect(under(`page:${uuid(11)}`, 12)).toBe(false);
  });

  it('stops at the first parent the index does not list', () => {
    const key = `page:${uuid(13)}`;

    expect(under(key, 14)).toBe(true);
    // Whatever lies above page 14 is unknown, so a revoke above it is not seen.
    expect(under(key, 10, 1)).toBe(false);
  });

  it('starts a database from the view the index lists it by, a container included', () => {
    expect(under(tracker.navKey, 20)).toBe(true);
    expect(under(tracker.navKey, 10)).toBe(true);
    // The container is not on its item, which shows only the database and its grid view.
    expect(mentionLocalPickItem(index, tracker.navKey)).toMatchObject({
      object_id: uuid(21),
      database_view_id: uuid(22),
    });
  });

  it('is false for people, rows, dates and keys the index does not hold', () => {
    expect(under(`person:${annie.person_id}`, 35, 10)).toBe(false);
    expect(under(`row:${uuid(21)}:${uuid(50)}`, 21, 50, 10)).toBe(false);
    expect(under('date:Today', 10)).toBe(false);
    expect(under(`page:${uuid(19)}`, 19, 10)).toBe(false);
    // A database's own view key is no page.
    expect(under(`page:${uuid(20)}`, 20)).toBe(false);
  });

  it('ends when the parents lead back to a view it already followed', () => {
    const first = localView(40, 'Road one', { parentViewId: uuid(41) });
    const second = localView(41, 'Road two', { parentViewId: uuid(40) });
    const looped = snapshot([first, second]);

    expect(mentionLocalPickUnderAnyView(looped, first.navKey, new Set([uuid(42)]))).toBe(false);
    expect(mentionLocalPickUnderAnyView(looped, first.navKey, new Set([uuid(41)]))).toBe(true);
  });
});

describe('mentionLocalItemSection', () => {
  interface MergeCase {
    id: string;
    request: MentionPickRequest & { query: string; limit?: number };
    local: { key: string; title: string; email?: string }[];
    server: { sections: MentionSearchSection[] };
    rows_server?: { sections: MentionSearchSection[] };
    expected: { kind: MentionSearchSectionKind; items: { key: string; source: string }[] }[];
  }

  const merge = loadMentionParityFixture<{ now_ms: number; cases: MergeCase[] }>('merge.json');
  const typed = merge.cases.filter((entry) => entry.request.query.trim() !== '' && entry.local.length > 0);

  it('covers the cases with kinds and filters', () => {
    expect(typed.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'a-page-reference-picker-adds-no-people',
        'a-people-picker-adds-no-pages-or-databases',
        'a-database-filter-adds-only-what-it-names',
        'a-view-filter-adds-only-that-view',
        'a-row-filter-adds-only-those-rows',
      ])
    );
  });

  // The local-only items each case expects are those the rule admits, that the server did not
  // send, and whose title or name matches (a limit may cut more).
  it.each(typed.map((entry) => [entry.id, entry] as const))('agrees with merge.json: %s', (_, entry) => {
    const { query } = entry.request;
    const sent = new Set(
      [...entry.server.sections, ...(entry.rows_server?.sections ?? [])].flatMap((found) =>
        found.items.map((item) => mentionItemNavKey(item))
      )
    );
    const admitted = entry.local
      .filter((item) => !sent.has(item.key))
      .flatMap((item) => {
        const kind = mentionLocalItemSection(entry.request, item.key);
        const matches = item.key.startsWith('person:')
          ? personTier(query, item.title, item.email ?? '') !== undefined
          : objectTier(query, item.title) !== undefined;

        return kind && matches ? [`${kind} ${item.key}`] : [];
      })
      .sort();
    const expected = entry.expected
      .flatMap((found) =>
        found.items.filter((item) => item.source === 'local').map((item) => `${found.kind} ${item.key}`)
      )
      .sort();

    if (entry.request.limit === undefined) expect(admitted).toEqual(expected);
    else expect(admitted).toEqual(expect.arrayContaining(expected));
  });

  it.each([
    ['person', `person:${uuid(1)}`, { include: [MentionTargetKind.Page] }, undefined],
    [
      'person, any filter',
      `person:${uuid(1)}`,
      { filter: { database_row_ids: [uuid(9)] } },
      MentionSearchSectionKind.People,
    ],
    ['page, empty filter lists', `page:${uuid(1)}`, { filter: {} }, MentionSearchSectionKind.Pages],
    ['page under a view filter', `page:${uuid(1)}`, { filter: { database_view_ids: [uuid(9)] } }, undefined],
    [
      'database of an unknown view under a view filter',
      `database:${uuid(1)}:-`,
      { filter: { database_view_ids: [uuid(9)] } },
      undefined,
    ],
    [
      'database by an upper-case filter id',
      `database:${uuid(1)}:${uuid(2)}`,
      { filter: { database_ids: [uuid(1).toUpperCase()] } },
      MentionSearchSectionKind.Databases,
    ],
    ['row', `row:${uuid(1)}:${uuid(2)}`, {}, MentionSearchSectionKind.Pages],
    ['row under a view filter', `row:${uuid(1)}:${uuid(2)}`, { filter: { database_view_ids: [uuid(1)] } }, undefined],
    ['date', 'date:Today', {}, undefined],
    ['link', 'link:https://appflowy.io', {}, undefined],
  ] as [string, string, MentionPickRequest, MentionSearchSectionKind | undefined][])('%s', (_, key, request, kind) => {
    expect(mentionLocalItemSection(request, key)).toBe(kind);
  });
});

describe('retierServerSection with local items', () => {
  it('ranks them as local-only candidates: after a tied server item, and only when they match', () => {
    const scored = (key: string): MentionPickScore | undefined =>
      key === `page:${uuid(61)}` ? { adaptive: 100_000, lift: false } : undefined;
    const ranked = retierServerSection('road', pages(page(60, 'Roadmap')), {
      nowMs: NOW,
      signals: (key) => scored(key),
      // Page 60 is the server's item: its local copy, with an exact title, is left out.
      localItems: [page(61, 'Road trip'), page(62, 'Roadster'), page(63, 'Budget'), page(60, 'Road')],
    });

    expect(ranked.items.map((item) => item.title)).toEqual(['Road trip', 'Roadmap', 'Roadster']);
    expect(
      retierServerSection('', pages(page(60, 'Roadmap')), { localItems: [page(61, 'Road trip')] }).items
    ).toHaveLength(1);
  });
});

describe('retierKinds, as the picker v2 re-tiers every typed answer (MEN-WEB-08)', () => {
  const v2Kinds = new Set([
    MentionSearchSectionKind.People,
    MentionSearchSectionKind.Pages,
    MentionSearchSectionKind.DatabaseRows,
  ]);
  const noPicks = new MentionPickMemory();
  const today: MentionSearchResultItem = {
    kind: MentionTargetKind.Date,
    title: 'Today',
    mention: { type: MentionTargetKind.Date, date: '2026-11-10' },
  };
  // What an older server answers for `app`: a body hit above a title prefix, a shared domain above a
  // name, and a database whose title does not match, which Search may have found by a view name.
  const answer = () => [
    section(MentionSearchSectionKind.People, [
      person(30, 'Brian Chen', 'brian@appflowy.io'),
      person(31, 'Appleton', 'appleton@example.com'),
    ]),
    pages(page(32, 'Weekly notes'), page(33, 'Apple pie')),
    section(MentionSearchSectionKind.Databases, [databaseItem(34, 35, 'Inventory'), databaseItem(36, 37, 'Apps')]),
    section(MentionSearchSectionKind.DatabaseRows, [rowItem(38, 39, 'Weekly row'), rowItem(38, 40, 'App row')]),
    section(MentionSearchSectionKind.Dates, [today]),
  ];

  it('ranks the given kinds with no pick, and keeps Databases and Dates in the server order', () => {
    const sections = answer();
    const ranked = rank('app', sections, noPicks, { retierKinds: v2Kinds }).sections;

    expect(titlesOf(ranked)).toEqual([
      ['people', ['Appleton', 'Brian Chen']],
      ['pages', ['Apple pie', 'Weekly notes']],
      ['databases', ['Inventory', 'Apps']],
      ['database_rows', ['App row', 'Weekly row']],
      ['dates', ['Today']],
    ]);
    expect(ranked[2]).toBe(sections[2]);
    expect(ranked[4]).toBe(sections[4]);
    // Without retierKinds, a query no pick scores keeps the whole answer.
    expect(rank('app', sections, noPicks).sections).toBe(sections);
    // A bare query keeps the server's order.
    expect(rank('', sections, noPicks, { retierKinds: v2Kinds }).sections).toBe(sections);
  });

  it('still ranks a Databases section where a pick scores, and the others with pick memory first', () => {
    const memory = memoryWith(['app', databaseItem(34, 35, 'Inventory'), 1], ['app', page(32, 'Weekly notes'), 4]);
    const ranked = rank('app', answer(), memory, { retierKinds: v2Kinds }).sections;

    // The picked database matches nothing, so it drops below Apps; four picks after exactly `app`
    // lift the body hit one tier only, from T4 to T3, still below the prefix match.
    expect(titlesOf(ranked).slice(1, 3)).toEqual([
      ['pages', ['Apple pie', 'Weekly notes']],
      ['databases', ['Apps', 'Inventory']],
    ]);
  });

  it('keeps the requester last in their class with no pick', () => {
    const me = person(41, 'Annie Wang', 'annie@appflowy.io');
    const people = [section(MentionSearchSectionKind.People, [me, person(42, 'Andy Li', 'andy@appflowy.io')])];

    expect(
      titlesOf(rank('an', people, noPicks, { retierKinds: v2Kinds, requesterPersonId: uuid(41) }).sections)
    ).toEqual([['people', ['Andy Li', 'Annie Wang']]]);
  });

  it('gives the signals of pick memory and the requester by navigation key', () => {
    const scores = new Map<string, MentionPickScore>([[`page:${uuid(43)}`, { adaptive: 250_000, lift: false }]]);
    const signals = mentionPickSignals(scores, uuid(44).toUpperCase());

    expect(signals(`page:${uuid(43)}`)).toEqual({ adaptive: 250_000, lift: false, requester: false });
    expect(signals(`person:${uuid(44)}`)).toEqual({ adaptive: undefined, lift: undefined, requester: true });
    expect(signals(`page:${uuid(45)}`)).toBeUndefined();
    expect(mentionPickSignals(scores, undefined)(`person:${uuid(44)}`)).toBeUndefined();
  });
});

function databaseItem(databaseN: number, viewN: number, title: string): MentionSearchResultItem {
  const databaseId = uuid(databaseN);
  const viewId = uuid(viewN);

  return {
    kind: MentionTargetKind.Database,
    object_id: databaseId,
    title,
    database_id: databaseId,
    database_view_id: viewId,
    mention: { type: MentionTargetKind.Database, database_id: databaseId, database_view_id: viewId },
  };
}

function rowItem(databaseN: number, rowN: number, title: string): MentionSearchResultItem {
  const databaseId = uuid(databaseN);
  const rowId = uuid(rowN);

  return {
    kind: MentionTargetKind.DatabaseRow,
    object_id: rowId,
    title,
    mention: { type: MentionTargetKind.DatabaseRow, database_id: databaseId, row_id: rowId },
  };
}
