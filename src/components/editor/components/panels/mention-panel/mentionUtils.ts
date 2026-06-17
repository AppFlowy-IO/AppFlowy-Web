import {
  Mention,
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
} from '@/application/types';

export interface MentionPanelSearchResult {
  key: string;
  item: MentionSearchResultItem;
  mention: Mention;
  sectionKind: MentionSearchSectionKind;
  sectionIndex: number;
}

const MENTION_SECTION_ORDER = [
  MentionSearchSectionKind.Suggested,
  MentionSearchSectionKind.People,
  MentionSearchSectionKind.Pages,
  MentionSearchSectionKind.Databases,
  MentionSearchSectionKind.DatabaseRows,
  MentionSearchSectionKind.Dates,
  MentionSearchSectionKind.Links,
];

const ALL_MENTION_TARGETS_EXCEPT_DATABASE_ROWS = [
  MentionTargetKind.Person,
  MentionTargetKind.Page,
  MentionTargetKind.Database,
  MentionTargetKind.Date,
  MentionTargetKind.ExternalLink,
];

function withDatabaseRowSearchFilter(request: MentionSearchRequest): MentionSearchRequest {
  const requestWithFilter = request;
  const context = request.context;
  const existingFilter = requestWithFilter.filter;
  const databaseIds = existingFilter?.database_ids ?? [];
  const databaseViewIds = existingFilter?.database_view_ids ?? [];

  if (!context?.database_id && !context?.database_view_id) {
    return requestWithFilter;
  }

  if (databaseIds.length > 0 || databaseViewIds.length > 0) {
    return requestWithFilter;
  }

  return {
    ...requestWithFilter,
    filter: {
      ...existingFilter,
      database_ids: context.database_id ? [context.database_id] : [],
      database_view_ids: context.database_id || !context.database_view_id ? [] : [context.database_view_id],
      database_row_ids: existingFilter?.database_row_ids ?? [],
    },
  };
}

function mentionSectionOrder(kind: MentionSearchSectionKind) {
  const index = MENTION_SECTION_ORDER.indexOf(kind);

  return index === -1 ? MENTION_SECTION_ORDER.length : index;
}

function withDisplayData(mention: Mention, item: MentionSearchResultItem): Mention {
  return {
    ...mention,
    data: {
      title: item.title,
      subtitle: item.subtitle,
      icon: item.icon,
    },
  };
}

export function mentionSearchItemToMention(item: MentionSearchResultItem): Mention | null {
  const { mention } = item;

  switch (item.kind) {
    case MentionTargetKind.Person: {
      const personMention = mention as {
        person_id: string;
        person_name?: string;
        page_id: string;
        block_id?: string;
        row_id?: string;
      };

      return withDisplayData(
        {
          type: MentionType.Person,
          person_id: personMention.person_id,
          person_name: personMention.person_name || item.title,
          page_id: personMention.page_id,
          block_id: personMention.block_id,
          row_id: personMention.row_id,
        },
        item
      );
    }
    case MentionTargetKind.Page: {
      const pageMention = mention as {
        page_id: string;
        block_id?: string;
        row_id?: string;
      };

      return withDisplayData(
        {
          type: MentionType.PageRef,
          page_id: pageMention.page_id,
          block_id: pageMention.block_id,
          row_id: pageMention.row_id,
        },
        item
      );
    }
    case MentionTargetKind.Database: {
      const databaseMention = mention as {
        database_id: string;
        database_view_id?: string;
      };

      return withDisplayData(
        {
          type: MentionType.Database,
          database_id: databaseMention.database_id,
          database_view_id: databaseMention.database_view_id,
        },
        item
      );
    }
    case MentionTargetKind.DatabaseRow: {
      const databaseRowMention = mention as {
        database_id: string;
        database_view_id?: string;
        row_id: string;
        row_document_id?: string;
      };

      return withDisplayData(
        {
          type: MentionType.DatabaseRow,
          database_id: databaseRowMention.database_id,
          database_view_id: databaseRowMention.database_view_id,
          row_id: databaseRowMention.row_id,
          database_row_id: item.database_row_id ?? databaseRowMention.row_id,
          row_document_id: item.row_document_id ?? databaseRowMention.row_document_id,
        },
        item
      );
    }
    case MentionTargetKind.Date: {
      const dateMention = mention as {
        start: string;
        end?: string;
        reminder_id?: string;
        reminder_option?: string;
        include_time?: boolean;
      };

      return withDisplayData(
        {
          type: MentionType.Date,
          date: dateMention.start,
          end: dateMention.end,
          reminder_id: dateMention.reminder_id,
          reminder_option: dateMention.reminder_option,
          include_time: dateMention.include_time,
        },
        item
      );
    }
    case MentionTargetKind.ExternalLink: {
      const linkMention = mention as {
        url: string;
      };

      return withDisplayData(
        {
          type: MentionType.externalLink,
          url: linkMention.url,
        },
        item
      );
    }
    default:
      return null;
  }
}

