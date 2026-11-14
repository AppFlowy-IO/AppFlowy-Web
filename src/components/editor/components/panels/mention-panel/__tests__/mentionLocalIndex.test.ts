import { performance } from 'perf_hooks';

import { emit, EventType } from '@/application/session/event';
import {
  MentionablePerson,
  MentionPersonRole,
  MentionSearchResultItem,
  MentionTargetKind,
  View,
  ViewExtra,
  ViewLayout,
} from '@/application/types';

import {
  clearMentionLocalIndex,
  EMPTY_MENTION_LOCAL_SNAPSHOT,
  getMentionLocalSnapshot,
  MENTION_LOCAL_SESSION_LIMIT,
  MentionLocalSnapshot,
  recordMentionAccessChanged,
  recordMentionRoster,
  recordMentionViewCreated,
  recordMentionViewDeleted,
  recordMentionViewOpened,
  recordMentionViewRenamed,
  recordMentionViewRestored,
  setMentionIndexSources,
  subscribeMentionLocalIndex,
} from '../mentionLocalIndex';
import { mentionItemNavKey } from '../mentionUtils';

const WS = 'workspace-a';
const OTHER_WS = 'workspace-b';

function view(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function extra(value: Partial<ViewExtra>): ViewExtra {
  return value as ViewExtra;
}

function person(personId: string): MentionablePerson {
  return {
    uid: personId,
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    email: `${personId}@example.com`,
    name: personId,
    role: MentionPersonRole.Member,
    person_id: personId,
    invited: false,
    last_mentioned_at: null,
  };
}

/**
 * A space with every kind of view the server leaves out of mentions, next to the ones it keeps:
 * - kept: `roadmap`, its child `notes`, the `tasks` container, the `legacy` database, `spec`,
 *   the `overview` dashboard, `plan` (in a space marked only in `extra`) and `shared`;
 * - left out: spaces, a database's child views, an embedded view, a dashboard-owned view, a row
 *   document, a row template, and a trashed page with its subtree.
 */
function fixtureOutline(): View[] {
  return [
    view('space', {
      is_space: true,
      extra: extra({ is_space: true }),
      children: [
        view('roadmap', {
          name: 'Roadmap',
          parent_view_id: 'space',
          created_at: '2026-11-01T00:00:00Z',
          last_edited_time: '2026-11-02T00:00:00Z',
          children: [view('notes', { name: 'Notes', parent_view_id: 'roadmap' })],
        }),
        view('tasks', {
          name: 'Tasks',
          layout: ViewLayout.Grid,
          extra: extra({ is_database_container: true, database_id: 'db-1' }),
          children: [
            view('tasks-grid', { name: 'Grid', layout: ViewLayout.Grid, extra: extra({ database_id: 'db-1' }) }),
            view('tasks-board', { name: 'Board', layout: ViewLayout.Board, extra: extra({ database_id: 'db-1' }) }),
          ],
        }),
        view('legacy', {
          name: 'Legacy',
          layout: ViewLayout.Grid,
          extra: extra({ database_id: 'db-2' }),
          children: [view('legacy-board', { layout: ViewLayout.Board, extra: extra({ database_id: 'db-2' }) })],
        }),
        view('spec', {
          name: 'Spec',
          children: [
            view('spec-grid', {
              layout: ViewLayout.Grid,
              extra: extra({ database_id: 'db-3', embedded: true, is_database_container: true }),
            }),
          ],
        }),
        view('overview', { name: 'Overview', layout: ViewLayout.Dashboard }),
        view('widget', { layout: ViewLayout.Grid, extra: extra({ database_id: 'db-1', dashboard_owner: 'overview' }) }),
        view('row-page', { extra: extra({ row_document: { source: { row_id: 'row-1' } } }) }),
        view('row-template', { extra: extra({ database_row_template: true }) }),
        view('old', { name: 'Old', children: [view('old-child')] }),
      ],
    }),
    view('legacy-space', {
      extra: extra({ is_space: true }),
      children: [view('plan', { name: 'Plan', parent_view_id: 'legacy-space' })],
    }),
    view('shared-root', {
      is_space: true,
      extra: extra({ is_space: true, is_hidden_space: true }),
      children: [view('shared', { name: 'Shared', parent_view_id: 'private-space' })],
    }),
  ];
}

const TRASH = [view('old')];

function ids(snapshot: MentionLocalSnapshot = getMentionLocalSnapshot(WS)) {
  return snapshot.views.map((item) => item.viewId);
}

function local(viewId: string, snapshot: MentionLocalSnapshot = getMentionLocalSnapshot(WS)) {
  return snapshot.viewsById.get(viewId);
}

/** Gives the index a fresh outline reference, as an outline refresh does. */
function refreshOutline(outline = fixtureOutline(), sources: { recent?: View[]; trash?: View[] } = { trash: TRASH }) {
  setMentionIndexSources(WS, { outline, ...sources });
}

/** The fixture outline once `roadmap` and its subtree left it (moved to the trash). */
function outlineWithoutRoadmap(): View[] {
  const outline = fixtureOutline();

  outline[0].children = outline[0].children.filter((item) => item.view_id !== 'roadmap');
  return outline;
}

/** The fixture outline with `detail` below `notes`, two levels below `roadmap`. */
function outlineWithDetail(): View[] {
  const outline = fixtureOutline();

  outline[0].children[0].children[0].children = [view('detail', { name: 'Detail', parent_view_id: 'notes' })];
  return outline;
}

/** The fixture outline with `roadmap` named `name`. */
function outlineNamed(name: string): View[] {
  const outline = fixtureOutline();

  outline[0].children[0].name = name;
  return outline;
}

/** Those of `viewIds` the snapshot lists, in the given order. */
function listedOf(viewIds: string[]) {
  return viewIds.filter((viewId) => local(viewId) !== undefined);
}

/** A test runs once reading a snapshot after every step, once reading only at the end. */
const READS: [string, boolean][] = [
  ['reading between steps', true],
  ['reading only at the end', false],
];

function stepper(readBetween: boolean) {
  return () => {
    if (readBetween) getMentionLocalSnapshot(WS);
  };
}

beforeEach(() => {
  clearMentionLocalIndex();
});

describe('mentionLocalIndex candidates', () => {
  it('keeps the views a mention can target and leaves out what the server leaves out', () => {
    refreshOutline();

    expect(ids()).toEqual(['roadmap', 'notes', 'tasks', 'legacy', 'spec', 'overview', 'plan', 'shared']);
  });

  it('describes a page, with its server times and parent', () => {
    refreshOutline();

    expect(local('roadmap')).toEqual(
      expect.objectContaining({
        name: 'Roadmap',
        layout: ViewLayout.Document,
        isDatabase: false,
        parentViewId: 'space',
        navKey: 'page:roadmap',
        source: 'outline',
        createdAt: Date.parse('2026-11-01T00:00:00Z'),
        lastEditedAt: Date.parse('2026-11-02T00:00:00Z'),
      })
    );
    // A page shared with the user keeps its own parent, not the hidden root that lists it.
    expect(local('shared')?.parentViewId).toBe('private-space');
    expect(local('notes')?.parentViewId).toBe('roadmap');
  });

  it('keeps a database with the ids and key of the server item that answers for it', () => {
    refreshOutline();

    expect(local('tasks')).toEqual(
      expect.objectContaining({ isDatabase: true, databaseId: 'db-1', databaseViewId: 'tasks-grid' })
    );
    expect(local('legacy')).toEqual(
      expect.objectContaining({ isDatabase: true, databaseId: 'db-2', databaseViewId: 'legacy' })
    );

    const serverDatabase: MentionSearchResultItem = {
      kind: MentionTargetKind.Database,
      object_id: 'db-1',
      title: 'Tasks',
      database_id: 'db-1',
      database_view_id: 'tasks-grid',
      mention: { type: MentionTargetKind.Database, database_id: 'db-1', database_view_id: 'tasks-grid' },
    };
    const serverPage: MentionSearchResultItem = {
      kind: MentionTargetKind.Page,
      object_id: 'roadmap',
      title: 'Roadmap',
      mention: { type: MentionTargetKind.Page, page_id: 'roadmap' },
    };

    expect(local('tasks')?.navKey).toBe(mentionItemNavKey(serverDatabase));
    expect(local('roadmap')?.navKey).toBe(mentionItemNavKey(serverPage));
    expect(local('overview')?.navKey).toBe('database:-:overview');
  });

  it('takes last_viewed_at from the recent views and lists recent views the outline does not hold', () => {
    refreshOutline(fixtureOutline(), {
      trash: [...TRASH, view('recent-trashed')],
      recent: [
        view('roadmap', { name: 'Roadmap', last_viewed_at: '2026-11-09T10:00:00Z' }),
        // Opening a database opens its first view: it counts for the database.
        view('tasks-grid', { layout: ViewLayout.Grid, parent_view_id: 'tasks', last_viewed_at: '2026-11-09T11:00:00Z' }),
        view('deep', { name: 'Deep page', parent_view_id: 'beyond-depth', last_viewed_at: '2026-11-09T12:00:00Z' }),
        view('recent-space', { is_space: true }),
        view('recent-trashed'),
        view('recent-row', { extra: extra({ row_document: { source: { row_id: 'row-2' } } }) }),
      ],
    });

    expect(local('roadmap')?.lastViewedAt).toBe(Date.parse('2026-11-09T10:00:00Z'));
    expect(local('tasks')?.lastViewedAt).toBe(Date.parse('2026-11-09T11:00:00Z'));
    expect(local('deep')).toEqual(
      expect.objectContaining({
        name: 'Deep page',
        source: 'recent',
        parentViewId: 'beyond-depth',
        lastViewedAt: Date.parse('2026-11-09T12:00:00Z'),
      })
    );
    expect(ids()).not.toEqual(expect.arrayContaining(['tasks-grid']));
    expect(ids()).toEqual(['roadmap', 'notes', 'tasks', 'legacy', 'spec', 'overview', 'plan', 'shared', 'deep']);
  });

  it('reads the fields of the server’s folder-view and recent-view payloads', () => {
    // `FolderView` and `RecentFolderView` (`workspace_dto.rs`) as released servers send them: chrono
    // writes up to nine fractional digits, and the space marker is a top-level field.
    const folderView = {
      view_id: 'doc-1',
      parent_view_id: 'space-1',
      prev_view_id: null,
      name: 'Launch plan',
      icon: { ty: 0, value: '🚀' },
      is_space: false,
      is_private: false,
      is_published: false,
      is_favorite: false,
      layout: 0,
      created_at: '2026-11-01T08:00:00.123456Z',
      created_by: 1,
      last_edited_by: 1,
      last_edited_time: '2026-11-02T09:30:00.654321789Z',
      is_locked: null,
      extra: null,
      children: [],
      has_children: false,
      access_level: 50,
      version: null,
      workspace_id: WS,
    };
    const outline = JSON.parse(
      JSON.stringify([
        {
          ...folderView,
          view_id: 'space-1',
          parent_view_id: WS,
          name: 'General',
          is_space: true,
          children: [folderView],
        },
      ])
    ) as View[];
    const recent = JSON.parse(JSON.stringify([{ ...folderView, last_viewed_at: '2026-11-09T10:00:00.5Z' }])) as View[];

    setMentionIndexSources(WS, { outline, recent });

    expect(ids()).toEqual(['doc-1']);
    expect(local('doc-1')).toEqual(
      expect.objectContaining({
        name: 'Launch plan',
        icon: { ty: 0, value: '🚀' },
        parentViewId: 'space-1',
        createdAt: Date.UTC(2026, 10, 1, 8, 0, 0, 123),
        lastEditedAt: Date.UTC(2026, 10, 2, 9, 30, 0, 654),
        lastViewedAt: Date.UTC(2026, 10, 9, 10, 0, 0, 500),
      })
    );
  });

  it('reads a view listed twice once, and survives an outline that lists itself again', () => {
    const outline = fixtureOutline();
    const roadmap = outline[0].children[0];

    // A malformed outline whose page holds itself.
    roadmap.children = [...roadmap.children, roadmap];
    outline[2].children.push(roadmap);
    refreshOutline(outline);

    expect(ids().filter((viewId) => viewId === 'roadmap')).toHaveLength(1);
  });
});

// A space's access or members, a member's role or a group changed (PERMISSION_CHANGED): the app
// names no view the user lost, the outline reloads, and the recent views loaded before stay.
describe('mentionLocalIndex access changes', () => {
  const recentViews = () => [
    view('roadmap', { name: 'Roadmap', parent_view_id: 'space', last_viewed_at: '2026-11-09T10:00:00Z' }),
    view('deep', { name: 'Deep page', parent_view_id: 'beyond-depth' }),
  ];

  it('lists no view that only the recent views loaded before list, until they reload', () => {
    const recent = recentViews();

    refreshOutline(fixtureOutline(), { trash: TRASH, recent });
    expect(listedOf(['roadmap', 'notes', 'deep'])).toEqual(['roadmap', 'notes', 'deep']);

    const before = getMentionLocalSnapshot(WS);

    recordMentionAccessChanged(WS);

    // The outline decides for the views it lists, and the recent views still time them.
    expect(getMentionLocalSnapshot(WS)).not.toBe(before);
    expect(listedOf(['roadmap', 'notes', 'deep'])).toEqual(['roadmap', 'notes']);
    expect(local('roadmap')?.lastViewedAt).toBe(Date.parse('2026-11-09T10:00:00Z'));

    // The reloaded outline drops the page the user lost; the recent views still list it.
    refreshOutline(outlineWithoutRoadmap(), { trash: TRASH, recent });
    expect(listedOf(['roadmap', 'notes', 'deep'])).toEqual([]);

    // Recent views loaded since reflect the user's access.
    refreshOutline(outlineWithoutRoadmap(), { trash: TRASH, recent: recentViews().slice(1) });
    expect(listedOf(['roadmap', 'notes', 'deep'])).toEqual(['deep']);
  });

  it('keeps out a creation that only those recent views list', () => {
    const recent = [...recentViews(), view('fresh', { name: 'Fresh', parent_view_id: 'space' })];

    refreshOutline(fixtureOutline(), { trash: TRASH });
    recordMentionViewCreated(WS, { viewId: 'fresh', name: 'Fresh', layout: ViewLayout.Document, parentViewId: 'space' });
    refreshOutline(fixtureOutline(), { trash: TRASH, recent });
    expect(listedOf(['fresh'])).toEqual(['fresh']);

    recordMentionAccessChanged(WS);
    expect(listedOf(['fresh'])).toEqual([]);

    // Once the outline lists it, the user can read it.
    const outline = fixtureOutline();

    outline[0].children.push(view('fresh', { name: 'Fresh', parent_view_id: 'space' }));
    refreshOutline(outline, { trash: TRASH, recent });
    expect(local('fresh')).toEqual(expect.objectContaining({ source: 'outline', sessionCreatedAt: expect.any(Number) }));
  });

  it('keeps out a creation no source listed yet when the access changed', () => {
    // A page created below `notes`, whose children the outline has not loaded: a page made from a
    // block opens in the page modal, which adds nothing to the outline.
    refreshOutline(fixtureOutline(), { trash: TRASH, recent: [] });
    recordMentionViewCreated(WS, {
      viewId: 'secret',
      name: 'Secret',
      layout: ViewLayout.Document,
      parentViewId: 'notes',
    });
    expect(local('secret')?.source).toBe('session');

    recordMentionAccessChanged(WS);
    expect(listedOf(['secret'])).toEqual([]);

    const changed = getMentionLocalSnapshot(WS);

    recordMentionAccessChanged(WS);
    expect(getMentionLocalSnapshot(WS)).toBe(changed);

    // The user lost `roadmap`: the reloaded outline drops it with `notes`, and recent views loaded
    // since list none of them.
    refreshOutline(outlineWithoutRoadmap(), { trash: TRASH, recent: [] });
    expect(listedOf(['roadmap', 'notes', 'secret'])).toEqual([]);

    // A page created since the change is one the user can read.
    recordMentionViewCreated(WS, { viewId: 'later', name: 'Later', layout: ViewLayout.Document, parentViewId: 'plan' });
    expect(local('later')?.source).toBe('session');
  });

  it('lists such a creation again once a source lists it', () => {
    refreshOutline(fixtureOutline(), { trash: TRASH, recent: [] });
    recordMentionViewCreated(WS, {
      viewId: 'secret',
      name: 'Secret',
      layout: ViewLayout.Document,
      parentViewId: 'notes',
    });
    recordMentionAccessChanged(WS);
    expect(listedOf(['secret'])).toEqual([]);

    // Recent views loaded since the change list it: the user opened it, so can read it.
    refreshOutline(fixtureOutline(), {
      trash: TRASH,
      recent: [view('secret', { name: 'Secret', parent_view_id: 'notes' })],
    });
    expect(local('secret')).toEqual(expect.objectContaining({ source: 'recent', sessionCreatedAt: expect.any(Number) }));
  });

  it('changes nothing without recent views, for another workspace, or twice for the same ones', () => {
    recordMentionAccessChanged(WS);
    expect(getMentionLocalSnapshot(WS)).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);

    refreshOutline(fixtureOutline(), { trash: TRASH });

    const withoutRecent = getMentionLocalSnapshot(WS);

    recordMentionAccessChanged(WS);
    recordMentionAccessChanged(OTHER_WS);
    expect(getMentionLocalSnapshot(WS)).toBe(withoutRecent);

    // Recent views loaded after the change are trusted.
    refreshOutline(fixtureOutline(), { trash: TRASH, recent: recentViews() });
    expect(listedOf(['deep'])).toEqual(['deep']);

    recordMentionAccessChanged(WS);

    const changed = getMentionLocalSnapshot(WS);

    recordMentionAccessChanged(WS);
    expect(getMentionLocalSnapshot(WS)).toBe(changed);
  });
});

