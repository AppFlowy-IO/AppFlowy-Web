import { describe, expect, it } from '@jest/globals';

import en from '@/@types/translations/en.json';
import {
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
} from '@/application/types';

import {
  buildMentionSearchCacheKey,
  buildMentionSearchCacheScopeKey,
  buildMentionSearchRequests,
  buildMentionSearchRequestsCacheKey,
  flattenMentionSearchSections,
  foldMentionSectionsIntoPages,
  getMentionSearchResultDisplayTitle,
  hasFailedMentionSection,
  isCacheableMentionResponse,
  isCompleteMentionResponse,
  isDatabaseRowOnlyMentionRequest,
  isSupersededMentionResponse,
  layoutMentionSectionsForPicker,
  MENTION_SECTION_COLLAPSE_LIMIT,
  mentionItemNavKey,
  MentionPanelSearchResult,
  mentionSearchItemToMention,
  mentionSectionCollapses,
  mentionSectionTitle,
  mergeMentionSearchResponses,
  reconcileMentionOptionSelection,
  separateMentionSections,
  shouldRetryMentionRowsResponse,
} from '../mentionUtils';

function person(id: string, name = id): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: id,
    title: name,
    mention: { type: MentionTargetKind.Person, person_id: id, person_name: name, page_id: 'page' },
  };
}

function page(id: string, title = id): MentionSearchResultItem {
  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

// As Search builds it: object_id is the database id, and the view travels beside it.
function database(databaseId: string, viewId?: string, title = databaseId): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Database,
    object_id: databaseId,
    title,
    database_id: databaseId,
    database_view_id: viewId,
    mention: { type: MentionTargetKind.Database, database_id: databaseId, database_view_id: viewId },
  };
}

function row(databaseId: string, rowId: string, viewId?: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.DatabaseRow,
    object_id: rowId,
    title: rowId,
    database_id: databaseId,
    database_view_id: viewId,
    database_row_id: rowId,
    mention: { type: 'databaseRow', database_id: databaseId, database_view_id: viewId, row_id: rowId },
  };
}

// Server quick picks carry no object id, and "Reminder 1 week" gets a new time on every request.
function quickPick(kind: MentionTargetKind.Date | MentionTargetKind.Reminder, title: string, date: string) {
  const item: MentionSearchResultItem = {
    kind,
    title,
    subtitle: date,
    mention: { type: MentionTargetKind.Date, date, include_time: kind === MentionTargetKind.Reminder },
  };

  return item;
}

function link(text: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.ExternalLink,
    title: text,
    subtitle: `https://${text}`,
    mention: { type: MentionType.externalLink, url: `https://${text}` },
  };
}

function sectionOf(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, has_more: false, status: 'ready', items };
}

function resultsByKey(sections: MentionSearchSection[]) {
  return new Map<string, MentionPanelSearchResult>(
    flattenMentionSearchSections(sections).map((result) => [result.key, result])
  );
}

