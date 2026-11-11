import { createInstance } from 'i18next';

import {
  MentionablePerson,
  MentionPersonRole,
  MentionSearchResultItem,
  MentionTargetKind,
  MentionType,
  View,
  ViewIconType,
  ViewLayout,
} from '@/application/types';

import {
  MENTION_CHIP_CREATED_WITHIN_MS,
  MENTION_CHIP_CREATION_FIRST_MS,
  MENTION_CHIP_OPENED_WITHIN_MS,
  MENTION_ITEM_DETAILS_OVERRIDE_KEY,
  mentionChipAge,
  mentionImageSource,
  mentionItemBreadcrumb,
  mentionItemIsContext,
  mentionItemLocalView,
  mentionItemRosterPerson,
  mentionPersonAvatarSource,
  mentionReasonChip,
  mentionReasonChipLabel,
  readMentionItemDetailsEnabled,
} from '../mentionItemDetails';
import {
  clearMentionLocalIndex,
  getMentionLocalSnapshot,
  MentionLocalView,
  recordMentionRoster,
  recordMentionViewCreated,
  setMentionIndexSources,
} from '../mentionLocalIndex';
import { mentionSearchItemToMention } from '../mentionUtils';

const WORKSPACE = 'workspace';
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function page(id: string, title: string, fields: Partial<MentionSearchResultItem> = {}): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Page,
    object_id: id,
    title,
    mention: { type: MentionTargetKind.Page, page_id: id },
    ...fields,
  };
}

function person(id: string, name: string, fields: Partial<MentionSearchResultItem> = {}): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: id,
    title: name,
    subtitle: `${name.toLowerCase()}@appflowy.io`,
    mention: { type: MentionTargetKind.Person, person_id: id, person_name: name, page_id: 'doc' },
    ...fields,
  };
}

function roster(id: string, name: string, avatar: string | null): MentionablePerson {
  return {
    uid: '1',
    avatar_url: avatar,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    email: `${name.toLowerCase()}@appflowy.io`,
    name,
    role: MentionPersonRole.Member,
    person_id: id,
    invited: false,
    last_mentioned_at: null,
  };
}

function outlineView(id: string, name: string, fields: Partial<View> = {}): View {
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

/** A local index view with only the times a test gives. */
function localView(fields: Partial<MentionLocalView> = {}): MentionLocalView {
  return {
    viewId: 'notes',
    name: 'Notes',
    layout: ViewLayout.Document,
    icon: null,
    isDatabase: false,
    navKey: 'page:notes',
    source: 'outline',
    ...fields,
  };
}

const translations: Record<string, string> = {
  'document.mention.reason.opened': 'Opened {{time}}',
  'document.mention.reason.created': 'Created {{time}}',
  'document.mention.reason.onThisPage': 'On this page',
  'document.mention.reason.justNow': 'just now',
  'document.mention.reason.minutesAgo': '{{count}} min ago',
  'document.mention.reason.hoursAgo': '{{count}} hours ago',
  'document.mention.reason.daysAgo': '{{count}} days ago',
};

function t(key: string, options: Record<string, unknown> = {}) {
  return (translations[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]));
}

