import { performance } from 'perf_hooks';

import { emit, EventType } from '@/application/session/event';
import {
  MentionablePerson,
  MentionPersonRole,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  View,
  ViewIconType,
  ViewLayout,
} from '@/application/types';

import {
  buildMentionLocalLane,
  clearMentionSessionPersonPicks,
  getMentionSessionPersonPicks,
  MENTION_BARE_PRESENT_LIFT,
  MENTION_SESSION_PICK_LIMIT,
  MentionLaneItem,
  mentionPresentPersonIds,
  patchMentionBareSections,
  recordMentionSessionPersonPick,
} from '../mentionLocalLane';
import {
  clearMentionLocalIndex,
  getMentionLocalSnapshot,
  recordMentionRoster,
  recordMentionViewCreated,
  recordMentionViewOpened,
  recordMentionViewRenamed,
  setMentionIndexSources,
} from '../mentionLocalIndex';
import { mentionMergedPickerSections, mergeMentionSections } from '../mentionLocalMerge';
import { mentionItemNavKey } from '../mentionUtils';

const WORKSPACE = 'workspace';
const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const MINUTE = 60_000;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function view(id: string, name: string, fields: Partial<View> = {}): View {
  return {
    view_id: id,
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...fields,
  };
}

function person(n: number, name: string, fields: Partial<MentionablePerson> = {}): MentionablePerson {
  return {
    uid: String(1000 + n),
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    email: `${name.toLowerCase() || `p${n}`}@appflowy.io`,
    name,
    role: MentionPersonRole.Member,
    person_id: uuid(n),
    invited: false,
    last_mentioned_at: null,
    ...fields,
  };
}

function page(id: string, title: string): MentionSearchResultItem {
  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

function personItem(entry: MentionablePerson): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: entry.person_id,
    title: entry.name,
    subtitle: entry.email,
    mention: { type: MentionTargetKind.Person, person_id: entry.person_id, person_name: entry.name, page_id: 'p' },
  };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

const keysOf = (sections: MentionSearchSection[]) =>
  sections.map((found) => [found.kind, found.items.map(mentionItemNavKey)]);

