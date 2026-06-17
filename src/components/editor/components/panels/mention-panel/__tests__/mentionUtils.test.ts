import { describe, expect, it } from '@jest/globals';

import { MentionSearchSectionKind, MentionTargetKind, MentionType } from '@/application/types';

import {
  buildMentionSearchCacheKey,
  buildMentionSearchRequests,
  flattenMentionSearchSections,
  getMentionSearchResultDisplayTitle,
  mentionSearchItemToMention,
  mergeMentionSearchResponses,
  normalizeMentionSearchSectionsForPicker,
  shouldCacheMentionSearchSections,
} from '../mentionUtils';

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

  it('keeps empty mention search as one request so rows stay hidden by UI policy', () => {
    const request = {
      query: '',
      include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
    };

    expect(buildMentionSearchRequests(request)).toEqual([request]);
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
      },
    ]);

    expect(response.sections.map((section) => section.kind)).toEqual([
      MentionSearchSectionKind.DatabaseRows,
      MentionSearchSectionKind.Links,
    ]);
  });

  it('normalizes database sections into pages for desktop picker parity', () => {
    const sections = normalizeMentionSearchSectionsForPicker([
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
    ]);

    expect(sections.map((section) => section.kind)).toEqual([
      MentionSearchSectionKind.People,
      MentionSearchSectionKind.Pages,
      MentionSearchSectionKind.Dates,
    ]);
    expect(sections[1].title).toBe('Pages');
    expect(sections[1].items.map((item) => item.title)).toEqual(['Project Tracker 2', 'Completed Project']);
    expect(sections[1].items[1].kind).toBe(MentionTargetKind.Database);
  });

  it('does not cache typed row-capable searches until a row section is present', () => {
    const requests = buildMentionSearchRequests({
      query: 'hr',
      include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
      context: { view_id: 'document-1' },
    });

    expect(
      shouldCacheMentionSearchSections(
        requests,
        [
          {
            kind: MentionSearchSectionKind.Pages,
            title: 'Pages',
            has_more: false,
            status: 'ready',
            items: [
              {
                kind: MentionTargetKind.Page,
                title: 'HR handbook',
                mention: {
                  type: MentionTargetKind.Page,
                  page_id: 'page-1',
                },
              },
            ],
          },
        ],
        true
      )
    ).toBe(false);

    expect(
      shouldCacheMentionSearchSections(
        requests,
        [
          {
            kind: MentionSearchSectionKind.DatabaseRows,
            title: 'Database rows',
            has_more: false,
            status: 'ready',
            items: [
              {
                kind: MentionTargetKind.DatabaseRow,
                title: 'HR',
                mention: {
                  type: MentionTargetKind.DatabaseRow,
                  database_id: 'database-1',
                  row_id: 'row-1',
                },
              },
            ],
          },
        ],
        true
      )
    ).toBe(true);
  });
});