describe('mention option keys', () => {
  it('derives navKeys from the identity each payload carries', () => {
    expect(mentionItemNavKey(person('ada', 'Ada'))).toBe('person:ada');
    expect(mentionItemNavKey(page('page-1', 'Roadmap'))).toBe('page:page-1');
    expect(mentionItemNavKey(database('db-1', 'grid-1'))).toBe('database:db-1:grid-1');
    expect(mentionItemNavKey(database('db-1'))).toBe('database:db-1:-');
    expect(mentionItemNavKey(row('db-1', 'row-1', 'grid-1'))).toBe('row:db-1:row-1');
    expect(mentionItemNavKey(link('road.example'))).toBe('link:https://road.example');
    expect(mentionItemNavKey(quickPick(MentionTargetKind.Date, 'Today', '2026-11-09T00:00:00+08:00'))).toBe(
      'date:Today'
    );
    expect(
      mentionItemNavKey(quickPick(MentionTargetKind.Reminder, 'Reminder 1 week', '2026-11-16T10:00:00+08:00'))
    ).toBe('reminder:Reminder 1 week');
  });

  it('falls back to item fields when a payload lacks its id', () => {
    const pageWithoutPayloadId = { ...page('page-1'), mention: { type: MentionTargetKind.Page } };
    const emptyIdDatabase: MentionSearchResultItem = {
      kind: MentionTargetKind.Database,
      object_id: 'grid-1',
      title: 'Roadmap DB',
      database_id: '',
      database_view_id: 'grid-1',
      mention: { type: MentionTargetKind.Database, database_id: '' },
    };

    expect(mentionItemNavKey(pageWithoutPayloadId as unknown as MentionSearchResultItem)).toBe('page:page-1');
    expect(mentionItemNavKey(emptyIdDatabase)).toBe('database:grid-1:grid-1');
  });

  it('keeps quick-pick keys stable when the server recomputes their time', () => {
    const first = quickPick(MentionTargetKind.Reminder, 'Reminder 1 week', '2026-11-16T10:00:00.120+08:00');
    const refreshed = quickPick(MentionTargetKind.Reminder, 'Reminder 1 week', '2026-11-16T10:00:03.480+08:00');

    expect(mentionItemNavKey(refreshed)).toBe(mentionItemNavKey(first));
  });

  it('keeps every key when an item or a section is inserted anywhere around it', () => {
    const seed = [
      sectionOf(MentionSearchSectionKind.People, [person('ada'), person('bob')]),
      sectionOf(MentionSearchSectionKind.Pages, [page('a'), database('db', 'grid'), row('db', 'r1')]),
      sectionOf(MentionSearchSectionKind.Dates, [quickPick(MentionTargetKind.Date, 'Today', '2026-11-09')]),
      sectionOf(MentionSearchSectionKind.Links, [link('road.example')]),
    ];
    const baseline = resultsByKey(seed);
    const variants: MentionSearchSection[][] = [];

    seed.forEach((section, sectionIndex) => {
      for (let at = 0; at <= section.items.length; at += 1) {
        const inserted = page(`new-${sectionIndex}-${at}`);

        variants.push(
          seed.map((candidate, index) =>
            index === sectionIndex
              ? { ...candidate, items: [...candidate.items.slice(0, at), inserted, ...candidate.items.slice(at)] }
              : candidate
          )
        );
      }
    });
    for (let at = 0; at <= seed.length; at += 1) {
      variants.push([
        ...seed.slice(0, at),
        sectionOf(MentionSearchSectionKind.Suggested, [page('fresh')]),
        ...seed.slice(at),
      ]);
    }

    expect(baseline.size).toBe(7);
    variants.forEach((variant) => {
      const results = resultsByKey(variant);

      baseline.forEach((result, key) => {
        expect(results.get(key)?.item).toBe(result.item);
      });
    });
  });

  it('keeps a folded-in database key when typed rows merge into Pages ahead of it', () => {
    const primary = {
      sections: [
        sectionOf(MentionSearchSectionKind.Pages, [page('a')]),
        sectionOf(MentionSearchSectionKind.Databases, [database('dbX', 'grid')]),
      ],
    };
    // Search returns typed rows inside the Pages section.
    const rows = { sections: [sectionOf(MentionSearchSectionKind.Pages, [row('dbY', 'r1'), row('dbY', 'r2')])] };
    const keysOf = (sections: MentionSearchSection[]) =>
      flattenMentionSearchSections(foldMentionSectionsIntoPages(sections, 'Pages')).map((result) => result.key);

    const before = keysOf(mergeMentionSearchResponses([primary]).sections);
    const after = keysOf(mergeMentionSearchResponses([primary, rows]).sections);

    expect(before).toEqual(['pages|page:a', 'pages|database:dbX:grid']);
    expect(after).toEqual(['pages|page:a', 'pages|row:dbY:r1', 'pages|row:dbY:r2', 'pages|database:dbX:grid']);
  });

  it('suffixes only real duplicates within one section', () => {
    const results = flattenMentionSearchSections([
      sectionOf(MentionSearchSectionKind.Suggested, [person('ada')]),
      sectionOf(MentionSearchSectionKind.People, [person('ada'), person('bob')]),
      sectionOf(MentionSearchSectionKind.Pages, [page('a'), page('a'), database('db', 'grid'), database('db', 'board')]),
    ]);

    expect(results.map((result) => result.key)).toEqual([
      'suggested|person:ada',
      'people|person:ada',
      'people|person:bob',
      'pages|page:a',
      'pages|page:a#2',
      'pages|database:db:grid',
      'pages|database:db:board',
    ]);
    expect(results.map((result) => result.navKey)).toEqual([
      'person:ada',
      'person:ada',
      'person:bob',
      'page:a',
      'page:a',
      'database:db:grid',
      'database:db:board',
    ]);
  });

  it('does not count an item the picker cannot insert as an occurrence', () => {
    // Without a database id in its payload the row cannot become a mention, so it is skipped.
    const unresolvableRow = { ...row('db', 'r1'), mention: { type: 'databaseRow', row_id: 'r1' } };
    const results = flattenMentionSearchSections([
      sectionOf(MentionSearchSectionKind.Pages, [
        unresolvableRow as unknown as MentionSearchResultItem,
        row('db', 'r1'),
      ]),
    ]);

    expect(results.map((result) => result.key)).toEqual(['pages|row:db:r1']);
  });
});

describe('reconcileMentionOptionSelection', () => {
  const options = [
    { key: 'people|person:bob', navKey: 'person:bob' },
    { key: 'people|person:ada', navKey: 'person:ada' },
    { key: 'pages|more' },
  ];

  it('keeps the same selection while its option is listed', () => {
    const selection = { key: 'people|person:ada', navKey: 'person:ada' };

    expect(reconcileMentionOptionSelection(selection, options)).toBe(selection);
    expect(reconcileMentionOptionSelection(null, options)).toBeNull();
  });

  it('follows the same object into another section', () => {
    expect(reconcileMentionOptionSelection({ key: 'suggested|person:ada', navKey: 'person:ada' }, options)).toEqual({
      key: 'people|person:ada',
      navKey: 'person:ada',
    });
  });

  it('falls back to the first option when the object is gone', () => {
    expect(
      reconcileMentionOptionSelection({ key: 'pages|database:db:grid', navKey: 'database:db:grid' }, options)
    ).toEqual({ key: 'people|person:bob', navKey: 'person:bob' });
    expect(reconcileMentionOptionSelection({ key: 'pages|more' }, options.slice(0, 1))).toEqual({
      key: 'people|person:bob',
      navKey: 'person:bob',
    });
  });

  it('clears the selection when no option is left', () => {
    expect(reconcileMentionOptionSelection({ key: 'people|person:ada', navKey: 'person:ada' }, [])).toBeNull();
  });

  // A database this tab just created is keyed without its view until the outline lists it; the
  // local lane merges it with the server's item for that database, which names a view.
  it('follows a database whose view was unknown to the first option naming a view of it, and back', () => {
    const map = { key: 'pages|page:map', navKey: 'page:map' };
    const grid = { key: 'pages|database:db:grid', navKey: 'database:db:grid' };
    const board = { key: 'pages|database:db:board', navKey: 'database:db:board' };
    const local = { key: 'pages|database:db:-', navKey: 'database:db:-' };

    expect(reconcileMentionOptionSelection(local, [map, grid, board])).toEqual(grid);
    expect(reconcileMentionOptionSelection(grid, [map, local])).toEqual(local);
    // Two known views of a database are two objects, and another database is another object.
    expect(reconcileMentionOptionSelection(grid, [map, board])).toEqual(map);
    expect(
      reconcileMentionOptionSelection(local, [map, { key: 'pages|database:other:grid', navKey: 'database:other:grid' }])
    ).toEqual(map);
    expect(
      reconcileMentionOptionSelection({ key: 'pages|database:-:-', navKey: 'database:-:-' }, [
        map,
        { key: 'pages|database:-:grid', navKey: 'database:-:grid' },
      ])
    ).toEqual(map);
  });
});

