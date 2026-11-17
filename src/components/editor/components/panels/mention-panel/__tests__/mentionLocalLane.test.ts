import { performance } from 'perf_hooks';

import { emit, EventType } from '@/application/session/event';
import {
  MentionablePerson,
  MentionPersonRole,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
  View,
  ViewIconType,
  ViewLayout,
} from '@/application/types';

import {
  buildMentionLocalLane,
  clearMentionSessionPersonPicks,
  getMentionSessionPersonPicks,
  MENTION_BARE_CREATION_LIFT_MS,
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
import { mentionItemNavKey, mentionSearchItemToMention } from '../mentionUtils';

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
      const summary = lane.map(
        ({ key, title, email, icon, changedMs, lastUsedMs, tabOpenedMs, tabCreatedMs, present }) => ({
          key,
          title,
          email,
          icon,
          changedMs,
          lastUsedMs,
          tabOpenedMs,
          tabCreatedMs,
          present,
        })
      );

      expect(summary).toEqual([
        {
          key: 'page:a',
          title: 'Alpha',
          email: undefined,
          icon: { ty: ViewIconType.Emoji, value: '🚗' },
          changedMs: undefined,
          // This tab's open is newer than the server's view time.
          lastUsedMs: NOW - 2 * MINUTE,
          tabOpenedMs: NOW - 2 * MINUTE,
          tabCreatedMs: undefined,
          present: undefined,
        },
        {
          key: 'database:db:grid',
          title: 'Road tasks',
          email: undefined,
          icon: null,
          changedMs: NOW - 4 * MINUTE,
          lastUsedMs: undefined,
          tabOpenedMs: undefined,
          tabCreatedMs: undefined,
          present: undefined,
        },
        {
          key: 'page:new',
          title: 'Zebra plan',
          email: undefined,
          icon: null,
          changedMs: NOW - MINUTE,
          lastUsedMs: NOW - MINUTE,
          // Created and never opened: Cloud's bare answer does not list it.
          tabOpenedMs: undefined,
          tabCreatedMs: NOW - MINUTE,
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
          tabOpenedMs: undefined,
          tabCreatedMs: undefined,
          present: false,
        },
        {
          key: `person:${uuid(2)}`,
          title: 'Bob',
          email: 'bob@appflowy.io',
          icon: null,
          changedMs: undefined,
          lastUsedMs: undefined,
          tabOpenedMs: undefined,
          tabCreatedMs: undefined,
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

    it('names the view a database is listed by when its view is unknown, so inserting it opens that view', () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [
          view('space', 'General', {
            extra: { is_space: true },
            children: [
              // A container whose children the outline has not loaded yet.
              view('container', 'Road tasks', {
                layout: ViewLayout.Grid,
                extra: { is_space: false, is_database_container: true, database_id: 'db' },
              }),
            ],
          }),
        ],
      });
      // What `addPage` records for a new Grid: the container it created, and its database.
      recordMentionViewCreated(
        WORKSPACE,
        { viewId: 'new', name: 'Road budget', layout: ViewLayout.Grid, parentViewId: 'space', databaseId: 'new-db' },
        NOW - MINUTE
      );

      const lane = buildMentionLocalLane({ snapshot: getMentionLocalSnapshot(WORKSPACE) });

      expect(lane.map((entry) => [entry.key, entry.item.object_id, mentionItemNavKey(entry.item)])).toEqual([
        ['database:db:-', 'container', 'database:db:-'],
        ['database:new-db:-', 'new', 'database:new-db:-'],
      ]);
      // A page reference to the view, never to the database id, which names no view in any client.
      expect(mentionSearchItemToMention(lane[0].item)).toEqual({
        type: MentionType.PageRef,
        page_id: 'container',
        database_id: 'db',
        data: { title: 'Road tasks' },
      });
      expect(mentionSearchItemToMention(lane[1].item)).toMatchObject({ page_id: 'new', database_id: 'new-db' });
    });

    it('gives the view the editor shows no recency, a database by the view it is listed or answered by', () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [
          view('current', 'Road trip'),
          view('atlas', 'Road atlas'),
          view('tasks', 'Tasks', {
            layout: ViewLayout.Grid,
            extra: { is_space: false, is_database_container: true, database_id: 'db' },
            children: [
              view('tasks-grid', 'Grid', { layout: ViewLayout.Grid, extra: { is_space: false, database_id: 'db' } }),
            ],
          }),
        ],
        recent: [view('current', 'Road trip', { last_viewed_at: new Date(NOW - 5 * MINUTE).toISOString() })],
      });
      recordMentionViewOpened(WORKSPACE, 'atlas', NOW - 3 * MINUTE);
      recordMentionViewOpened(WORKSPACE, 'tasks-grid', NOW - 2 * MINUTE);
      recordMentionViewRenamed(WORKSPACE, 'current', 'Road trip 2027', NOW - MINUTE);
      // Opening the page being edited made it this tab's latest open.
      recordMentionViewOpened(WORKSPACE, 'current', NOW - 1_000);
      // A page this tab created, which the editor may show next.
      recordMentionViewCreated(
        WORKSPACE,
        { viewId: 'draft', name: 'Road draft', layout: ViewLayout.Document },
        NOW - 30_000
      );

      const signals = (contextViewId?: string) =>
        buildMentionLocalLane({ snapshot: getMentionLocalSnapshot(WORKSPACE), contextViewId }).map(
          ({ key, title, changedMs, lastUsedMs, tabOpenedMs, tabCreatedMs }) => [
            key,
            title,
            changedMs,
            lastUsedMs,
            tabOpenedMs,
            tabCreatedMs,
          ]
        );
      const atlas = ['page:atlas', 'Road atlas', undefined, NOW - 3 * MINUTE, NOW - 3 * MINUTE, undefined];
      const tasks = ['database:db:tasks-grid', 'Tasks', undefined, NOW - 2 * MINUTE, NOW - 2 * MINUTE, undefined];
      const draft = ['page:draft', 'Road draft', NOW - 30_000, NOW - 30_000, undefined, NOW - 30_000];

      expect(signals()).toEqual([
        ['page:current', 'Road trip 2027', NOW - MINUTE, NOW - 1_000, NOW - 1_000, undefined],
        atlas,
        tasks,
        draft,
      ]);
      // As the context it keeps its title and when it changed, but neither this tab's open nor the
      // server's view time.
      expect(signals('current')).toEqual([
        ['page:current', 'Road trip 2027', NOW - MINUTE, undefined, undefined, undefined],
        atlas,
        tasks,
        draft,
      ]);
      // Nor this tab's creation.
      expect(signals('draft')[3]).toEqual(['page:draft', 'Road draft', NOW - 30_000, undefined, undefined, undefined]);
      // A Text cell's editor shows the database view Search answers for, or the container lists it.
      ['tasks-grid', 'tasks'].forEach((contextViewId) =>
        expect(signals(contextViewId)[2]).toEqual([
          'database:db:tasks-grid',
          'Tasks',
          undefined,
          undefined,
          undefined,
          undefined,
        ])
      );
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

    it("lifts this tab's opens since the cutoff and its unopened creations, newest first, server items moved", () => {
      const sections = [section(MentionSearchSectionKind.Pages, [page('a', 'Alpha'), page('b', 'Beta')])];
      const created = (at: number) => ({ tabCreatedMs: at, changedMs: at });
      const lane = [
        laneEntry('page:a', 'Alpha'),
        laneEntry('page:b', 'Beta', { tabOpenedMs: NOW - 2_000 }),
        laneEntry('page:c', 'Gamma', created(NOW - 1_000)),
        // An open before the cutoff: the answer reflects it.
        laneEntry('page:d', 'Delta', { tabOpenedMs: NOW - 5 * MINUTE }),
        // A creation before the cutoff that the tab never opened: no answer lists it.
        laneEntry('page:e', 'Epsilon', created(NOW - 4 * MINUTE)),
        // One older than the creations' window.
        laneEntry('page:f', 'Phi', created(NOW - MENTION_BARE_CREATION_LIFT_MS - 1)),
        // A creation the tab opened before the cutoff: the answer reflects the open.
        laneEntry('page:g', 'Gamma 2', { ...created(NOW - 10 * MINUTE), tabOpenedMs: NOW - 9 * MINUTE }),
      ];
      const patched = patchMentionBareSections({ ...base, sections, lane, liftAfterMs: NOW - MINUTE });

      expect(keysOf(patched.sections)).toEqual([['pages', ['page:c', 'page:b', 'page:e', 'page:a']]]);
      expect([...patched.localKeys]).toEqual(['page:c', 'page:e']);
      expect([...patched.freshKeys]).toEqual(['page:c', 'page:e']);
      // An answer cached 4 minutes ago lifts the opens since a minute before it, and the same
      // creations: their window does not depend on the answer's age.
      expect(
        keysOf(patchMentionBareSections({ ...base, sections, lane, liftAfterMs: NOW - 5 * MINUTE }).sections)
      ).toEqual([['pages', ['page:c', 'page:b', 'page:e', 'page:d', 'page:a']]]);
      expect(MENTION_BARE_CREATION_LIFT_MS).toBe(15 * MINUTE);

      // Without an answer, as after a failure, every open and creation of this tab counts.
      const fallback = patchMentionBareSections({ ...base, sections: [], lane });

      expect(keysOf(fallback.sections)).toEqual([
        ['pages', ['page:c', 'page:b', 'page:e', 'page:d', 'page:g', 'page:f']],
      ]);
      expect(fallback.sections[0].title).toBe('title:pages');
    });

    it('never lifts the view the editor shows, which stays where the server puts it', () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [view('current', 'Road trip'), view('gamma', 'Gamma'), view('alpha', 'Alpha')],
      });
      recordMentionViewOpened(WORKSPACE, 'gamma', NOW - 2_000);
      recordMentionViewOpened(WORKSPACE, 'current', NOW - 1_000);

      const lane = buildMentionLocalLane({ snapshot: getMentionLocalSnapshot(WORKSPACE), contextViewId: 'current' });
      // Search lists the page being edited first on a bare `@`.
      const sections = [section(MentionSearchSectionKind.Pages, [page('current', 'Road trip'), page('alpha', 'Alpha')])];

      expect(keysOf(patchMentionBareSections({ ...base, sections, lane, liftAfterMs: NOW - MINUTE }).sections)).toEqual([
        ['pages', ['page:gamma', 'page:current', 'page:alpha']],
      ]);
      // Nor is it among this tab's opens when there is no answer.
      expect(keysOf(patchMentionBareSections({ ...base, sections: [], lane }).sections)).toEqual([
        ['pages', ['page:gamma']],
      ]);
    });

    it('returns the sections themselves when nothing is lifted', () => {
      const sections = [section(MentionSearchSectionKind.Pages, [page('a', 'Alpha')])];
      const patched = patchMentionBareSections({
        ...base,
        sections,
        lane: [
          laneEntry('page:a', 'Alpha', { tabOpenedMs: NOW - 5 * MINUTE }),
          laneEntry('page:z', 'Zed', { tabCreatedMs: NOW - 20 * MINUTE }),
        ],
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

    it('lifts only people on the page whom the answer or the roster lists, those only the roster lists by name', () => {
      const [anna, bob, wang, zoe] = [person(1, 'Anna'), person(2, 'Bob'), person(3, '王小明'), person(4, 'zoe')];

      setMentionIndexSources(WORKSPACE, { outline: [] });
      recordMentionRoster(WORKSPACE, [anna, bob, wang, zoe]);

      const snapshot = getMentionLocalSnapshot(WORKSPACE);
      // Three collaborators who joined after the roster loaded, whom neither it nor the answer lists,
      // and three roster members, one of whom the answer lists.
      const presentPersonIds = mentionPresentPersonIds(
        snapshot.people,
        new Set([uuid(50), uuid(51), uuid(52), wang.person_id, zoe.person_id, bob.person_id])
      );
      const lane = buildMentionLocalLane({ snapshot, presentPersonIds });
      const sections = [section(MentionSearchSectionKind.People, [personItem(anna), personItem(bob)])];
      const patched = patchMentionBareSections({ ...base, sections, lane, liftAfterMs: NOW - MINUTE, presentPersonIds });

      expect(presentPersonIds.size).toBe(6);
      // Bob, whom the answer lists, then the roster's people by name; no slot goes to someone unknown.
      expect(keysOf(patched.sections)).toEqual([
        ['people', [bob, zoe, wang, anna].map((entry) => `person:${entry.person_id}`)],
      ]);
      expect([...patched.localKeys]).toEqual([`person:${zoe.person_id}`, `person:${wang.person_id}`]);
    });

    it('lifts only the kinds the picker asks for, into sections in their canonical place', () => {
      const lane = [
        laneEntry('page:c', 'Gamma', { tabOpenedMs: NOW }),
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
      const lane = Array.from({ length: 5 }, (_, n) => laneEntry(`page:l${n}`, `Local ${n}`, { tabOpenedMs: NOW - n }));
      const patched = patchMentionBareSections({
        ...base,
        sections: [section(MentionSearchSectionKind.Pages, listed)],
        lane,
        liftAfterMs: NOW - MINUTE,
      });

      expect(patched.sections[0].items).toHaveLength(22);
      expect(patched.sections[0].items.slice(0, 5).map(mentionItemNavKey)).toEqual(lane.map((entry) => entry.key));
    });

    it('never lifts what the Suggested section lists, which Cloud moved out of its own section (MEN-WEB-11)', () => {
      const [anna, bob, cy, dee, eve] = [1, 2, 3, 4, 5].map((n) =>
        person(n, ['Anna', 'Bob', 'Cy', 'Dee', 'Eve'][n - 1])
      );
      const people = [anna, bob, cy, dee, eve];
      const suggested = section(MentionSearchSectionKind.Suggested, [page('a', 'Alpha'), personItem(anna)]);
      const sections = [
        suggested,
        section(MentionSearchSectionKind.People, [personItem(bob)]),
        section(MentionSearchSectionKind.Pages, [page('b', 'Beta')]),
      ];
      const lane = [
        // This tab opened Alpha just now, and created Gamma: only Gamma is lifted.
        laneEntry('page:a', 'Alpha', { tabOpenedMs: NOW - 1_000 }),
        laneEntry('page:c', 'Gamma', { tabCreatedMs: NOW - 2_000, changedMs: NOW - 2_000 }),
        ...people.map((entry) => ({
          key: `person:${entry.person_id}`,
          title: entry.name,
          email: entry.email,
          item: personItem(entry),
        })),
      ];
      const patched = patchMentionBareSections({
        ...base,
        sections,
        lane,
        liftAfterMs: NOW - MINUTE,
        // Anna was picked in this tab and is on the page: she stays in Suggested.
        personPicks: new Map([[anna.person_id, NOW - 3_000]]),
        // So three others on the page are lifted, not two.
        presentPersonIds: new Set([anna.person_id, cy.person_id, dee.person_id, eve.person_id]),
      });

      expect(patched.sections[0]).toBe(suggested);
      expect(keysOf(patched.sections)).toEqual([
        ['suggested', ['page:a', `person:${anna.person_id}`]],
        ['people', [cy, dee, eve, bob].map((entry) => `person:${entry.person_id}`)],
        ['pages', ['page:c', 'page:b']],
      ]);
      // Neither of the suggested items counts as one only this tab listed.
      expect([...patched.localKeys].sort()).toEqual(
        ['page:c', ...[cy, dee, eve].map((entry) => `person:${entry.person_id}`)].sort()
      );
      expect([...patched.freshKeys]).toEqual(['page:c']);
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