describe('mentionLocalLane (MEN-WEB-09)', () => {
  beforeEach(() => {
    clearMentionLocalIndex();
    clearMentionSessionPersonPicks();
  });

  describe('buildMentionLocalLane', () => {
    it('lists the index views and the roster with what the server would send and the tab signals', () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [
          view('a', 'Alpha', { icon: { ty: ViewIconType.Emoji, value: '🚗' }, created_at: '2026-01-01T00:00:00Z' }),
          view('grid', 'Tasks', { layout: ViewLayout.Grid, extra: { is_space: false, database_id: 'db' } }),
        ],
        recent: [view('a', 'Alpha', { last_viewed_at: new Date(NOW - 3 * MINUTE).toISOString() })],
      });
      recordMentionViewCreated(
        WORKSPACE,
        { viewId: 'new', name: 'Zebra plan', layout: ViewLayout.Document },
        NOW - MINUTE
      );
      recordMentionViewOpened(WORKSPACE, 'a', NOW - 2 * MINUTE);
      recordMentionViewRenamed(WORKSPACE, 'grid', 'Road tasks', NOW - 4 * MINUTE);
      recordMentionRoster(WORKSPACE, [
        person(1, 'Anna', { last_mentioned_at: new Date(NOW - 10 * MINUTE).toISOString() }),
        person(2, 'Bob'),
        person(3, '', { person_id: '' }),
      ]);

      const lane = buildMentionLocalLane({
        snapshot: getMentionLocalSnapshot(WORKSPACE),
        presentPersonIds: new Set([uuid(2)]),
        personPicks: new Map([[uuid(1), NOW - MINUTE]]),
      });
      const summary = lane.map(({ key, title, email, icon, changedMs, lastUsedMs, tabUsedMs, present }) => ({
        key,
        title,
        email,
        icon,
        changedMs,
        lastUsedMs,
        tabUsedMs,
        present,
      }));

      expect(summary).toEqual([
        {
          key: 'page:a',
          title: 'Alpha',
          email: undefined,
          icon: { ty: ViewIconType.Emoji, value: '🚗' },
          changedMs: undefined,
          // This tab's open is newer than the server's view time.
          lastUsedMs: NOW - 2 * MINUTE,
          tabUsedMs: NOW - 2 * MINUTE,
          present: undefined,
        },
        {
          key: 'database:db:grid',
          title: 'Road tasks',
          email: undefined,
          icon: null,
          changedMs: NOW - 4 * MINUTE,
          lastUsedMs: undefined,
          tabUsedMs: undefined,
          present: undefined,
        },
        {
          key: 'page:new',
          title: 'Zebra plan',
          email: undefined,
          icon: null,
          changedMs: NOW - MINUTE,
          lastUsedMs: NOW - MINUTE,
          tabUsedMs: NOW - MINUTE,
          present: undefined,
        },
        {
          key: `person:${uuid(1)}`,
          title: 'Anna',
          email: 'anna@appflowy.io',
          icon: null,
          changedMs: undefined,
          // The tab's pick is newer than the server's last mention.
          lastUsedMs: NOW - MINUTE,
          tabUsedMs: undefined,
          present: false,
        },
        {
          key: `person:${uuid(2)}`,
          title: 'Bob',
          email: 'bob@appflowy.io',
          icon: null,
          changedMs: undefined,
          lastUsedMs: undefined,
          tabUsedMs: undefined,
          present: true,
        },
      ]);
      // What the picker inserts is the server's shape: a database by database and view.
      expect(lane[1].item).toEqual({
        kind: MentionTargetKind.Database,
        object_id: 'db',
        title: 'Road tasks',
        database_id: 'db',
        database_view_id: 'grid',
        mention: { type: MentionTargetKind.Database, database_id: 'db', database_view_id: 'grid' },
      });
      expect(lane[3].item.mention).toEqual({
        type: MentionTargetKind.Person,
        person_id: uuid(1),
        person_name: 'Anna',
        page_id: '',
      });
    });

    it('keeps a view the user lost access to out, and the views below it, as far as the index knows', () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [
          view('projects', 'Projects', { children: [view('trip', 'Road trip', { children: [view('day', 'Day 1')] })] }),
          view('other', 'Roadmap'),
        ],
      });

      const lane = buildMentionLocalLane({
        snapshot: getMentionLocalSnapshot(WORKSPACE),
        revokedViews: new Set(['projects']),
      });

      expect(lane.map((entry) => entry.key)).toEqual(['page:other']);
      expect(
        buildMentionLocalLane({ snapshot: getMentionLocalSnapshot(WORKSPACE), revokedViews: new Set(['trip']) }).map(
          (entry) => entry.key
        )
      ).toEqual(['page:projects', 'page:other']);
    });

    it('is empty for a workspace the app did not give the index', () => {
      recordMentionRoster('elsewhere', [person(1, 'Anna')]);
      expect(buildMentionLocalLane({ snapshot: getMentionLocalSnapshot('elsewhere') })).toEqual([]);
    });
  });

  describe('mentionPresentPersonIds', () => {
    const roster = [person(1, 'Anna'), person(2, 'Bob', { uid: '626259007224418304' })];

    it('names people by person id in any case, by a Desktop uid through the roster, or by a person id alone', () => {
      const ids = new Set([uuid(1).toUpperCase(), '626259007224418304', uuid(9), 'not-a-person', '12345']);

      expect([...mentionPresentPersonIds(roster, ids)]).toEqual([uuid(1), uuid(2), uuid(9)]);
    });

    it('leaves the requester out, by person id or uid', () => {
      const ids = new Set([uuid(1), '626259007224418304']);

      expect([...mentionPresentPersonIds(roster, ids, { uuid: uuid(1).toUpperCase() })]).toEqual([uuid(2)]);
      expect([...mentionPresentPersonIds(roster, ids, { uid: '626259007224418304' })]).toEqual([uuid(1)]);
      expect(mentionPresentPersonIds(roster, new Set())).toBe(mentionPresentPersonIds([], new Set()));
    });
  });

  describe("this tab's person picks", () => {
    it('keeps the latest pick of each person per workspace, at most the limit, a new map each time', () => {
      const before = getMentionSessionPersonPicks(WORKSPACE);

      recordMentionSessionPersonPick(WORKSPACE, 'anna', 1);
      recordMentionSessionPersonPick(WORKSPACE, 'bob', 2);
      recordMentionSessionPersonPick(WORKSPACE, 'anna', 3);
      recordMentionSessionPersonPick('other', 'cy', 4);
      recordMentionSessionPersonPick(undefined, 'dee', 5);

      const picks = getMentionSessionPersonPicks(WORKSPACE);

      expect(picks).not.toBe(before);
      expect([...picks]).toEqual([
        ['bob', 2],
        ['anna', 3],
      ]);
      expect([...getMentionSessionPersonPicks('other')]).toEqual([['cy', 4]]);

      for (let n = 0; n < MENTION_SESSION_PICK_LIMIT; n += 1) recordMentionSessionPersonPick(WORKSPACE, `p${n}`, 10 + n);
      expect(getMentionSessionPersonPicks(WORKSPACE).size).toBe(MENTION_SESSION_PICK_LIMIT);
      expect(getMentionSessionPersonPicks(WORKSPACE).has('anna')).toBe(false);
    });

    it('forgets them when the session ends', () => {
      recordMentionSessionPersonPick(WORKSPACE, 'anna', 1);
      emit(EventType.SESSION_INVALID);
      expect(getMentionSessionPersonPicks(WORKSPACE).size).toBe(0);
    });
  });

  describe('patchMentionBareSections', () => {
    function laneEntry(key: string, title: string, fields: Partial<MentionLaneItem> = {}): MentionLaneItem {
      const id = key.slice(key.indexOf(':') + 1);

      return { key, title, item: page(id, title), ...fields };
    }

    const base = {
      personPicks: new Map<string, number>(),
      presentPersonIds: new Set<string>(),
      request: {},
      limit: 20,
      sectionTitle: (kind: MentionSearchSectionKind) => `title:${kind}`,
      nowMs: NOW,
    };

    it("lifts this tab's opens and creations since the cutoff, newest first, the server's own items moved", () => {
      const sections = [section(MentionSearchSectionKind.Pages, [page('a', 'Alpha'), page('b', 'Beta')])];
      const lane = [
        laneEntry('page:a', 'Alpha'),
        laneEntry('page:b', 'Beta', { tabUsedMs: NOW - 2_000 }),
        laneEntry('page:c', 'Gamma', { tabUsedMs: NOW - 1_000, changedMs: NOW - 1_000 }),
        laneEntry('page:d', 'Delta', { tabUsedMs: NOW - 5 * MINUTE }),
      ];
      const patched = patchMentionBareSections({ ...base, sections, lane, liftAfterMs: NOW - MINUTE });

      expect(keysOf(patched.sections)).toEqual([['pages', ['page:c', 'page:b', 'page:a']]]);
      expect([...patched.localKeys]).toEqual(['page:c']);
      expect([...patched.freshKeys]).toEqual(['page:c']);

      // Without an answer, as after a failure, every open and creation of this tab counts.
      const fallback = patchMentionBareSections({ ...base, sections: [], lane });

      expect(keysOf(fallback.sections)).toEqual([['pages', ['page:c', 'page:b', 'page:d']]]);
      expect(fallback.sections[0].title).toBe('title:pages');
    });

    it('returns the sections themselves when nothing is lifted', () => {
      const sections = [section(MentionSearchSectionKind.Pages, [page('a', 'Alpha')])];
      const patched = patchMentionBareSections({
        ...base,
        sections,
        lane: [laneEntry('page:a', 'Alpha', { tabUsedMs: NOW - 5 * MINUTE })],
        liftAfterMs: NOW - MINUTE,
      });

      expect(patched.sections).toBe(sections);
    });

    it("lists this tab's person picks, then up to three people on the page, then the server's order", () => {
      const people = [1, 2, 3, 4, 5, 6, 7].map((n) =>
        person(n, ['Anna', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Me'][n - 1])
      );
      const [anna, bob, cy, dee, eve, fay, me] = people;
      const lane = people.map((entry) => ({
        key: `person:${entry.person_id}`,
        title: entry.name,
        email: entry.email,
        item: personItem(entry),
      }));
      const sections = [
        section(MentionSearchSectionKind.People, [personItem(anna), personItem(fay), personItem(bob), personItem(me)]),
      ];
      const patched = patchMentionBareSections({
        ...base,
        sections,
        lane,
        personPicks: new Map([
          [bob.person_id, NOW - 2_000],
          [me.person_id, NOW - 1_000],
        ]),
        presentPersonIds: new Set([eve.person_id, dee.person_id, cy.person_id, fay.person_id, me.person_id]),
        requesterPersonId: me.person_id.toUpperCase(),
      });

      // Bob picked; Fay, whom the server lists, then Cy and Dee by name; the requester stays last.
      expect(keysOf(patched.sections)).toEqual([
        ['people', [bob, fay, cy, dee, anna, me].map((entry) => `person:${entry.person_id}`)],
      ]);
      expect([...patched.localKeys]).toEqual([`person:${cy.person_id}`, `person:${dee.person_id}`]);
      expect(MENTION_BARE_PRESENT_LIFT).toBe(3);
    });

    it('lifts only the kinds the picker asks for, into sections in their canonical place', () => {
      const lane = [
        laneEntry('page:c', 'Gamma', { tabUsedMs: NOW }),
        { key: `person:${uuid(1)}`, title: 'Anna', item: personItem(person(1, 'Anna')) },
      ];
      const dates = section(MentionSearchSectionKind.Dates, []);
      const picker = patchMentionBareSections({
        ...base,
        sections: [dates],
        lane,
        liftAfterMs: NOW - MINUTE,
        personPicks: new Map([[uuid(1), NOW]]),
      });

      expect(keysOf(picker.sections)).toEqual([
        ['people', [`person:${uuid(1)}`]],
        ['pages', ['page:c']],
        ['dates', []],
      ]);

      const pageReference = patchMentionBareSections({
        ...base,
        sections: [],
        lane,
        personPicks: new Map([[uuid(1), NOW]]),
        request: { include: [MentionTargetKind.Page, MentionTargetKind.Database, MentionTargetKind.DatabaseRow] },
      });

      expect(keysOf(pageReference.sections)).toEqual([['pages', ['page:c']]]);
    });

    it('never shows fewer items than the server listed, and at most the limit otherwise', () => {
      const listed = Array.from({ length: 22 }, (_, n) => page(`s${n}`, `Server ${n}`));
      const lane = Array.from({ length: 5 }, (_, n) => laneEntry(`page:l${n}`, `Local ${n}`, { tabUsedMs: NOW - n }));
      const patched = patchMentionBareSections({
        ...base,
        sections: [section(MentionSearchSectionKind.Pages, listed)],
        lane,
        liftAfterMs: NOW - MINUTE,
      });

      expect(patched.sections[0].items).toHaveLength(22);
      expect(patched.sections[0].items.slice(0, 5).map(mentionItemNavKey)).toEqual(lane.map((entry) => entry.key));
    });
  });

  // The plan's budget for a large workspace: the lane is built once per snapshot, and every keystroke
  // merges it with an answer. MEN-WEB-06's vocabulary and queries, so the figures compare with its
  // ranker budget; Jest runs this about ten times slower than a browser does.
  it('builds 5,000 views and 500 people, and merges them on every keystroke, within the budget', () => {
    const vocabulary = ['road', 'roadmap', 'meeting', 'notes', 'weekly', 'sync', 'plan', 'planning', 'q3', 'q4'];
    const more = ['2026', 'design', 'review', 'spec', 'launch', 'résumé', 'café', 'budget', 'team', 'offsite'];
    const words = [...vocabulary, ...more, 'retro', 'okr', 'product', 'broadway', 'trip', '产品路线图', '회의록'];
    const names = ['Annie', 'Andy', 'Brian', 'Joan', 'José', 'Zoë', 'Nathan', 'Lucas', 'Mia', 'Chen', '王小明'];
    let seed = 42;
    // A linear congruential generator, read from its high bits.
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };

    const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];
    const title = () => Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(words)).join(' ');
    const outline = Array.from({ length: 50 }, (_, folder) =>
      view(`f${folder}`, title(), {
        children: Array.from({ length: 99 }, (_, n) => view(`v${folder}-${n}`, title())),
      })
    );

    setMentionIndexSources(WORKSPACE, { outline });
    recordMentionRoster(
      WORKSPACE,
      Array.from({ length: 500 }, (_, n) => {
        const first = pick(names);
        const last = pick(names);

        return person(n + 1, `${first} ${last}`, { email: `${first}.${last}${n}@appflowy.io`.toLowerCase() });
      })
    );

    const snapshot = getMentionLocalSnapshot(WORKSPACE);
    const buildStart = performance.now();
    const lane = buildMentionLocalLane({ snapshot });
    const buildMs = performance.now() - buildStart;

    expect(lane).toHaveLength(5_500);

    const answer = [
      section(MentionSearchSectionKind.People, []),
      section(
        MentionSearchSectionKind.Pages,
        Array.from({ length: 20 }, (_, n) => page(`v0-${n}`, lane[n + 1].title))
      ),
    ];
    const queries = ['r', 'ro', 'roa', 'road', 'roadm', 'meet', 'meeting n', 'q3', 'pl', 'plan'];
    const typed = [...queries, 'an', 'ann', 'jo', 'jose', 'x@', 'appflowy.io', '路线', '회의', 'notes', 'résumé'];
    const merge = (query: string) =>
      mentionMergedPickerSections(
        mergeMentionSections({
          request: { query, limit: 20 },
          server: answer,
          local: lane,
          nowMs: NOW,
          limit: (_, serverItems) => Math.max(20, serverItems),
        }),
        String
      );
    const times: number[] = [];

    // The first keystroke after start-up prepares every text, as the picker does when it opens.
    typed.forEach(merge);
    for (let round = 0; round < 5; round += 1) {
      typed.forEach((query) => {
        const start = performance.now();
        const merged = merge(query);

        times.push(performance.now() - start);
        expect(merged.sections.every((found) => found.items.length <= 20)).toBe(true);
      });
    }

    times.sort((left, right) => left - right);

    const median = times[Math.floor(times.length / 2)];
    const p95 = times[Math.floor(times.length * 0.95)];

    if (process.env.MENTION_LANE_PERF_LOG) {
      // eslint-disable-next-line no-console
      console.log(
        `lane build ${buildMs.toFixed(2)} ms; merge median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, ` +
          `max ${times[times.length - 1].toFixed(2)} ms`
      );
    }

    // Loose bounds for a loaded CI runner; the logged figures are what the plan's budget compares.
    expect(buildMs).toBeLessThan(250);
    expect(median).toBeLessThan(40);
  });
});