describe('mentionLocalIndex session events', () => {
  it('lists a page created in this tab in the next snapshot, before the outline does', () => {
    refreshOutline();
    recordMentionViewCreated(
      WS,
      { viewId: 'zebra', name: 'Zebra plan', layout: ViewLayout.Document, parentViewId: 'space' },
      1000
    );

    expect(local('zebra')).toEqual(
      expect.objectContaining({
        name: 'Zebra plan',
        layout: ViewLayout.Document,
        parentViewId: 'space',
        source: 'session',
        navKey: 'page:zebra',
        sessionCreatedAt: 1000,
      })
    );
  });

  it('keeps the session times through outline refreshes', () => {
    refreshOutline();
    recordMentionViewCreated(
      WS,
      { viewId: 'zebra', name: 'Zebra plan', layout: ViewLayout.Document, parentViewId: 'space' },
      1000
    );
    recordMentionViewOpened(WS, 'roadmap', 2000);

    const outline = fixtureOutline();

    outline[0].children.push(view('zebra', { name: 'Zebra plan', parent_view_id: 'space' }));
    refreshOutline(outline);

    expect(local('zebra')).toEqual(expect.objectContaining({ source: 'outline', sessionCreatedAt: 1000 }));
    expect(ids().filter((viewId) => viewId === 'zebra')).toHaveLength(1);
    expect(local('roadmap')?.sessionOpenedAt).toBe(2000);

    refreshOutline();
    expect(local('roadmap')?.sessionOpenedAt).toBe(2000);
  });

  it('stops listing a creation once the outline listed it and then dropped it', () => {
    refreshOutline();
    recordMentionViewCreated(WS, {
      viewId: 'zebra',
      name: 'Zebra plan',
      layout: ViewLayout.Document,
      parentViewId: 'space',
    });

    const outline = fixtureOutline();

    outline[0].children.push(view('zebra', { name: 'Zebra plan' }));
    refreshOutline(outline);
    expect(local('zebra')).toBeDefined();

    // Deleted elsewhere: the outline decides from now on.
    refreshOutline();
    expect(local('zebra')).toBeUndefined();
  });

  it.each(READS)('stops listing a creation the outline listed and the trash list shows, %s', (_label, readBetween) => {
    const step = stepper(readBetween);
    const listing = fixtureOutline();

    listing[0].children.push(view('zebra', { name: 'Zebra plan', parent_view_id: 'space' }));
    refreshOutline();
    recordMentionViewCreated(WS, {
      viewId: 'zebra',
      name: 'Zebra plan',
      layout: ViewLayout.Document,
      parentViewId: 'space',
    });
    step();
    refreshOutline(listing);
    step();
    // Moved to the trash in another tab.
    refreshOutline(fixtureOutline(), { trash: [...TRASH, view('zebra')] });

    expect(local('zebra')).toBeUndefined();
  });

  it('stops listing a creation the trash list shows before the outline lists it, for good', () => {
    refreshOutline();
    recordMentionViewCreated(WS, {
      viewId: 'zebra',
      name: 'Zebra plan',
      layout: ViewLayout.Document,
      parentViewId: 'space',
    });
    refreshOutline(fixtureOutline(), { trash: [...TRASH, view('zebra')] });
    expect(local('zebra')).toBeUndefined();

    // Deleted for good: neither list shows it again.
    refreshOutline();
    expect(local('zebra')).toBeUndefined();
  });

  it.each(READS)(
    'leaves a creation the outline listed before it was recorded to the outline, %s',
    (_label, readBetween) => {
      const listing = fixtureOutline();

      // A default creation resolves once the outline shows the page.
      listing[0].children.push(view('zebra', { name: 'Untitled', parent_view_id: 'space' }));
      refreshOutline(listing);
      recordMentionViewCreated(
        WS,
        { viewId: 'zebra', name: '', layout: ViewLayout.Document, parentViewId: 'space' },
        1000
      );
      if (readBetween) {
        expect(local('zebra')).toEqual(
          expect.objectContaining({ name: 'Untitled', source: 'outline', sessionCreatedAt: 1000 })
        );
      }

      // Deleted elsewhere: the outline decides.
      refreshOutline();
      expect(local('zebra')).toBeUndefined();
    }
  );

  it('keeps the latest open', () => {
    refreshOutline();
    recordMentionViewOpened(WS, 'roadmap', 5000);
    recordMentionViewOpened(WS, 'roadmap', 4000);

    expect(local('roadmap')?.sessionOpenedAt).toBe(5000);
  });

  it('counts the creation and the opens of a database view for its database', () => {
    refreshOutline();
    recordMentionViewOpened(WS, 'tasks-board', 3000);
    recordMentionViewCreated(
      WS,
      { viewId: 'tasks-gallery', name: 'Gallery', layout: ViewLayout.Gallery, parentViewId: 'tasks' },
      4000
    );

    expect(local('tasks')).toEqual(expect.objectContaining({ sessionOpenedAt: 3000, sessionCreatedAt: 4000 }));
    expect(local('tasks-board')).toBeUndefined();
    expect(local('tasks-gallery')).toBeUndefined();
  });

  it('lists a database created in a space, and leaves one created in a document to the outline', () => {
    refreshOutline();
    recordMentionViewCreated(WS, {
      viewId: 'new-db',
      name: 'Bugs',
      layout: ViewLayout.Board,
      parentViewId: 'space',
      databaseId: 'db-9',
    });
    recordMentionViewCreated(WS, {
      viewId: 'inline-db',
      name: 'Inline',
      layout: ViewLayout.Grid,
      parentViewId: 'spec',
      databaseId: 'db-8',
    });
    recordMentionViewCreated(WS, {
      viewId: 'orphan-db',
      name: 'Unknown',
      layout: ViewLayout.Grid,
      parentViewId: 'row-page-x',
    });

    expect(local('new-db')).toEqual(
      expect.objectContaining({ isDatabase: true, databaseId: 'db-9', navKey: 'database:db-9:-', source: 'session' })
    );
    expect(local('inline-db')).toBeUndefined();
    expect(local('orphan-db')).toBeUndefined();
  });

  it('does not list a creation inside a trashed or deleted page', () => {
    refreshOutline();
    recordMentionViewCreated(WS, { viewId: 'in-trash', name: 'A', layout: ViewLayout.Document, parentViewId: 'old' });
    recordMentionViewDeleted(WS, 'roadmap');
    recordMentionViewCreated(WS, {
      viewId: 'in-deleted',
      name: 'B',
      layout: ViewLayout.Document,
      parentViewId: 'roadmap',
    });

    expect(local('in-trash')).toBeUndefined();
    expect(local('in-deleted')).toBeUndefined();
  });

  it('shows a rename at once, until the outline catches up or moves past it', () => {
    refreshOutline();
    recordMentionViewRenamed(WS, 'roadmap', 'Roadmap 2026', 7000);

    expect(local('roadmap')).toEqual(expect.objectContaining({ name: 'Roadmap 2026', sessionRenamedAt: 7000 }));

    // The outline has not caught up yet.
    refreshOutline();
    expect(local('roadmap')?.name).toBe('Roadmap 2026');

    const caughtUp = fixtureOutline();

    caughtUp[0].children[0].name = 'Roadmap 2026';
    refreshOutline(caughtUp);
    expect(local('roadmap')).toEqual(expect.objectContaining({ name: 'Roadmap 2026', sessionRenamedAt: 7000 }));

    // Renamed again elsewhere: the outline wins from now on.
    const renamedElsewhere = fixtureOutline();

    renamedElsewhere[0].children[0].name = 'Roadmap 2027';
    refreshOutline(renamedElsewhere);
    expect(local('roadmap')?.name).toBe('Roadmap 2027');
  });

  it.each(READS)('lets an outline that moved past a pending rename win, %s', (_label, readBetween) => {
    refreshOutline();
    recordMentionViewRenamed(WS, 'roadmap', 'Mine');

    const renamedElsewhere = fixtureOutline();

    renamedElsewhere[0].children[0].name = 'Theirs';
    refreshOutline(renamedElsewhere);
    if (readBetween) expect(local('roadmap')?.name).toBe('Theirs');

    // An outline that shows the old name again does not bring the dropped rename back.
    refreshOutline();
    expect(local('roadmap')?.name).toBe('Roadmap');
  });

  it('shows a rename back to a name the outline already moved past', () => {
    refreshOutline();
    recordMentionViewRenamed(WS, 'roadmap', 'Mine');

    const renamedElsewhere = fixtureOutline();

    renamedElsewhere[0].children[0].name = 'Theirs';
    // No snapshot is read in between: the first rename was never shown as dropped.
    refreshOutline(renamedElsewhere);
    recordMentionViewRenamed(WS, 'roadmap', 'Mine', 9000);

    expect(local('roadmap')).toEqual(expect.objectContaining({ name: 'Mine', sessionRenamedAt: 9000 }));
  });

  it('keeps a creation renamed before the outline lists it under its new name', () => {
    refreshOutline();
    recordMentionViewCreated(WS, { viewId: 'draft', name: 'Draft', layout: ViewLayout.Document, parentViewId: 'space' });
    recordMentionViewRenamed(WS, 'draft', 'Final');
    expect(local('draft')?.name).toBe('Final');

    const stale = fixtureOutline();

    stale[0].children.push(view('draft', { name: 'Draft' }));
    refreshOutline(stale);
    expect(local('draft')).toEqual(expect.objectContaining({ name: 'Final', source: 'outline' }));

    const caughtUp = fixtureOutline();

    caughtUp[0].children.push(view('draft', { name: 'Final' }));
    refreshOutline(caughtUp);
    expect(local('draft')?.name).toBe('Final');
  });

  it.each(READS)(
    'keeps a newer rename while the outline shows a name this tab sent before it, %s',
    (_label, readBetween) => {
      const step = stepper(readBetween);

      refreshOutline();
      recordMentionViewRenamed(WS, 'roadmap', 'B', 1000);
      step();
      recordMentionViewRenamed(WS, 'roadmap', 'C', 2000);
      step();
      // The outline shows the first rename before the second.
      refreshOutline(outlineNamed('B'));
      expect(local('roadmap')).toEqual(expect.objectContaining({ name: 'C', sessionRenamedAt: 2000 }));

      refreshOutline(outlineNamed('C'));
      expect(local('roadmap')?.name).toBe('C');
      // Caught up: a later rename elsewhere wins.
      refreshOutline(outlineNamed('D'));
      expect(local('roadmap')?.name).toBe('D');
    }
  );

  it('keeps a rename back to the outline’s name while the outline shows the name in between', () => {
    refreshOutline();
    recordMentionViewRenamed(WS, 'roadmap', 'B');
    recordMentionViewRenamed(WS, 'roadmap', 'Roadmap');
    refreshOutline(outlineNamed('B'));
    expect(local('roadmap')?.name).toBe('Roadmap');

    refreshOutline();
    expect(local('roadmap')?.name).toBe('Roadmap');
    refreshOutline(outlineNamed('Theirs'));
    expect(local('roadmap')?.name).toBe('Theirs');
  });

  it('keeps the latest name of a creation renamed twice before the outline lists it', () => {
    const listed = (name: string) => {
      const outline = fixtureOutline();

      outline[0].children.push(view('draft', { name }));
      return outline;
    };

    refreshOutline();
    recordMentionViewCreated(WS, { viewId: 'draft', name: 'Draft', layout: ViewLayout.Document, parentViewId: 'space' });
    recordMentionViewRenamed(WS, 'draft', 'Final');
    recordMentionViewRenamed(WS, 'draft', 'Final 2');
    refreshOutline(listed('Draft'));
    expect(local('draft')?.name).toBe('Final 2');
    refreshOutline(listed('Final'));
    expect(local('draft')?.name).toBe('Final 2');
    refreshOutline(listed('Final 2'));
    refreshOutline(listed('Theirs'));
    expect(local('draft')?.name).toBe('Theirs');
  });

  it('lets the outline name a creation it lists, when nothing renamed it', () => {
    refreshOutline();
    recordMentionViewCreated(WS, { viewId: 'blank', name: '', layout: ViewLayout.Document, parentViewId: 'space' });

    const outline = fixtureOutline();

    outline[0].children.push(view('blank', { name: 'Untitled' }));
    refreshOutline(outline);
    expect(local('blank')?.name).toBe('Untitled');
  });

  it('records nothing for a rename to the name already shown', () => {
    refreshOutline();

    const before = getMentionLocalSnapshot(WS);

    recordMentionViewRenamed(WS, 'roadmap', 'Roadmap');
    expect(getMentionLocalSnapshot(WS)).toBe(before);
    expect(local('roadmap')?.sessionRenamedAt).toBeUndefined();
  });

  it('hides a page this tab deleted, with its subtree, while the outline still lists it', () => {
    refreshOutline();
    recordMentionViewDeleted(WS, 'roadmap');

    expect(local('roadmap')).toBeUndefined();
    expect(local('notes')).toBeUndefined();

    recordMentionViewRestored(WS, 'roadmap');
    expect(local('roadmap')).toBeDefined();
    expect(local('notes')).toBeDefined();
  });

  it('restores every deleted page when the whole trash is restored', () => {
    refreshOutline();
    recordMentionViewDeleted(WS, 'roadmap');
    recordMentionViewDeleted(WS, 'spec');
    recordMentionViewRestored(WS);

    expect(local('roadmap')).toBeDefined();
    expect(local('spec')).toBeDefined();
  });

  it('leaves a deletion to the trash list once it shows it, so a restore elsewhere shows the page', () => {
    refreshOutline();
    recordMentionViewDeleted(WS, 'roadmap');
    refreshOutline(fixtureOutline(), { trash: [...TRASH, view('roadmap')] });
    expect(local('roadmap')).toBeUndefined();

    // Restored in another tab: the trash list and the outline say so.
    refreshOutline(fixtureOutline(), { trash: TRASH });
    expect(local('roadmap')).toBeDefined();
  });

  it.each(READS)(
    'shows a page this tab deleted again when restored elsewhere, after the outline dropped it first, %s',
    (_label, readBetween) => {
      const step = stepper(readBetween);

      refreshOutline();
      step();
      recordMentionViewDeleted(WS, 'roadmap');
      step();
      // The usual order: the outline drops the page before the trash list shows it.
      refreshOutline(outlineWithoutRoadmap());
      step();
      refreshOutline(outlineWithoutRoadmap(), { trash: [...TRASH, view('roadmap')] });
      step();
      // Restored in another tab: the outline lists it again, the trash list no longer does.
      refreshOutline();

      expect(listedOf(['roadmap', 'notes'])).toEqual(['roadmap', 'notes']);
    }
  );

  it('lets a restore elsewhere show a page the trash list showed before this tab recorded its deletion', () => {
    // The outline and trash refreshes both came in before the move to the trash resolved.
    refreshOutline(outlineWithoutRoadmap(), { trash: [...TRASH, view('roadmap')] });
    recordMentionViewDeleted(WS, 'roadmap');
    refreshOutline();

    expect(listedOf(['roadmap', 'notes'])).toEqual(['roadmap', 'notes']);
  });

  it('hides what lies below a page this tab deleted in every lane, until a restore elsewhere', () => {
    const recent = [
      // In the outline, two levels below the page.
      view('detail', { parent_view_id: 'notes', last_viewed_at: '2026-11-09T10:00:00Z' }),
      // Beyond the outline's depth, below the page too.
      view('deep', { parent_view_id: 'detail', last_viewed_at: '2026-11-09T11:00:00Z' }),
    ];
    const below = ['notes', 'detail', 'deep', 'new-note'];

    refreshOutline(outlineWithDetail(), { trash: TRASH, recent });
    recordMentionViewCreated(WS, {
      viewId: 'new-note',
      name: 'New',
      layout: ViewLayout.Document,
      parentViewId: 'notes',
    });
    expect(listedOf(below)).toEqual(below);

    recordMentionViewDeleted(WS, 'roadmap');
    expect(listedOf(['roadmap', ...below])).toEqual([]);

    // The outline drops the subtree, then the trash list shows the page; the recent views are stale.
    refreshOutline(outlineWithoutRoadmap(), { trash: TRASH, recent });
    expect(listedOf(['roadmap', ...below])).toEqual([]);
    refreshOutline(outlineWithoutRoadmap(), { trash: [...TRASH, view('roadmap')], recent });
    expect(listedOf(['roadmap', ...below])).toEqual([]);

    // Restored in another tab: the outline places the subtree again.
    refreshOutline(outlineWithDetail(), { trash: TRASH, recent });
    expect(listedOf(['roadmap', ...below])).toEqual(['roadmap', ...below]);
  });

  it.each([
    ['this tab moved it to the trash', true],
    ['it was moved to the trash elsewhere', false],
  ])('keeps a page deleted for good and what lay below it hidden, when %s', (_label, deletedHere) => {
    const recent = [
      view('roadmap', { name: 'Roadmap', parent_view_id: 'space', last_viewed_at: '2026-11-09T09:00:00Z' }),
      view('notes', { name: 'Notes', parent_view_id: 'roadmap', last_viewed_at: '2026-11-09T09:30:00Z' }),
      view('detail', { parent_view_id: 'notes', last_viewed_at: '2026-11-09T10:00:00Z' }),
    ];
    const withoutRoadmap = outlineWithoutRoadmap();

    refreshOutline(outlineWithDetail(), { trash: TRASH, recent });
    if (deletedHere) recordMentionViewDeleted(WS, 'roadmap');
    refreshOutline(withoutRoadmap, { trash: [...TRASH, view('roadmap')], recent });
    expect(listedOf(['roadmap', 'notes', 'detail'])).toEqual([]);

    // Deleted for good (the Trash page deletes it, then reloads the trash list): only the trash list
    // changes, and the recent views are stale.
    refreshOutline(withoutRoadmap, { trash: TRASH, recent });
    expect(listedOf(['roadmap', 'notes', 'detail'])).toEqual([]);

    // Later outline refreshes do not list it either.
    refreshOutline(outlineWithoutRoadmap(), { trash: TRASH, recent });
    expect(listedOf(['roadmap', 'notes', 'detail'])).toEqual([]);
  });

  it('lists a page that left the trash list again once the outline lists it, and keeps it listed after', () => {
    const recent = [
      view('roadmap', { name: 'Roadmap', parent_view_id: 'space' }),
      view('notes', { name: 'Notes', parent_view_id: 'roadmap' }),
    ];

    refreshOutline(outlineWithoutRoadmap(), { trash: [...TRASH, view('roadmap')], recent });
    // Restored elsewhere: the trash list drops it before the outline lists it again.
    refreshOutline(outlineWithoutRoadmap(), { trash: TRASH, recent });
    expect(listedOf(['roadmap', 'notes'])).toEqual([]);

    refreshOutline(fixtureOutline(), { trash: TRASH, recent });
    expect(listedOf(['roadmap', 'notes'])).toEqual(['roadmap', 'notes']);

    // An outline that no longer holds it (a lazily loaded subtree dropped) leaves it to the recent views.
    refreshOutline(outlineWithoutRoadmap(), { trash: TRASH, recent });
    expect(local('roadmap')?.source).toBe('recent');
    expect(listedOf(['roadmap', 'notes'])).toEqual(['roadmap', 'notes']);
  });

  const RESTORES: [string, boolean, string | undefined][] = [
    ['before the trash list drops it', true, 'roadmap'],
    ['after the trash list dropped it', false, 'roadmap'],
    ['with the whole trash, before the trash list drops it', true, undefined],
  ];

  it.each(RESTORES)('lists a page this tab restored %s, while the outline does not list it yet', (_label, first, id) => {
    const recent = [
      view('roadmap', { name: 'Roadmap', parent_view_id: 'space' }),
      view('notes', { name: 'Notes', parent_view_id: 'roadmap' }),
      view('purged', { name: 'Purged', parent_view_id: 'space' }),
    ];
    const withoutRoadmap = outlineWithoutRoadmap();

    refreshOutline(withoutRoadmap, { trash: [...TRASH, view('purged'), view('roadmap')], recent });
    // Deleted for good before the restore: restoring the whole trash does not bring it back.
    refreshOutline(withoutRoadmap, { trash: [...TRASH, view('roadmap')], recent });
    if (first) recordMentionViewRestored(WS, id);
    refreshOutline(withoutRoadmap, { trash: id === undefined ? [] : TRASH, recent });
    if (!first) recordMentionViewRestored(WS, id);

    expect(listedOf(['roadmap', 'notes', 'purged'])).toEqual(['roadmap', 'notes']);
  });

  it('lists a page that left the trash list again once fresh recent views list it or a page below it', () => {
    const stale = [
      view('roadmap', { name: 'Roadmap', parent_view_id: 'space' }),
      view('notes', { name: 'Notes', parent_view_id: 'roadmap' }),
    ];
    const withoutRoadmap = outlineWithoutRoadmap();

    refreshOutline(fixtureOutline(), { trash: TRASH, recent: stale });
    // Created below the page in this tab; the outline never lists it.
    recordMentionViewCreated(WS, {
      viewId: 'draft',
      name: 'Draft',
      layout: ViewLayout.Document,
      parentViewId: 'roadmap',
    });
    refreshOutline(withoutRoadmap, { trash: [...TRASH, view('roadmap')], recent: stale });
    refreshOutline(withoutRoadmap, { trash: TRASH, recent: stale });
    expect(listedOf(['roadmap', 'notes', 'draft'])).toEqual([]);

    // Reloaded recent views that list neither the page nor a page below it say nothing about it.
    refreshOutline(withoutRoadmap, { trash: TRASH, recent: [view('deep', { parent_view_id: 'beyond-depth' })] });
    expect(listedOf(['roadmap', 'draft', 'deep'])).toEqual(['deep']);

    // The server leaves views in or below the trash out of the recent views: one listed below the
    // page vouches for it.
    refreshOutline(withoutRoadmap, {
      trash: TRASH,
      recent: [view('notes', { name: 'Notes', parent_view_id: 'roadmap' })],
    });
    expect(listedOf(['roadmap', 'notes', 'draft'])).toEqual(['notes', 'draft']);

    refreshOutline(withoutRoadmap, { trash: TRASH, recent: [...stale] });
    expect(listedOf(['roadmap', 'notes', 'draft'])).toEqual(['roadmap', 'notes', 'draft']);
  });

  it('hides a recent view below a page trashed elsewhere when the recent views lead to it', () => {
    refreshOutline(outlineWithoutRoadmap(), {
      trash: [...TRASH, view('roadmap')],
      recent: [
        view('notes', { parent_view_id: 'roadmap' }),
        view('detail', { parent_view_id: 'notes' }),
        view('deep', { name: 'Deep page', parent_view_id: 'beyond-depth' }),
      ],
    });
    recordMentionViewCreated(WS, {
      viewId: 'new-detail',
      name: 'New',
      layout: ViewLayout.Document,
      parentViewId: 'detail',
    });

    expect(listedOf(['notes', 'detail', 'new-detail', 'deep'])).toEqual(['deep']);
  });

  it('builds the same candidates whether or not snapshots are read between writes', () => {
    const renamed = (name: string, extraPages: View[] = [], removed: string[] = []) => {
      const outline = fixtureOutline();

      outline[0].children[0].name = name;
      outline[0].children.push(...extraPages);
      outline[0].children = outline[0].children.filter((item) => !removed.includes(item.view_id));
      return outline;
    };
    const zebra = view('zebra', { name: 'Zebra plan', parent_view_id: 'space' });
    const steps = [
      () => refreshOutline(),
      () =>
        recordMentionViewCreated(
          WS,
          { viewId: 'zebra', name: 'Zebra plan', layout: ViewLayout.Document, parentViewId: 'space' },
          1000
        ),
      () => recordMentionViewRenamed(WS, 'roadmap', 'Mine', 2000),
      () => recordMentionViewDeleted(WS, 'spec'),
      () => recordMentionViewOpened(WS, 'overview', 3000),
      () => refreshOutline(renamed('Theirs', [zebra])),
      () => refreshOutline(renamed('Roadmap', [zebra], ['spec'])),
      () => refreshOutline(renamed('Roadmap', [zebra], ['spec']), { trash: [...TRASH, view('spec')] }),
      () => refreshOutline(renamed('Roadmap'), { trash: [...TRASH, view('zebra')] }),
      () => refreshOutline(renamed('Roadmap')),
    ];
    const run = (readBetween: boolean) => {
      clearMentionLocalIndex();
      steps.forEach((step) => {
        step();
        if (readBetween) getMentionLocalSnapshot(WS);
      });
      return getMentionLocalSnapshot(WS).views;
    };
    const unread = run(false);

    expect(run(true)).toEqual(unread);
    expect(unread.find((item) => item.viewId === 'roadmap')?.name).toBe('Roadmap');
    expect(unread.map((item) => item.viewId)).toEqual(expect.arrayContaining(['spec', 'overview']));
    expect(unread.map((item) => item.viewId)).not.toContain('zebra');
  });

  it('drops the least recently touched session entries beyond the limit', () => {
    const pages = Array.from({ length: MENTION_LOCAL_SESSION_LIMIT + 10 }, (_, index) => view(`page-${index}`));

    setMentionIndexSources(WS, { outline: pages });
    pages.forEach((page, index) => recordMentionViewOpened(WS, page.view_id, index + 1));

    expect(local('page-0')?.sessionOpenedAt).toBeUndefined();
    expect(local('page-9')?.sessionOpenedAt).toBeUndefined();
    expect(local('page-10')?.sessionOpenedAt).toBe(11);
    expect(local(`page-${MENTION_LOCAL_SESSION_LIMIT + 9}`)?.sessionOpenedAt).toBe(MENTION_LOCAL_SESSION_LIMIT + 10);
  });
});