describe('mention panel API mapping', () => {
  it('maps database row search items to editor mention marks with display data', () => {
    const mention = mentionSearchItemToMention({
      kind: MentionTargetKind.DatabaseRow,
      object_id: 'row-1',
      title: 'Row title',
      subtitle: 'Database name',
      database_id: 'database-1',
      database_view_id: 'view-1',
      database_row_id: 'row-1',
      row_document_id: 'row-document-1',
      can_access_context: true,
      mention: {
        type: 'databaseRow',
        database_id: 'database-1',
        database_view_id: 'view-1',
        row_id: 'row-1',
        row_document_id: 'row-document-1',
      },
    });

    expect(mention).toEqual({
      type: MentionType.PageRef,
      page_id: 'view-1',
      block_id: 'row-1',
      database_id: 'database-1',
      database_view_id: 'view-1',
      row_id: 'row-1',
      database_row_id: 'row-1',
      row_document_id: 'row-document-1',
      data: {
        title: 'Row title',
        subtitle: 'Database name',
        icon: undefined,
      },
    });
  });

  it('leaves database row page id unresolved when database view id is missing', () => {
    const mention = mentionSearchItemToMention({
      kind: MentionTargetKind.DatabaseRow,
      object_id: 'row-1',
      title: 'Row title',
      database_id: 'database-1',
      database_row_id: 'row-1',
      mention: {
        type: MentionTargetKind.DatabaseRow,
        database_id: 'database-1',
        row_id: 'row-1',
      },
    });

    expect(mention).toMatchObject({
      type: MentionType.PageRef,
      block_id: 'row-1',
      database_id: 'database-1',
      row_id: 'row-1',
      database_row_id: 'row-1',
    });
    expect(mention?.page_id).toBeUndefined();
  });

  it('maps database search items to page refs for desktop compatibility', () => {
    const mention = mentionSearchItemToMention({
      kind: MentionTargetKind.Database,
      object_id: 'database-view-1',
      title: 'Roadmap DB',
      database_id: 'database-1',
      database_view_id: 'database-view-1',
      mention: {
        type: MentionTargetKind.Database,
        database_id: 'database-1',
        database_view_id: 'database-view-1',
      },
    });

    expect(mention).toMatchObject({
      type: MentionType.PageRef,
      page_id: 'database-view-1',
      database_id: 'database-1',
      database_view_id: 'database-view-1',
      data: {
        title: 'Roadmap DB',
      },
    });
  });

  it('flattens sectioned search results with stable section indexes', () => {
    const results = flattenMentionSearchSections([
      {
        kind: MentionSearchSectionKind.Pages,
        title: 'Pages',
        has_more: false,
        status: 'ready',
        items: [
          {
            kind: MentionTargetKind.Page,
            object_id: 'page-1',
            title: 'Roadmap',
            mention: {
              type: MentionTargetKind.Page,
              page_id: 'page-1',
            },
          },
        ],
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sectionIndex: 0,
      sectionKind: MentionSearchSectionKind.Pages,
      mention: {
        type: MentionType.PageRef,
        page_id: 'page-1',
      },
    });
  });

  it('maps external link wire mentions to editor link mentions', () => {
    const mention = mentionSearchItemToMention({
      kind: MentionTargetKind.ExternalLink,
      object_id: 'https://example.com',
      title: 'https://example.com',
      mention: {
        type: MentionType.externalLink,
        url: 'https://example.com',
      },
    });

    expect(mention).toMatchObject({
      type: MentionType.externalLink,
      url: 'https://example.com',
      data: {
        title: 'https://example.com',
      },
    });
  });

  it('maps reminder search items to date mentions with generated reminder ids', () => {
    const mention = mentionSearchItemToMention({
      kind: MentionTargetKind.Reminder,
      object_id: 'reminder-tomorrow-9am',
      title: 'Reminder tomorrow 9 AM',
      subtitle: '2026-06-18 09:00',
      mention: {
        type: MentionTargetKind.Date,
        start: '2026-06-18T09:00:00+08:00',
        reminder_option: 'atTimeOfEvent',
        include_time: true,
      },
    });

    expect(mention).toMatchObject({
      type: MentionType.Date,
      date: '2026-06-18T09:00:00+08:00',
      reminder_option: 'atTimeOfEvent',
      include_time: true,
      data: {
        title: 'Reminder tomorrow 9 AM',
        subtitle: '2026-06-18 09:00',
      },
    });
    expect(mention?.reminder_id).toEqual(expect.any(String));
    expect(mention?.reminder_id).not.toHaveLength(0);
  });

  it('accepts documented date payload field names for date quick picks', () => {
    const mention = mentionSearchItemToMention({
      kind: MentionTargetKind.Date,
      title: 'Tomorrow',
      subtitle: '2026-06-18',
      mention: {
        type: MentionTargetKind.Date,
        date: '2026-06-18T00:00:00+08:00',
        include_time: false,
      },
    });

    expect(mention).toMatchObject({
      type: MentionType.Date,
      date: '2026-06-18T00:00:00+08:00',
      include_time: false,
    });
    expect(mention?.reminder_id).toBeUndefined();
  });

  it('uses the default page title for unnamed page-like search results', () => {
    expect(
      getMentionSearchResultDisplayTitle(
        {
          kind: MentionTargetKind.Page,
          object_id: 'page-1',
          title: '',
          mention: {
            type: MentionTargetKind.Page,
            page_id: 'page-1',
          },
        },
        'Untitled'
      )
    ).toBe('Untitled');

    expect(
      getMentionSearchResultDisplayTitle(
        {
          kind: MentionTargetKind.DatabaseRow,
          object_id: 'row-1',
          title: '   ',
          mention: {
            type: MentionTargetKind.DatabaseRow,
            database_id: 'database-1',
            row_id: 'row-1',
          },
        },
        'Untitled'
      )
    ).toBe('Untitled');
  });

  it('builds distinct cache keys for different mention contexts', () => {
    const base = buildMentionSearchCacheKey({
      query: 'road',
      include: [MentionTargetKind.Page],
      context: { view_id: 'view-1' },
    });
    const rowContext = buildMentionSearchCacheKey({
      query: 'road',
      include: [MentionTargetKind.Page],
      context: { view_id: 'view-1', row_id: 'row-1' },
    });

    expect(base).not.toEqual(rowContext);
  });

  it('normalizes mention cache keys for query casing and unordered sets', () => {
    const first = buildMentionSearchCacheKey({
      query: ' HR ',
      include: [MentionTargetKind.Page, MentionTargetKind.Person],
      filter: {
        database_ids: ['database-b', 'database-a'],
      },
    });
    const second = buildMentionSearchCacheKey({
      query: 'hr',
      include: [MentionTargetKind.Person, MentionTargetKind.Page],
      filter: {
        database_ids: ['database-a', 'database-b'],
      },
    });
    const empty = buildMentionSearchCacheKey({
      query: '',
      include: [MentionTargetKind.Person, MentionTargetKind.Page],
      filter: {
        database_ids: ['database-a', 'database-b'],
      },
    });

    expect(first).toEqual(second);
    expect(first).not.toEqual(empty);
  });

  it('scopes mention cache keys by workspace and user', () => {
    const requests = buildMentionSearchRequests({
      query: 'road',
      include: [MentionTargetKind.Page],
      context: { view_id: 'view-1' },
    });
    const firstWorkspace = buildMentionSearchRequestsCacheKey(requests, {
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });
    const secondWorkspace = buildMentionSearchRequestsCacheKey(requests, {
      workspaceId: 'workspace-2',
      userId: 'user-1',
    });
    const secondUser = buildMentionSearchRequestsCacheKey(requests, {
      workspaceId: 'workspace-1',
      userId: 'user-2',
    });

    expect(firstWorkspace).not.toEqual(secondWorkspace);
    expect(firstWorkspace).not.toEqual(secondUser);
  });

  it('splits typed database-row mention search into a scoped dedicated row request', () => {
    const requests = buildMentionSearchRequests({
      query: 'road',
      include: [
        MentionTargetKind.Person,
        MentionTargetKind.Page,
        MentionTargetKind.Database,
        MentionTargetKind.DatabaseRow,
        MentionTargetKind.ExternalLink,
      ],
      context: { view_id: 'view-1', database_id: 'database-1', database_view_id: 'database-view-1' },
    });

    expect(requests).toEqual([
      {
        query: 'road',
        include: [
          MentionTargetKind.Person,
          MentionTargetKind.Page,
          MentionTargetKind.Database,
          MentionTargetKind.ExternalLink,
        ],
        context: { view_id: 'view-1', database_id: 'database-1', database_view_id: 'database-view-1' },
      },
      {
        query: 'road',
        include: [MentionTargetKind.DatabaseRow],
        context: { view_id: 'view-1', database_id: 'database-1', database_view_id: 'database-view-1' },
        filter: {
          database_ids: ['database-1'],
          database_view_ids: [],
          database_row_ids: [],
        },
      },
    ]);
  });

  // MEN-WEB-15: the picker that matches every row of its database itself leaves the rows request out.
  it('leaves the typed rows request out when asked, keeping the primary request and its cache key apart', () => {
    const request = {
      query: 'road',
      include: [MentionTargetKind.Person, MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
      context: { view_id: 'view-1', database_view_id: 'database-view-1' },
    };
    const both = buildMentionSearchRequests(request);
    const primaryOnly = buildMentionSearchRequests(request, { skipRows: true });

    expect(primaryOnly).toEqual([both[0]]);
    expect(primaryOnly[0].include).toEqual([MentionTargetKind.Person, MentionTargetKind.Page]);
    expect(buildMentionSearchRequests(request, { skipRows: false })).toEqual(both);
    expect(buildMentionSearchRequestsCacheKey(primaryOnly)).not.toEqual(buildMentionSearchRequestsCacheKey(both));
    // An empty include means every kind: the primary request names every kind but rows.
    expect(buildMentionSearchRequests({ query: 'road' }, { skipRows: true })).toEqual([
      buildMentionSearchRequests({ query: 'road' })[0],
    ]);
    // A bare `@` never asks for rows anyway.
    expect(buildMentionSearchRequests({ ...request, query: '' }, { skipRows: true })).toEqual(
      buildMentionSearchRequests({ ...request, query: '' })
    );
  });

  it('keeps the rows request of a picker that asks for rows alone, which would send nothing without it', () => {
    const rowsOnly = { query: 'road', include: [MentionTargetKind.DatabaseRow] };

    expect(buildMentionSearchRequests(rowsOnly, { skipRows: true })).toEqual(buildMentionSearchRequests(rowsOnly));
    expect(buildMentionSearchRequests(rowsOnly, { skipRows: true })).toHaveLength(1);
  });

  it('preserves explicit database filters on typed database-row mention search', () => {
    const requests = buildMentionSearchRequests({
      query: 'road',
      include: [MentionTargetKind.DatabaseRow],
      context: { database_id: 'context-database' },
      filter: {
        database_ids: ['explicit-database'],
        database_view_ids: [],
        database_row_ids: [],
      },
    });

    expect(requests).toEqual([
      {
        query: 'road',
        include: [MentionTargetKind.DatabaseRow],
        context: { database_id: 'context-database' },
        filter: {
          database_ids: ['explicit-database'],
          database_view_ids: [],
          database_row_ids: [],
        },
      },
    ]);
  });

  it('does not scope document-level row search without an explicit database context', () => {
    const requests = buildMentionSearchRequests({
      query: 'email',
      include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
      context: { view_id: 'document-1' },
    });

    expect(requests).toEqual([
      {
        query: 'email',
        include: [MentionTargetKind.Page],
        context: { view_id: 'document-1' },
      },
      {
        query: 'email',
        include: [MentionTargetKind.DatabaseRow],
        context: { view_id: 'document-1' },
      },
    ]);
  });

  it.each([
    {
      panel: '@',
      include: [
        MentionTargetKind.Person,
        MentionTargetKind.Page,
        MentionTargetKind.Database,
        MentionTargetKind.DatabaseRow,
        MentionTargetKind.Date,
        MentionTargetKind.Reminder,
        MentionTargetKind.ExternalLink,
      ],
    },
    {
      panel: 'page-reference',
      include: [MentionTargetKind.Page, MentionTargetKind.Database, MentionTargetKind.DatabaseRow],
    },
  ])('sends a bare $panel query as one request that does not ask for database rows', ({ include }) => {
    for (const query of ['', '  ']) {
      const request = { query, limit: 20, include, context: { view_id: 'document-1', row_id: 'row-1' } };

      expect(buildMentionSearchRequests(request)).toEqual([
        { ...request, include: include.filter((kind) => kind !== MentionTargetKind.DatabaseRow) },
      ]);
    }

    expect(include).toContain(MentionTargetKind.DatabaseRow);
  });

  it('leaves a bare request alone when dropping database rows would empty its include', () => {
    const everyKind = { query: '', include: [] };
    const rowsOnly = { query: '', include: [MentionTargetKind.DatabaseRow] };
    const withoutRows = { query: '', include: [MentionTargetKind.Page] };

    expect(buildMentionSearchRequests(everyKind)).toEqual([everyKind]);
    expect(buildMentionSearchRequests(rowsOnly)).toEqual([rowsOnly]);
    expect(buildMentionSearchRequests(withoutRows)[0]).toBe(withoutRows);
  });

  it('recognizes only the typed rows request as database-row only', () => {
    const [primary, rows] = buildMentionSearchRequests({
      query: 'road',
      include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
    });

    expect(isDatabaseRowOnlyMentionRequest(primary)).toBe(false);
    expect(isDatabaseRowOnlyMentionRequest(rows)).toBe(true);
    expect(isDatabaseRowOnlyMentionRequest({ query: 'road' })).toBe(false);
  });

  it('keeps date and reminder in the primary typed search request when rows are split out', () => {
    const requests = buildMentionSearchRequests({
      query: 'tom',
    });

    expect(requests).toEqual([
      {
        query: 'tom',
        include: [
          MentionTargetKind.Person,
          MentionTargetKind.Page,
          MentionTargetKind.Database,
          MentionTargetKind.Date,
          MentionTargetKind.Reminder,
          MentionTargetKind.ExternalLink,
        ],
      },
      {
        query: 'tom',
        include: [MentionTargetKind.DatabaseRow],
      },
    ]);
  });

  it('merges split mention search responses using picker section order', () => {
    const response = mergeMentionSearchResponses([
      {
        sections: [
          {
            kind: MentionSearchSectionKind.Links,
            title: 'Links',
            has_more: false,
            status: 'ready',
            items: [
              {
                kind: MentionTargetKind.ExternalLink,
                title: 'https://example.com',
                mention: {
                  type: MentionType.externalLink,
                  url: 'https://example.com',
                },
              },
            ],
          },
        ],
      },
      {
        sections: [
          {
            kind: MentionSearchSectionKind.Pages,
            title: 'Pages',
            has_more: false,
            status: 'ready',
            items: [
              {
                kind: MentionTargetKind.DatabaseRow,
                object_id: 'row-1',
                title: 'Roadmap row',
                mention: {
                  type: MentionTargetKind.DatabaseRow,
                  database_id: 'database-1',
                  row_id: 'row-1',
                },
              },
            ],
          },
        ],
      },
    ]);

    expect(response.sections.map((section) => section.kind)).toEqual([
      MentionSearchSectionKind.Pages,
      MentionSearchSectionKind.Links,
    ]);
  });

  it('folds a Databases section into Pages in the folded layout', () => {
    const sections = layoutMentionSectionsForPicker(
      [
        {
          kind: MentionSearchSectionKind.People,
          title: 'People',
          has_more: false,
          status: 'ready',
          items: [],
        },
        {
          kind: MentionSearchSectionKind.Pages,
          title: 'Pages',
          has_more: false,
          status: 'ready',
          items: [
            {
              kind: MentionTargetKind.Page,
              object_id: 'page-1',
              title: 'Project Tracker 2',
              subtitle: 'Page',
              mention: {
                type: MentionTargetKind.Page,
                page_id: 'page-1',
              },
            },
          ],
        },
        {
          kind: MentionSearchSectionKind.Databases,
          title: 'Databases',
          has_more: false,
          status: 'ready',
          items: [
            {
              kind: MentionTargetKind.Database,
              object_id: 'database-view-1',
              title: 'Completed Project',
              subtitle: 'Database',
              mention: {
                type: MentionTargetKind.Database,
                database_id: 'database-1',
                database_view_id: 'database-view-1',
              },
            },
          ],
        },
        {
          kind: MentionSearchSectionKind.Dates,
          title: 'Date & Reminder',
          has_more: false,
          status: 'ready',
          items: [],
        },
      ],
      'folded',
      'Pages'
    );

    expect(sections.map((section) => section.kind)).toEqual([
      MentionSearchSectionKind.People,
      MentionSearchSectionKind.Pages,
      MentionSearchSectionKind.Dates,
    ]);
    expect(sections[1].title).toBe('Pages');
    expect(sections[1].items.map((item) => item.title)).toEqual(['Project Tracker 2', 'Completed Project']);
    expect(sections[1].items[1].kind).toBe(MentionTargetKind.Database);
  });

  it('folds a Database rows section into Pages in the folded layout', () => {
    const sections = layoutMentionSectionsForPicker(
      [
        {
          kind: MentionSearchSectionKind.Pages,
          title: 'Pages',
          has_more: false,
          status: 'ready',
          items: [
            {
              kind: MentionTargetKind.Page,
              object_id: 'page-1',
              title: 'Project Tracker',
              mention: {
                type: MentionTargetKind.Page,
                page_id: 'page-1',
              },
            },
          ],
        },
        {
          kind: MentionSearchSectionKind.DatabaseRows,
          title: 'Database rows',
          has_more: false,
          status: 'ready',
          items: [
            {
              kind: MentionTargetKind.DatabaseRow,
              object_id: 'row-1',
              title: 'Roadmap row',
              mention: {
                type: MentionTargetKind.DatabaseRow,
                database_id: 'database-1',
                row_id: 'row-1',
              },
            },
          ],
        },
      ],
      'folded',
      'Pages'
    );

    // No Database rows heading: the rows show in Pages, each keeping its kind (its grid icon).
    expect(sections.map((section) => section.kind)).toEqual([MentionSearchSectionKind.Pages]);
    expect(sections[0].items.map((item) => item.title)).toEqual(['Project Tracker', 'Roadmap row']);
    expect(sections[0].items[1].kind).toBe(MentionTargetKind.DatabaseRow);
  });

  it('makes a Pages section when only database rows are returned, in the folded layout', () => {
    const sections = foldMentionSectionsIntoPages(
      [
        {
          kind: MentionSearchSectionKind.DatabaseRows,
          title: 'Database rows',
          has_more: false,
          status: 'ready',
          items: [
            {
              kind: MentionTargetKind.DatabaseRow,
              object_id: 'row-1',
              title: 'Roadmap row',
              mention: {
                type: MentionTargetKind.DatabaseRow,
                database_id: 'database-1',
                row_id: 'row-1',
              },
            },
          ],
        },
      ],
      'Pages'
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].kind).toBe(MentionSearchSectionKind.Pages);
    expect(sections[0].title).toBe('Pages');
    expect(sections[0].items[0].kind).toBe(MentionTargetKind.DatabaseRow);
  });

  it('puts the scope key first in every request group cache key', () => {
    const scope = { workspaceId: ' workspace-1 ', userId: 'user-1' };
    const requests = buildMentionSearchRequests({ query: 'hr', include: [MentionTargetKind.Page] });

    expect(buildMentionSearchCacheScopeKey(scope)).toBe('{"workspace_id":"workspace-1","user_id":"user-1"}');
    expect(buildMentionSearchRequestsCacheKey(requests, scope).split('\n')[0]).toBe(
      buildMentionSearchCacheScopeKey(scope)
    );
  });
});

// MEN-WEB-12: section titles in the user's language, and the separate layout behind its switch.
describe('mention picker sections', () => {
  const identity = (key: string) => key;
  // What servers title each kind (`MentionSectionKind::default_title` in the Cloud entity crate).
  const SERVER_TITLES: Record<MentionSearchSectionKind, string> = {
    [MentionSearchSectionKind.Suggested]: 'Suggested',
    [MentionSearchSectionKind.People]: 'People',
    [MentionSearchSectionKind.Pages]: 'Pages',
    [MentionSearchSectionKind.Databases]: 'Databases',
    [MentionSearchSectionKind.DatabaseRows]: 'Database rows',
    [MentionSearchSectionKind.Dates]: 'Dates',
    [MentionSearchSectionKind.Links]: 'Links',
  };
  const TITLE_KEYS: Record<MentionSearchSectionKind, string> = {
    [MentionSearchSectionKind.Suggested]: 'document.mentionMenu.suggested',
    [MentionSearchSectionKind.People]: 'document.mentionMenu.people',
    [MentionSearchSectionKind.Pages]: 'document.mentionMenu.pages',
    [MentionSearchSectionKind.Databases]: 'document.mentionMenu.databases',
    [MentionSearchSectionKind.DatabaseRows]: 'document.mentionMenu.databaseRows',
    [MentionSearchSectionKind.Dates]: 'document.mentionMenu.dates',
    [MentionSearchSectionKind.Links]: 'document.mentionMenu.links',
  };
  const UNKNOWN_KIND = 'tasks' as MentionSearchSectionKind;

  function english(key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  }

  function failedSection(kind: MentionSearchSectionKind): MentionSearchSection {
    return { kind, title: kind, has_more: false, status: 'failed', message: 'source failed', items: [] };
  }

  it('titles every kind by its document.mentionMenu key, whatever the server titled it', () => {
    Object.values(MentionSearchSectionKind).forEach((kind) => {
      expect(mentionSectionTitle(kind, identity, `Server ${kind}`)).toBe(TITLE_KEYS[kind]);
      // English shows what servers send, so an English picker reads as it did.
      expect(english(TITLE_KEYS[kind])).toBe(SERVER_TITLES[kind]);
    });
  });

  it('keeps the server title of a kind this client does not know', () => {
    expect(mentionSectionTitle(UNKNOWN_KIND, identity, 'Tasks')).toBe('Tasks');
    expect(mentionSectionTitle(UNKNOWN_KIND, identity)).toBe('');
  });

  it('carries the picker strings it translates in en.json', () => {
    expect(english('document.mentionMenu.moreResults')).toBe('{{count}} more results...');
    expect(english('document.mentionMenu.sendNotification')).toBe('Send notification');
    expect(english('document.mentionMenu.createSubPage')).toBe('Create "{{name}}" sub-page');
    expect(english('document.mentionMenu.createPageIn')).toBe('Create "{{name}}" page in...');
    expect(english('document.mentionMenu.createNewSubPage')).toBe('Create new sub-page');
    expect(english('document.mentionMenu.createNewPageIn')).toBe('Create new page in...');
  });

  it('keeps a database in its own section beside four or more pages in the separate layout', () => {
    const pages = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => page(id));
    const sections = layoutMentionSectionsForPicker(
      [
        sectionOf(MentionSearchSectionKind.People, [person('ada')]),
        sectionOf(MentionSearchSectionKind.Pages, pages),
        sectionOf(MentionSearchSectionKind.Databases, [database('db1', 'grid1')]),
      ],
      'separate',
      'Pages'
    );

    expect(sections.map((section) => section.kind)).toEqual([
      MentionSearchSectionKind.People,
      MentionSearchSectionKind.Pages,
      MentionSearchSectionKind.Databases,
    ]);
    expect(sections[1].items).toEqual(pages);
    expect(sections[2].items.map(mentionItemNavKey)).toEqual(['database:db1:grid1']);
    // Folded, the database joins Pages after the five pages, where only four show.
    const folded = layoutMentionSectionsForPicker(
      [
        sectionOf(MentionSearchSectionKind.Pages, pages),
        sectionOf(MentionSearchSectionKind.Databases, [database('db1')]),
      ],
      'folded',
      'Pages'
    );

    expect(folded.map((section) => section.kind)).toEqual([MentionSearchSectionKind.Pages]);
    expect(folded[0].items.map(mentionItemNavKey).indexOf('database:db1:-')).toBe(5);
  });

  it('puts sections in the canonical order whatever order they came in, unknown kinds last', () => {
    const otherUnknown = 'boards' as MentionSearchSectionKind;
    const shuffled = [
      MentionSearchSectionKind.Links,
      UNKNOWN_KIND,
      MentionSearchSectionKind.Databases,
      MentionSearchSectionKind.Dates,
      MentionSearchSectionKind.Pages,
      otherUnknown,
      MentionSearchSectionKind.People,
      MentionSearchSectionKind.DatabaseRows,
      MentionSearchSectionKind.Suggested,
    ].map((kind) => sectionOf(kind, []));
    const ordered = separateMentionSections(shuffled);

    expect(ordered.map((section) => section.kind)).toEqual([
      MentionSearchSectionKind.Suggested,
      MentionSearchSectionKind.People,
      MentionSearchSectionKind.Pages,
      MentionSearchSectionKind.Databases,
      MentionSearchSectionKind.DatabaseRows,
      MentionSearchSectionKind.Dates,
      MentionSearchSectionKind.Links,
      UNKNOWN_KIND,
      otherUnknown,
    ]);
    // Each section is kept as it came, and an answer already in order is returned as it is.
    ordered.forEach((section) => expect(shuffled).toContain(section));
    expect(separateMentionSections(ordered)).toBe(ordered);
  });

  it('keeps typed rows inside Pages and a failed Database rows section as it is in the separate layout', () => {
    // Search sends typed rows inside Pages; Cloud fails the rows source as a Database rows section.
    const pages = sectionOf(MentionSearchSectionKind.Pages, [page('a'), row('dbY', 'r1', 'gridY')]);
    const failedRows = failedSection(MentionSearchSectionKind.DatabaseRows);
    const sections = layoutMentionSectionsForPicker([pages, failedRows], 'separate', 'Pages');

    expect(sections).toEqual([pages, failedRows]);
    expect(sections[1].status).toBe('failed');
    // Folded, the empty failed section is left out.
    expect(
      layoutMentionSectionsForPicker([pages, failedRows], 'folded', 'Pages').map((section) => section.kind)
    ).toEqual([MentionSearchSectionKind.Pages]);
  });

  it('shows a Database rows section with items under its own heading in the separate layout', () => {
    // As a server that sends rows in a Database rows section answers.
    const rows = sectionOf(MentionSearchSectionKind.DatabaseRows, [row('dbY', 'r1', 'gridY')]);
    const sections = layoutMentionSectionsForPicker(
      [sectionOf(MentionSearchSectionKind.Pages, [page('a')]), rows],
      'separate',
      'Pages'
    );

    expect(sections.map((section) => section.kind)).toEqual([
      MentionSearchSectionKind.Pages,
      MentionSearchSectionKind.DatabaseRows,
    ]);
    expect(flattenMentionSearchSections(sections).map((result) => result.key)).toEqual([
      'pages|page:a',
      'database_rows|row:dbY:r1',
    ]);
  });

  it('keeps a database key in its own section when typed rows merge into Pages, in the separate layout', () => {
    const primary = {
      sections: [
        sectionOf(MentionSearchSectionKind.Pages, [page('a')]),
        sectionOf(MentionSearchSectionKind.Databases, [database('dbX', 'grid')]),
      ],
    };
    const rows = { sections: [sectionOf(MentionSearchSectionKind.Pages, [row('dbY', 'r1')])] };
    const keysOf = (sections: MentionSearchSection[]) =>
      flattenMentionSearchSections(layoutMentionSectionsForPicker(sections, 'separate', 'Pages')).map(
        (result) => result.key
      );

    expect(keysOf(mergeMentionSearchResponses([primary]).sections)).toEqual([
      'pages|page:a',
      'databases|database:dbX:grid',
    ]);
    expect(keysOf(mergeMentionSearchResponses([primary, rows]).sections)).toEqual([
      'pages|page:a',
      'pages|row:dbY:r1',
      'databases|database:dbX:grid',
    ]);
  });

  it('collapses only Pages when folded, and every people and object section when separate', () => {
    const collapsing = (layout: 'folded' | 'separate') =>
      Object.values(MentionSearchSectionKind).filter((kind) => mentionSectionCollapses(kind, layout));

    expect(MENTION_SECTION_COLLAPSE_LIMIT).toBe(4);
    expect(collapsing('folded')).toEqual([MentionSearchSectionKind.Pages]);
    expect(collapsing('separate')).toEqual([
      MentionSearchSectionKind.Suggested,
      MentionSearchSectionKind.People,
      MentionSearchSectionKind.Pages,
      MentionSearchSectionKind.Databases,
      MentionSearchSectionKind.DatabaseRows,
    ]);
    expect(mentionSectionCollapses(UNKNOWN_KIND, 'separate')).toBe(false);
  });
});