describe('mention item details (MEN-WEB-13)', () => {
  afterEach(() => {
    clearMentionLocalIndex();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  describe('the switch', () => {
    it('is off by default, on or off by the browser, and off when storage cannot be read', () => {
      expect(readMentionItemDetailsEnabled()).toBe(false);
      localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true');
      expect(readMentionItemDetailsEnabled()).toBe(true);
      localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'false');
      expect(readMentionItemDetailsEnabled()).toBe(false);
      localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'yes');
      expect(readMentionItemDetailsEnabled()).toBe(false);

      localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true');
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      expect(readMentionItemDetailsEnabled()).toBe(false);
    });
  });

  describe('mentionItemBreadcrumb', () => {
    const complete = { path_status: 'complete' as const };

    it('joins a complete path root first, and tells two items of one title apart', () => {
      const specs = page('a', 'Meeting notes', {
        ...complete,
        path: [
          { view_id: 'eng', title: 'Engineering' },
          { view_id: 'specs', title: 'Specs' },
        ],
      });
      const marketing = page('b', 'Meeting notes', { ...complete, path: [{ view_id: 'mkt', title: 'Marketing' }] });

      expect(mentionItemBreadcrumb(specs)).toBe('Engineering / Specs');
      expect(mentionItemBreadcrumb(marketing)).toBe('Marketing');
    });

    it("shows a row's database view, and leaves blank titles out as Search does", () => {
      const row: MentionSearchResultItem = {
        kind: MentionTargetKind.DatabaseRow,
        object_id: 'row',
        title: 'Fix login',
        path: [{ view_id: 'tasks', title: 'Tasks' }],
        path_status: 'complete',
        mention: { type: MentionTargetKind.DatabaseRow, database_id: 'db', row_id: 'row' },
      };

      expect(mentionItemBreadcrumb(row)).toBe('Tasks');
      expect(
        mentionItemBreadcrumb(
          page('a', 'Notes', {
            ...complete,
            path: [
              { view_id: 'x', title: '  ' },
              { view_id: 'y', title: ' Specs ' },
            ],
          })
        )
      ).toBe('Specs');
      expect(mentionItemBreadcrumb(page('a', 'Notes', { ...complete, path: [{ view_id: 'x', title: '' }] }))).toBe(
        undefined
      );
      // Nothing left of the path: the server's subtitle is not shown instead.
      expect(
        mentionItemBreadcrumb(
          page('a', 'Notes', { ...complete, path: [{ view_id: 'x', title: ' ' }], subtitle: 'Notes' })
        )
      ).toBe(undefined);
    });

    it('shows nothing for an omitted or missing path, nor from the subtitle servers send', () => {
      const path = [{ view_id: 'eng', title: 'Engineering' }];

      expect(mentionItemBreadcrumb(page('a', 'Notes', { path, path_status: 'omitted_due_to_load' }))).toBe(undefined);
      expect(mentionItemBreadcrumb(page('a', 'Notes', { path, path_status: 'omitted_unavailable' }))).toBe(undefined);
      expect(mentionItemBreadcrumb(page('a', 'Notes', { path }))).toBe(undefined);
      expect(mentionItemBreadcrumb(page('a', 'Notes', { subtitle: 'Engineering' }))).toBe(undefined);
      expect(
        mentionItemBreadcrumb({
          kind: MentionTargetKind.Database,
          object_id: 'db',
          title: 'Tasks',
          subtitle: 'Database',
          mention: { type: MentionTargetKind.Database, database_id: 'db', database_view_id: 'grid' },
        })
      ).toBe(undefined);
      expect(mentionItemBreadcrumb(person('ada', 'Ada', { path, path_status: 'complete' }))).toBe(undefined);
    });
  });

  describe('images', () => {
    it('takes only strings an image loads from', () => {
      expect(mentionImageSource('https://cdn.appflowy.io/a.png')).toBe('https://cdn.appflowy.io/a.png');
      expect(mentionImageSource('/api/file_storage/a.png')).toBe('/api/file_storage/a.png');
      expect(mentionImageSource('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
      expect(mentionImageSource('blob:https://appflowy.io/1')).toBe('blob:https://appflowy.io/1');
      expect(mentionImageSource('🐻')).toBe(undefined);
      expect(mentionImageSource('')).toBe(undefined);
      expect(mentionImageSource({ ty: 'url', value: 'https://cdn.appflowy.io/a.png' })).toBe(undefined);
      expect(mentionImageSource(42)).toBe(undefined);
      expect(mentionImageSource(null)).toBe(undefined);
    });

    it("gives a person the roster's avatar by person id, never an object icon", () => {
      const avatar = 'https://cdn.appflowy.io/ada.png';

      setMentionIndexSources(WORKSPACE, { outline: [] });
      recordMentionRoster(WORKSPACE, [roster('ada', 'Ada', avatar), roster('bob', 'Bob', null)]);

      const snapshot = getMentionLocalSnapshot(WORKSPACE);
      const ada = person('ada', 'Ada', { icon: { ty: 'url', value: 'https://cdn.appflowy.io/other.png' } });
      const bob = person('bob', 'Bob', { icon: { ty: 'url', value: 'https://cdn.appflowy.io/bob.png' } });

      expect(mentionItemRosterPerson(snapshot, ada)?.name).toBe('Ada');
      expect(mentionPersonAvatarSource(ada, mentionItemRosterPerson(snapshot, ada))).toBe(avatar);
      expect(mentionPersonAvatarSource(bob, mentionItemRosterPerson(snapshot, bob))).toBe(undefined);
      // The shape older Web code expected still shows.
      expect(
        mentionPersonAvatarSource(person('eve', 'Eve', { icon: 'https://cdn.appflowy.io/eve.png' }), undefined)
      ).toBe('https://cdn.appflowy.io/eve.png');
    });

    it('never saves an object icon into an inserted mention', () => {
      const icon = { ty: 'url', value: 'https://cdn.appflowy.io/a.png' };
      const inserted = [
        mentionSearchItemToMention(person('ada', 'Ada', { icon })),
        mentionSearchItemToMention(page('notes', 'Notes', { icon })),
      ];

      inserted.forEach((mention) => expect(mention?.data?.icon).toBe(undefined));
      expect(inserted[0]).toMatchObject({ type: MentionType.Person, person_id: 'ada' });
      expect(
        mentionSearchItemToMention(page('notes', 'Notes', { icon: 'https://cdn.appflowy.io/a.png' }))?.data
      ).toEqual({ title: 'Notes', subtitle: undefined, icon: 'https://cdn.appflowy.io/a.png' });
    });
  });

  describe('local views', () => {
    it('finds a page and a database view, and a database by its id while the index lacks its view', () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [
          outlineView('space', 'General', {
            extra: { is_space: true },
            children: [
              outlineView('notes', 'Notes', { icon: { ty: ViewIconType.Emoji, value: '📝' } }),
              outlineView('grid', 'Tasks', { layout: ViewLayout.Board, extra: { is_space: false, database_id: 'db' } }),
            ],
          }),
        ],
      });
      // A database this tab created in a space, whose view the outline has not listed yet.
      recordMentionViewCreated(WORKSPACE, {
        viewId: 'new-db',
        name: 'Fresh',
        layout: ViewLayout.Grid,
        parentViewId: 'space',
        databaseId: 'db2',
      });

      const snapshot = getMentionLocalSnapshot(WORKSPACE);
      const database = (databaseId: string, viewId: string): MentionSearchResultItem => ({
        kind: MentionTargetKind.Database,
        object_id: databaseId,
        title: 'Tasks',
        database_id: databaseId,
        database_view_id: viewId,
        mention: { type: MentionTargetKind.Database, database_id: databaseId, database_view_id: viewId },
      });

      expect(mentionItemLocalView(snapshot, page('notes', 'Notes'))?.icon).toEqual({
        ty: ViewIconType.Emoji,
        value: '📝',
      });
      expect(mentionItemLocalView(snapshot, database('db', 'grid'))?.layout).toBe(ViewLayout.Board);
      expect(mentionItemLocalView(snapshot, database('db2', 'child-view'))?.viewId).toBe('new-db');
      expect(mentionItemLocalView(snapshot, page('missing', 'Missing'))).toBe(undefined);
      expect(mentionItemLocalView(snapshot, person('notes', 'Notes'))).toBe(undefined);
    });

    it('knows the page being edited by its view, its page id or its database view', () => {
      const view = localView({ viewId: 'container', databaseViewId: 'grid', navKey: 'database:db:grid' });
      const database: MentionSearchResultItem = {
        kind: MentionTargetKind.Database,
        object_id: 'db',
        title: 'Tasks',
        mention: { type: MentionTargetKind.Database, database_id: 'db', database_view_id: 'grid' },
      };

      expect(mentionItemIsContext(page('doc', 'Doc'), undefined, 'doc')).toBe(true);
      expect(mentionItemIsContext(page('doc', 'Doc'), undefined, 'other')).toBe(false);
      expect(mentionItemIsContext(page('doc', 'Doc'), undefined, undefined)).toBe(false);
      expect(mentionItemIsContext(database, undefined, 'grid')).toBe(true);
      expect(mentionItemIsContext(database, view, 'container')).toBe(true);
      expect(mentionItemIsContext(person('doc', 'Doc'), undefined, 'doc')).toBe(false);
    });
  });

  describe('mentionReasonChip', () => {
    it('says when this tab or the recent views last opened an item', () => {
      expect(
        mentionReasonChip({ item: page('a', 'A'), view: localView({ sessionOpenedAt: NOW - 3 * MINUTE }), nowMs: NOW })
      ).toEqual({ kind: 'opened', atMs: NOW - 3 * MINUTE });
      expect(
        mentionReasonChip({
          item: page('a', 'A'),
          view: localView({ sessionOpenedAt: NOW - 2 * DAY, lastViewedAt: NOW - HOUR }),
          nowMs: NOW,
        })
      ).toEqual({ kind: 'opened', atMs: NOW - HOUR });
      expect(
        mentionReasonChip({
          item: page('a', 'A'),
          view: localView({ lastViewedAt: NOW - MENTION_CHIP_OPENED_WITHIN_MS - 1 }),
          nowMs: NOW,
        })
      ).toBe(undefined);
    });

    it('says a recent creation first, then the newer of an open and a creation within their windows', () => {
      const created = (fields: Partial<MentionLocalView>) =>
        mentionReasonChip({ item: page('a', 'A'), view: localView(fields), nowMs: NOW });

      // Created by this tab 10 minutes ago and opened since: still "Created".
      expect(created({ sessionCreatedAt: NOW - 10 * MINUTE, sessionOpenedAt: NOW - MINUTE })).toEqual({
        kind: 'created',
        atMs: NOW - 10 * MINUTE,
      });
      // The outline's creation time counts when this tab did not create it.
      expect(created({ createdAt: NOW - 5 * MINUTE })).toEqual({ kind: 'created', atMs: NOW - 5 * MINUTE });
      // Past the first window, the newer of the two; an open wins a tie.
      expect(created({ createdAt: NOW - 3 * HOUR, lastViewedAt: NOW - 2 * HOUR })).toEqual({
        kind: 'opened',
        atMs: NOW - 2 * HOUR,
      });
      expect(created({ createdAt: NOW - 2 * HOUR, lastViewedAt: NOW - 3 * HOUR })).toEqual({
        kind: 'created',
        atMs: NOW - 2 * HOUR,
      });
      expect(created({ createdAt: NOW - 2 * HOUR, lastViewedAt: NOW - 2 * HOUR })).toEqual({
        kind: 'opened',
        atMs: NOW - 2 * HOUR,
      });
      expect(created({ createdAt: NOW - MENTION_CHIP_CREATED_WITHIN_MS - 1 })).toBe(undefined);
      expect(
        created({ sessionCreatedAt: NOW - MENTION_CHIP_CREATION_FIRST_MS - 1, sessionOpenedAt: NOW - MINUTE })
      ).toEqual({
        kind: 'opened',
        atMs: NOW - MINUTE,
      });
      // A time ahead of the clock counts as now.
      expect(created({ sessionCreatedAt: NOW + 5 * MINUTE })).toEqual({ kind: 'created', atMs: NOW + 5 * MINUTE });
    });

    it('never says an item was edited', () => {
      expect(
        mentionReasonChip({ item: page('a', 'A'), view: localView({ lastEditedAt: NOW - MINUTE }), nowMs: NOW })
      ).toBe(undefined);
      expect(
        mentionReasonChip({ item: page('a', 'A', { reason: { signal: 'changed', at: NOW - MINUTE } }), nowMs: NOW })
      ).toBe(undefined);
    });

    it("reads the server's viewed, created and participant reasons, and nothing else", () => {
      const reasoned = (reason: MentionSearchResultItem['reason']) =>
        mentionReasonChip({ item: page('a', 'A', { reason }), nowMs: NOW });

      expect(reasoned({ signal: 'viewed', at: NOW - 5 * MINUTE, matched: 'prefix', tier: 1 })).toEqual({
        kind: 'opened',
        atMs: NOW - 5 * MINUTE,
      });
      expect(reasoned({ signal: 'created', at: NOW - 2 * HOUR })).toEqual({ kind: 'created', atMs: NOW - 2 * HOUR });
      // A view the server ranked by position, without a time, has no copy.
      expect(reasoned({ signal: 'viewed' })).toBe(undefined);
      ['near', 'current', 'match', 'mentioned', 'interaction', 'picked', ''].forEach((signal) =>
        expect(reasoned({ signal, at: NOW - MINUTE })).toBe(undefined)
      );
      expect(reasoned({})).toBe(undefined);
      expect(reasoned({ signal: 'viewed', at: Number.NaN })).toBe(undefined);
      // The tab's own newer open wins over the server's older view.
      expect(
        mentionReasonChip({
          item: page('a', 'A', { reason: { signal: 'viewed', at: NOW - HOUR } }),
          view: localView({ sessionOpenedAt: NOW - 2 * MINUTE }),
          nowMs: NOW,
        })
      ).toEqual({ kind: 'opened', atMs: NOW - 2 * MINUTE });

      expect(
        mentionReasonChip({ item: person('ada', 'Ada', { reason: { signal: 'participant', at: NOW } }), nowMs: NOW })
      ).toEqual({
        kind: 'onThisPage',
      });
      ['mentioned', 'interaction', 'match'].forEach((signal) =>
        expect(
          mentionReasonChip({ item: person('ada', 'Ada', { reason: { signal, at: NOW - MINUTE } }), nowMs: NOW })
        ).toBe(undefined)
      );
    });

    it('says a person on the page is on it, and shows nothing for the page being edited or quick picks', () => {
      expect(mentionReasonChip({ item: person('ada', 'Ada'), present: true, nowMs: NOW })).toEqual({
        kind: 'onThisPage',
      });
      expect(mentionReasonChip({ item: person('ada', 'Ada'), nowMs: NOW })).toBe(undefined);
      expect(
        mentionReasonChip({
          item: page('doc', 'Doc', { reason: { signal: 'viewed', at: NOW } }),
          view: localView({ sessionOpenedAt: NOW }),
          context: true,
          nowMs: NOW,
        })
      ).toBe(undefined);
      expect(
        mentionReasonChip({
          item: {
            kind: MentionTargetKind.Date,
            title: 'Today',
            mention: { type: MentionTargetKind.Date, date: '2026-11-11' },
          },
          view: localView({ sessionOpenedAt: NOW }),
          nowMs: NOW,
        })
      ).toBe(undefined);
    });
  });

  describe('labels', () => {
    it('counts just now, then whole minutes, hours and days', () => {
      expect(mentionChipAge(NOW - 59_999, NOW)).toEqual({ unit: 'justNow' });
      expect(mentionChipAge(NOW + MINUTE, NOW)).toEqual({ unit: 'justNow' });
      expect(mentionChipAge(NOW - MINUTE, NOW)).toEqual({ unit: 'minutes', count: 1 });
      expect(mentionChipAge(NOW - HOUR + 1, NOW)).toEqual({ unit: 'minutes', count: 59 });
      expect(mentionChipAge(NOW - HOUR, NOW)).toEqual({ unit: 'hours', count: 1 });
      expect(mentionChipAge(NOW - DAY + 1, NOW)).toEqual({ unit: 'hours', count: 23 });
      expect(mentionChipAge(NOW - 3 * DAY, NOW)).toEqual({ unit: 'days', count: 3 });
    });

    it("puts the age into the chip's copy", () => {
      expect(mentionReasonChipLabel({ kind: 'opened', atMs: NOW - 3 * MINUTE }, NOW, t)).toBe('Opened 3 min ago');
      expect(mentionReasonChipLabel({ kind: 'created', atMs: NOW - 10_000 }, NOW, t)).toBe('Created just now');
      expect(mentionReasonChipLabel({ kind: 'created', atMs: NOW - 2 * HOUR }, NOW, t)).toBe('Created 2 hours ago');
      expect(mentionReasonChipLabel({ kind: 'opened', atMs: NOW - 2 * DAY }, NOW, t)).toBe('Opened 2 days ago');
      expect(mentionReasonChipLabel({ kind: 'onThisPage' }, NOW, t)).toBe('On this page');
    });

    it('keeps a translated age as it is written, with i18next as the app sets it up', () => {
      const i18n = createInstance();

      void i18n.init({
        lng: 'it',
        initImmediate: false,
        resources: {
          it: {
            translation: {
              document: { mention: { reason: { opened: 'Aperto {{time}}', hoursAgo_one: "un'ora fa" } } },
            },
          },
        },
      });

      expect(mentionReasonChipLabel({ kind: 'opened', atMs: NOW - HOUR }, NOW, i18n.t.bind(i18n))).toBe(
        "Aperto un'ora fa"
      );
    });
  });
});