export function flattenMentionSearchSections(sections: MentionSearchSection[]): MentionPanelSearchResult[] {
  return sections.flatMap((section, sectionIndex) =>
    section.items.flatMap((item, itemIndex) => {
      const mention = mentionSearchItemToMention(item);

      if (!mention) return [];

      return [
        {
          key: `${section.kind}:${sectionIndex}:${item.kind}:${item.object_id ?? item.title}:${itemIndex}`,
          item,
          mention,
          sectionKind: section.kind,
          sectionIndex,
        },
      ];
    })
  );
}

export function buildMentionSearchCacheKey(request: MentionSearchRequest) {
  return JSON.stringify({
    query: request.query ?? '',
    limit: request.limit ?? null,
    cursor: request.cursor ?? null,
    include: request.include ?? [],
    context: request.context ?? {},
    filter: request.filter ?? {},
  });
}

export function buildMentionSearchRequests(
  request: MentionSearchRequest
): MentionSearchRequest[] {
  const query = request.query?.trim() ?? '';
  const include = request.include ?? [];
  const includesDatabaseRows = include.length === 0 || include.includes(MentionTargetKind.DatabaseRow);

  if (!query || !includesDatabaseRows) {
    return [request];
  }

  const primaryInclude =
    include.length > 0
      ? include.filter((kind) => kind !== MentionTargetKind.DatabaseRow)
      : ALL_MENTION_TARGETS_EXCEPT_DATABASE_ROWS;

  return [
    ...(primaryInclude.length > 0 ? [{ ...request, include: primaryInclude }] : []),
    withDatabaseRowSearchFilter(
      {
        ...request,
        include: [MentionTargetKind.DatabaseRow],
      }
    ),
  ];
}

export function buildMentionSearchRequestsCacheKey(requests: MentionSearchRequest[]) {
  return requests.map(buildMentionSearchCacheKey).join('\n');
}

function requestIncludesDatabaseRows(request: MentionSearchRequest): boolean {
  const include = request.include ?? [];

  return include.length === 0 || include.includes(MentionTargetKind.DatabaseRow);
}

export function shouldCacheMentionSearchSections(
  requests: MentionSearchRequest[],
  sections: MentionSearchSection[],
  hasQuery: boolean
) {
  if (!hasQuery || !requests.some(requestIncludesDatabaseRows)) {
    return true;
  }

  return sections.some(
    (section) => section.kind === MentionSearchSectionKind.DatabaseRows && section.items.length > 0
  );
}

export function mergeMentionSearchResponses(responses: MentionSearchResponse[]): MentionSearchResponse {
  const sectionsByKind = new Map<MentionSearchSectionKind, MentionSearchSection>();

  responses.forEach((response) => {
    response.sections.forEach((section) => {
      const existing = sectionsByKind.get(section.kind);

      if (!existing) {
        sectionsByKind.set(section.kind, {
          ...section,
          items: [...section.items],
        });
        return;
      }

      existing.items.push(...section.items);
      existing.has_more = existing.has_more || section.has_more;
      existing.next_cursor = existing.next_cursor ?? section.next_cursor;
      existing.message = existing.message ?? section.message;
    });
  });

  return {
    sections: Array.from(sectionsByKind.values()).sort(
      (left, right) => mentionSectionOrder(left.kind) - mentionSectionOrder(right.kind)
    ),
    partial: responses.some((response) => response.partial),
  };
}