describe('mention response completeness', () => {
  const [primary, rows] = buildMentionSearchRequests({
    query: 'hr',
    include: [
      MentionTargetKind.Person,
      MentionTargetKind.Page,
      MentionTargetKind.Database,
      MentionTargetKind.DatabaseRow,
      MentionTargetKind.Date,
    ],
    context: { view_id: 'document-1' },
  });
  const bare = buildMentionSearchRequests({ query: '', include: [MentionTargetKind.Person, MentionTargetKind.Page] })[0];

  function section(kind: MentionSearchSectionKind, status = 'ok', items: MentionSearchResultItem[] = []) {
    return { kind, title: kind, items, has_more: false, status } as MentionSearchSection;
  }

  const people = section(MentionSearchSectionKind.People, 'ok', [person('ada')]);
  const dates = section(MentionSearchSectionKind.Dates);
  const pagesWithItem = section(MentionSearchSectionKind.Pages, 'ok', [page('hr-page')]);

  it('finds a failed section, and only one with status failed', () => {
    expect(
      hasFailedMentionSection({ sections: [pagesWithItem, section(MentionSearchSectionKind.Databases, 'failed')] })
    ).toBe(true);
    expect(
      hasFailedMentionSection({ sections: [section(MentionSearchSectionKind.Pages, 'partial', [page('hr')]), people] })
    ).toBe(false);
    // Older answers and the local fallback use other or no statuses.
    expect(hasFailedMentionSection({ sections: [section(MentionSearchSectionKind.Pages, 'ready')] })).toBe(false);
    expect(hasFailedMentionSection({ sections: [{ ...pagesWithItem, status: undefined as unknown as string }] })).toBe(
      false
    );
  });

  it.each<[string, Parameters<typeof isSupersededMentionResponse>[0], MentionSearchResponse, boolean]>([
    ['the rows-only shape Search answers', rows, { sections: [], partial: true }, true],
    ['the primary shape Cloud wraps in People and Dates', primary, { sections: [people, dates], partial: true }, true],
    ['a bare answer with People only', bare, { sections: [people], partial: true }, true],
    ['an empty answer that is not partial', rows, { sections: [] }, false],
    ['a path-shed answer with items', primary, { sections: [people, pagesWithItem], partial: true }, false],
    [
      'a degraded answer with a failed section',
      rows,
      { sections: [section(MentionSearchSectionKind.Pages, 'failed')], partial: true },
      false,
    ],
    [
      'a Cloud object failure',
      rows,
      { sections: [section(MentionSearchSectionKind.DatabaseRows, 'failed')], partial: true },
      false,
    ],
    [
      'a databases-only answer',
      primary,
      { sections: [section(MentionSearchSectionKind.Databases, 'ok')], partial: true },
      false,
    ],
  ])('recognizes %s', (_name, request, response, superseded) => {
    expect(isSupersededMentionResponse(request, response)).toBe(superseded);
  });

  it('treats a partial answer without a failed section as complete, and nothing else that is degraded', () => {
    expect(isCompleteMentionResponse(primary, { sections: [people, pagesWithItem], partial: true })).toBe(true);
    expect(isCompleteMentionResponse(rows, { sections: [] })).toBe(true);
    expect(isCompleteMentionResponse(rows, { sections: [], partial: true })).toBe(false);
    expect(
      isCompleteMentionResponse(primary, {
        sections: [section(MentionSearchSectionKind.People, 'failed'), pagesWithItem],
        partial: true,
      })
    ).toBe(false);
  });

  it('shows a primary or bare answer of the superseded shape as complete, but caches only answers without it', () => {
    // A People annotation that degraded over objects that matched nothing has this shape too.
    const peopleOnly: MentionSearchResponse = { sections: [people, dates], partial: true };

    expect(isCompleteMentionResponse(primary, peopleOnly)).toBe(true);
    expect(isCacheableMentionResponse(primary, peopleOnly)).toBe(false);
    expect(isCompleteMentionResponse(bare, { sections: [people], partial: true })).toBe(true);
    expect(isCacheableMentionResponse(bare, { sections: [people], partial: true })).toBe(false);
    // Cloud adds nothing to a rows-only answer, so its superseded shape is unambiguous.
    expect(isCompleteMentionResponse(rows, { sections: [], partial: true })).toBe(false);
    expect(isCacheableMentionResponse(rows, { sections: [], partial: true })).toBe(false);
    // Load-shed paths alone, and an old server's answer, are cacheable.
    expect(isCacheableMentionResponse(primary, { sections: [people, pagesWithItem], partial: true })).toBe(true);
    expect(isCacheableMentionResponse(rows, { sections: [] })).toBe(true);
    expect(
      isCacheableMentionResponse(primary, {
        sections: [people, section(MentionSearchSectionKind.Pages, 'failed')],
        partial: true,
      })
    ).toBe(false);
  });

  it('retries rows only after a retryable failed section or a superseded answer', () => {
    const failedPages = section(MentionSearchSectionKind.Pages, 'failed');

    expect(shouldRetryMentionRowsResponse(rows, { sections: [failedPages], partial: true })).toBe(true);
    expect(
      shouldRetryMentionRowsResponse(rows, {
        sections: [section(MentionSearchSectionKind.DatabaseRows, 'failed')],
        partial: true,
      })
    ).toBe(true);
    expect(shouldRetryMentionRowsResponse(rows, { sections: [], partial: true })).toBe(true);
    // A disabled keyword index fails the section for good, and leaves `partial` unset.
    expect(shouldRetryMentionRowsResponse(rows, { sections: [failedPages] })).toBe(false);
    // Load-shed breadcrumb paths leave every row in place.
    expect(shouldRetryMentionRowsResponse(rows, { sections: [pagesWithItem], partial: true })).toBe(false);
    expect(shouldRetryMentionRowsResponse(rows, { sections: [] })).toBe(false);
  });
});