describe('mentionLocalIndex lifecycle', () => {
  it('answers an unknown workspace with the frozen empty snapshot and ignores its writes', () => {
    recordMentionViewCreated(OTHER_WS, { viewId: 'early', name: 'Early', layout: ViewLayout.Document });

    expect(getMentionLocalSnapshot(OTHER_WS)).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    expect(getMentionLocalSnapshot(undefined)).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    expect(Object.isFrozen(EMPTY_MENTION_LOCAL_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(EMPTY_MENTION_LOCAL_SNAPSHOT.views)).toBe(true);
    expect(EMPTY_MENTION_LOCAL_SNAPSHOT).toEqual(expect.objectContaining({ version: 0, views: [], people: [] }));

    setMentionIndexSources(OTHER_WS, { outline: [] });
    expect(getMentionLocalSnapshot(OTHER_WS).views).toEqual([]);
  });

  it('empties a workspace the app leaves, and leaves the others', () => {
    refreshOutline();
    recordMentionViewOpened(WS, 'roadmap', 1);
    setMentionIndexSources(OTHER_WS, { outline: [view('other-page')] });

    clearMentionLocalIndex(WS);

    expect(getMentionLocalSnapshot(WS)).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    expect(ids(getMentionLocalSnapshot(OTHER_WS))).toEqual(['other-page']);

    // Back in the workspace: its sources return, the forgotten session does not.
    refreshOutline();
    expect(local('roadmap')?.sessionOpenedAt).toBeUndefined();
  });

  it('empties everything when the session ends', () => {
    refreshOutline();
    setMentionIndexSources(OTHER_WS, { outline: [view('other-page')] });
    recordMentionRoster(WS, [person('ada')]);

    emit(EventType.SESSION_INVALID);

    expect(getMentionLocalSnapshot(WS)).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    expect(getMentionLocalSnapshot(OTHER_WS)).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    refreshOutline();
    expect(getMentionLocalSnapshot(WS).people).toEqual([]);
  });

  it('returns the same snapshot until something changes, and a larger version after', () => {
    refreshOutline();

    const first = getMentionLocalSnapshot(WS);

    expect(getMentionLocalSnapshot(WS)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);

    refreshOutline();

    const refreshed = getMentionLocalSnapshot(WS);

    expect(refreshed).not.toBe(first);
    expect(refreshed.version).toBeGreaterThan(first.version);

    recordMentionViewOpened(WS, 'roadmap');
    expect(getMentionLocalSnapshot(WS).version).toBeGreaterThan(refreshed.version);
  });

  it('ignores sources it already has', () => {
    const outline = fixtureOutline();
    const listener = jest.fn();

    setMentionIndexSources(WS, { outline, trash: TRASH });

    const first = getMentionLocalSnapshot(WS);
    const unsubscribe = subscribeMentionLocalIndex(listener);

    setMentionIndexSources(WS, { outline, trash: TRASH });
    expect(getMentionLocalSnapshot(WS)).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('adds the roster without rebuilding the views, and keeps it across a workspace switch', () => {
    const roster = [person('ada'), person('grace')];

    recordMentionRoster(WS, roster);
    refreshOutline();

    const withPeople = getMentionLocalSnapshot(WS);

    expect(withPeople.people).toBe(roster);

    const nextRoster = [person('ada')];

    recordMentionRoster(WS, nextRoster);

    const afterRoster = getMentionLocalSnapshot(WS);

    expect(afterRoster).not.toBe(withPeople);
    expect(afterRoster.people).toBe(nextRoster);
    expect(afterRoster.views).toBe(withPeople.views);
    expect(afterRoster.viewsById).toBe(withPeople.viewsById);

    clearMentionLocalIndex(WS);
    expect(getMentionLocalSnapshot(WS).people).toEqual([]);
    refreshOutline();
    expect(getMentionLocalSnapshot(WS).people).toBe(nextRoster);
  });

  it('notifies subscribers of changes only', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeMentionLocalIndex(listener);

    refreshOutline();
    expect(listener).toHaveBeenCalledTimes(1);

    recordMentionViewOpened(WS, 'roadmap', 10);
    recordMentionViewOpened(WS, 'roadmap', 5);
    recordMentionViewDeleted(WS, 'spec');
    recordMentionViewDeleted(WS, 'spec');
    recordMentionViewRestored(WS, 'roadmap');
    recordMentionViewRenamed(WS, 'roadmap', 'Roadmap');
    expect(listener).toHaveBeenCalledTimes(3);

    recordMentionViewCreated(OTHER_WS, { viewId: 'x', name: 'X', layout: ViewLayout.Document });
    recordMentionRoster(OTHER_WS, [person('ada')]);
    clearMentionLocalIndex(OTHER_WS);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    recordMentionViewOpened(WS, 'notes', 20);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('mentionLocalIndex performance', () => {
  const LARGE_OUTLINE_VIEWS = 5000;

  /**
   * 5,000 views, six levels below a space, breadth first. Every tenth is a database container with
   * two views, every tenth from the fifth a board, every tenth from the seventh a row page; the
   * rest are documents with server times.
   */
  function largeOutline(serial: number): View[] {
    const space = view(`space-${serial}`, { is_space: true });
    let total = 1;
    let level = [space];

    for (let depth = 1; depth <= 6 && total < LARGE_OUTLINE_VIEWS; depth += 1) {
      const next: View[] = [];

      for (const parent of level) {
        for (let index = 0; index < (depth === 1 ? 10 : 5) && total < LARGE_OUTLINE_VIEWS; index += 1) {
          total += 1;

          const viewId = `v-${serial}-${total}`;
          const fields: Partial<View> = {
            name: `Page ${total}`,
            parent_view_id: parent.view_id,
            created_at: '2026-10-01T08:00:00Z',
            last_edited_time: '2026-11-01T08:00:00Z',
          };
          let child: View;

          if (total % 10 === 0) {
            const databaseId = `db-${viewId}`;

            child = view(viewId, {
              ...fields,
              layout: ViewLayout.Grid,
              extra: extra({ is_database_container: true, database_id: databaseId }),
              children: [`${viewId}-grid`, `${viewId}-board`].map((tabId) =>
                view(tabId, { layout: ViewLayout.Grid, extra: extra({ database_id: databaseId }) })
              ),
            });
            total += 2;
          } else if (total % 10 === 5) {
            child = view(viewId, { ...fields, layout: ViewLayout.Board, extra: extra({ database_id: `db-${viewId}` }) });
          } else if (total % 10 === 7) {
            child = view(viewId, { ...fields, extra: extra({ row_document: { source: { row_id: viewId } } }) });
          } else {
            child = view(viewId, fields);
            next.push(child);
          }

          parent.children.push(child);
        }
      }

      level = next;
    }

    return [space];
  }

  function countViews(outline: View[]): number {
    return outline.reduce((count, item) => count + 1 + countViews(item.children), 0);
  }

  /** Everything but the space, the row pages and the databases' own views. */
  function countCandidates(outline: View[]): number {
    return outline.reduce((count, item) => {
      const own = item.is_space || item.extra?.row_document ? 0 : 1;
      const below = item.layout === ViewLayout.Document ? countCandidates(item.children) : 0;

      return count + own + below;
    }, 0);
  }

  it('builds a 5,000-view snapshot in a few milliseconds and reads it again for free', () => {
    const outlines = Array.from({ length: 9 }, (_, serial) => largeOutline(serial));

    expect(countViews(outlines[0])).toBeGreaterThanOrEqual(LARGE_OUTLINE_VIEWS);

    const durations = outlines.map((outline) => {
      setMentionIndexSources(WS, { outline });

      const startedAt = performance.now();

      getMentionLocalSnapshot(WS);
      return performance.now() - startedAt;
    });
    const median = [...durations].sort((left, right) => left - right)[Math.floor(durations.length / 2)];

    if (process.env.MENTION_INDEX_PERF_LOG) {
      console.info(`mention index build: median ${median.toFixed(2)} ms of ${durations.map((ms) => ms.toFixed(2))}`);
    }

    // The plan's budget is 10 ms; the bound is looser for loaded CI machines.
    expect(median).toBeLessThan(50);

    const built = getMentionLocalSnapshot(WS);
    const startedAt = performance.now();

    for (let read = 0; read < 1000; read += 1) getMentionLocalSnapshot(WS);
    expect(getMentionLocalSnapshot(WS)).toBe(built);
    expect(performance.now() - startedAt).toBeLessThan(20);
    expect(built.views).toHaveLength(countCandidates(outlines[outlines.length - 1]));
  });

  it('settles a waiting rename and a view gone from the trash against a new 5,000-view outline quickly', () => {
    const outlines = Array.from({ length: 10 }, (_, serial) => largeOutline(serial));
    const trash: View[] = [];

    setMentionIndexSources(WS, { outline: outlines[0], trash: [view('purged')] });
    setMentionIndexSources(WS, { outline: outlines[0], trash });
    // No later outline lists either view, so every change walks all of it, once for both.
    recordMentionViewRenamed(WS, 'v-0-2', 'Renamed', 1);

    const durations = outlines.slice(1).map((outline) => {
      const startedAt = performance.now();

      setMentionIndexSources(WS, { outline, trash });
      return performance.now() - startedAt;
    });
    const median = [...durations].sort((left, right) => left - right)[Math.floor(durations.length / 2)];

    if (process.env.MENTION_INDEX_PERF_LOG) {
      console.info(`mention index settle: median ${median.toFixed(2)} ms of ${durations.map((ms) => ms.toFixed(2))}`);
    }

    expect(median).toBeLessThan(20);
  });
});
