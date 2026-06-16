import { describe, expect, it } from '@jest/globals';

import { MentionSearchSectionKind, MentionTargetKind, MentionType } from '@/application/types';

import {
  buildMentionSearchCacheKey,
  buildMentionSearchRequests,
  flattenMentionSearchSections,
  mentionSearchItemToMention,
  mergeMentionSearchResponses,
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
        type: MentionTargetKind.DatabaseRow,
        database_id: 'database-1',
        database_view_id: 'view-1',
        row_id: 'row-1',
        row_document_id: 'row-document-1',
      },
    });

    expect(mention).toEqual({
      type: MentionType.DatabaseRow,
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

  it('applies embedded database filters only to the dedicated row request', () => {
    const requests = buildMentionSearchRequests(
      {
        query: 'email',
        include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
        context: { view_id: 'document-1' },
      },
      {
        database_ids: ['embedded-database-1', 'embedded-database-2'],
        database_view_ids: ['embedded-view-1', 'embedded-view-2'],
        database_row_ids: [],
      }
    );

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
        filter: {
          database_ids: ['embedded-database-1', 'embedded-database-2'],
          database_view_ids: ['embedded-view-1', 'embedded-view-2'],
          database_row_ids: [],
        },
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
});
