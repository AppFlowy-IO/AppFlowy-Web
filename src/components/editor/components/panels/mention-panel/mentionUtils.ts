import { v4 as uuidv4 } from 'uuid';

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
  /** The option key: the picker section kind plus `navKey`, holding no position. */
  key: string;
  /** The item's section-free identity, from {@link mentionItemNavKey}. */
  navKey: string;
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
  MentionTargetKind.Reminder,
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

/** A section kind's place in the canonical order servers send: Suggested, People, Pages, … Links. */
export function mentionSectionOrder(kind: MentionSearchSectionKind) {
  const index = MENTION_SECTION_ORDER.indexOf(kind);

  return index === -1 ? MENTION_SECTION_ORDER.length : index;
}

export function normalizeMentionSearchSectionsForPicker(
  sections: MentionSearchSection[],
  pagesTitle = 'Pages'
): MentionSearchSection[] {
  let databaseSection: MentionSearchSection | undefined;
  const normalizedSections: MentionSearchSection[] = [];

  sections.forEach((section) => {
    // Databases AND database rows render inline in the Pages section (desktop
    // parity: the separate "Database rows" heading was removed) — each item
    // keeps its own kind, which drives its icon and insert behavior.
    if (
      section.kind === MentionSearchSectionKind.Databases ||
      section.kind === MentionSearchSectionKind.DatabaseRows
    ) {
      if (section.items.length === 0) return;

      databaseSection = databaseSection
        ? {
            ...databaseSection,
            items: [...databaseSection.items, ...section.items],
            has_more: databaseSection.has_more || section.has_more,
            next_cursor: databaseSection.next_cursor ?? section.next_cursor,
            message: databaseSection.message ?? section.message,
          }
        : {
            ...section,
            items: [...section.items],
          };
      return;
    }

    normalizedSections.push({
      ...section,
      items: [...section.items],
    });
  });

  if (!databaseSection) {
    return normalizedSections;
  }

  const pagesIndex = normalizedSections.findIndex((section) => section.kind === MentionSearchSectionKind.Pages);

  if (pagesIndex >= 0) {
    const pagesSection = normalizedSections[pagesIndex];

    normalizedSections[pagesIndex] = {
      ...pagesSection,
      items: [...pagesSection.items, ...databaseSection.items],
      has_more: pagesSection.has_more || databaseSection.has_more,
      next_cursor: pagesSection.next_cursor ?? databaseSection.next_cursor,
      message: pagesSection.message ?? databaseSection.message,
    };
    return normalizedSections;
  }

  const insertIndex = normalizedSections.findIndex(
    (section) => mentionSectionOrder(section.kind) > mentionSectionOrder(MentionSearchSectionKind.Pages)
  );
  const pagesSection = {
    ...databaseSection,
    kind: MentionSearchSectionKind.Pages,
    title: pagesTitle,
  };

  if (insertIndex === -1) {
    return [...normalizedSections, pagesSection];
  }

  return [...normalizedSections.slice(0, insertIndex), pagesSection, ...normalizedSections.slice(insertIndex)];
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

export function getMentionSearchResultDisplayTitle(item: MentionSearchResultItem, defaultPageTitle: string) {
  const title = item.title.trim();

  if (title) return title;

  if (
    item.kind === MentionTargetKind.Page ||
    item.kind === MentionTargetKind.Database ||
    item.kind === MentionTargetKind.DatabaseRow
  ) {
    return defaultPageTitle;
  }

  return item.subtitle || item.object_id || defaultPageTitle;
}

function getDatabaseMentionPageId(item: MentionSearchResultItem, databaseViewId?: string, databaseId?: string) {
  return databaseViewId || item.object_id || databaseId;
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
      const pageId = getDatabaseMentionPageId(item, databaseMention.database_view_id, databaseMention.database_id);

      if (!pageId) return null;

      return withDisplayData(
        {
          type: MentionType.PageRef,
          page_id: pageId,
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

      if (!databaseRowMention.database_id) return null;

      return withDisplayData(
        {
          type: MentionType.PageRef,
          page_id: databaseRowMention.database_view_id,
          block_id: databaseRowMention.row_id,
          database_id: databaseRowMention.database_id,
          database_view_id: databaseRowMention.database_view_id,
          row_id: databaseRowMention.row_id,
          database_row_id: item.database_row_id ?? databaseRowMention.row_id,
          row_document_id: item.row_document_id ?? databaseRowMention.row_document_id,
        },
        item
      );
    }

    case MentionTargetKind.Date:
    case MentionTargetKind.Reminder: {
      const dateMention = mention as {
        start?: string;
        date?: string;
        end?: string;
        reminder_id?: string;
        reminder_option?: string;
        include_time?: boolean;
      };
      const date = dateMention.start ?? dateMention.date;

      if (!date) return null;

      return withDisplayData(
        {
          type: MentionType.Date,
          date,
          end: dateMention.end,
          reminder_id: dateMention.reminder_id ?? (item.kind === MentionTargetKind.Reminder ? uuidv4() : undefined),
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

function mentionPayloadString(item: MentionSearchResultItem, field: string): string | undefined {
  const value = (item.mention as unknown as Record<string, unknown>)[field];

  return typeof value === 'string' ? value : undefined;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => Boolean(value));
}

/** A page's navKey, as {@link mentionItemNavKey} gives it to the page's item. */
export function mentionPageNavKey(pageId: string): string {
  return `page:${pageId}`;
}

/**
 * A database view's navKey, as {@link mentionItemNavKey} gives it to the database's item. `-` stands
 * for an id that is not known.
 */
export function mentionDatabaseNavKey(databaseId: string | undefined, databaseViewId: string | undefined): string {
  return `database:${databaseId || '-'}:${databaseViewId || '-'}`;
}

/**
 * The section-free identity of a mention result. The same object gets the same key in every
 * section, response and merge, so the picker can keep its highlight on it, and lanes that merge
 * results later can deduplicate by it.
 *
 * Objects and links use the cross-client format proposed for MEN-X-02: `person:<person_id>`,
 * `page:<page_id>`, `database:<database_id>:<database_view_id|->`, `row:<database_id>:<row_id>`
 * and `link:<url>`. Date and reminder quick picks have no object id and a time computed per
 * request ("Reminder 1 week"), so they use their kind and title, for example `date:Today`.
 */
export function mentionItemNavKey(item: MentionSearchResultItem): string {
  const payload = (field: string) => mentionPayloadString(item, field);

  switch (item.kind) {
    case MentionTargetKind.Person:
      return `person:${firstNonEmpty(payload('person_id'), item.object_id) ?? item.title}`;
    case MentionTargetKind.Page:
      return mentionPageNavKey(firstNonEmpty(payload('page_id'), item.object_id) ?? item.title);
    case MentionTargetKind.Database:
      return mentionDatabaseNavKey(
        firstNonEmpty(payload('database_id'), item.database_id, item.object_id),
        firstNonEmpty(payload('database_view_id'), item.database_view_id)
      );

    case MentionTargetKind.DatabaseRow: {
      const databaseId = firstNonEmpty(payload('database_id'), item.database_id) ?? '-';
      const rowId = firstNonEmpty(payload('row_id'), item.database_row_id, item.object_id) ?? '-';

      return `row:${databaseId}:${rowId}`;
    }

    case MentionTargetKind.ExternalLink:
      return `link:${firstNonEmpty(payload('url')) ?? item.title}`;
    default:
      return `${item.kind}:${item.title}`;
  }
}

/**
 * Flattens picker sections into selectable results. A key holds the section kind and the item's
 * navKey but no position, so results that merge in later (typed rows, a cache refresh) never
 * re-key the options already on screen. Only a real duplicate inside one section gets an
 * occurrence suffix (`#2`, `#3`, …).
 */
export function flattenMentionSearchSections(sections: MentionSearchSection[]): MentionPanelSearchResult[] {
  const occurrences = new Map<string, number>();

  return sections.flatMap((section, sectionIndex) =>
    section.items.flatMap((item) => {
      const mention = mentionSearchItemToMention(item);

      if (!mention) return [];

      const navKey = mentionItemNavKey(item);
      const baseKey = `${section.kind}|${navKey}`;
      const occurrence = (occurrences.get(baseKey) ?? 0) + 1;

      occurrences.set(baseKey, occurrence);

      return [
        {
          key: occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`,
          navKey,
          item,
          mention,
          sectionKind: section.kind,
          sectionIndex,
        },
      ];
    })
  );
}

/** The highlighted picker option, held by key so that a merge cannot move it onto another item. */
export interface MentionOptionSelection {
  key: string;
  /** The highlighted item's navKey, used to find the same object again in another section. */
  navKey?: string;
}

const DATABASE_NAV_KEY = /^database:([^:]+):([^:]+)$/;

/**
 * Whether two navKeys name one database and exactly one of them lacks its view
 * (`database:<id>:-`): a database the client knows only by its id, as one this tab just created
 * until the outline lists its views, and an item that names a view of it, as the server's item that
 * the local lane merges it with. Two known views of a database are two objects.
 */
function isSameDatabaseOneViewUnknown(left: string, right: string): boolean {
  const [, leftDatabase, leftView] = DATABASE_NAV_KEY.exec(left) ?? [];
  const [, rightDatabase, rightView] = DATABASE_NAV_KEY.exec(right) ?? [];

  return (
    leftDatabase !== undefined &&
    leftDatabase !== '-' &&
    leftDatabase === rightDatabase &&
    (leftView === '-') !== (rightView === '-')
  );
}

/**
 * Re-resolves the highlight after the option list changed. It stays on the same option while its
 * key is listed, else moves to the same object in another section, or to the same database once
 * its view is known (or no longer), else to the first option. Returns `selection` itself when
 * nothing changed.
 */
export function reconcileMentionOptionSelection(
  selection: MentionOptionSelection | null,
  options: readonly MentionOptionSelection[]
): MentionOptionSelection | null {
  if (!selection || options.some((option) => option.key === selection.key)) return selection;

  const { navKey } = selection;
  const sameObject =
    navKey === undefined
      ? undefined
      : options.find((option) => option.navKey === navKey) ??
        options.find((option) => option.navKey !== undefined && isSameDatabaseOneViewUnknown(navKey, option.navKey));
  const next = sameObject ?? options[0];

  return next ? { key: next.key, navKey: next.navKey } : null;
}

function normalizeOptionalString(value?: string | null) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function normalizeStringList(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort();
}

/**
 * The cache key of one request. The opt-ins it sends are part of it, so an answer a server shaped
 * for them never answers a request without them; a request that sends none keys as before.
 */
export function buildMentionSearchCacheKey(request: MentionSearchRequest) {
  const clientFeatures = normalizeStringList(request.client_features);

  return JSON.stringify({
    query: request.query?.trim().toLowerCase() ?? '',
    limit: request.limit && request.limit > 0 ? request.limit : null,
    cursor: normalizeOptionalString(request.cursor),
    include: normalizeStringList(request.include),
    context: {
      view_id: normalizeOptionalString(request.context?.view_id),
      database_id: normalizeOptionalString(request.context?.database_id),
      database_view_id: normalizeOptionalString(request.context?.database_view_id),
      row_id: normalizeOptionalString(request.context?.row_id),
    },
    filter: {
      database_ids: normalizeStringList(request.filter?.database_ids),
      database_view_ids: normalizeStringList(request.filter?.database_view_ids),
      database_row_ids: normalizeStringList(request.filter?.database_row_ids),
    },
    ...(clientFeatures.length > 0 ? { client_features: clientFeatures } : {}),
  });
}

interface MentionSearchCacheScope {
  workspaceId?: string | null;
  userId?: string | null;
}

/** The workspace and user a cache entry belongs to, as the first line of its cache key. */
export function buildMentionSearchCacheScopeKey(scope: MentionSearchCacheScope = {}) {
  return JSON.stringify({
    workspace_id: normalizeOptionalString(scope.workspaceId),
    user_id: normalizeOptionalString(scope.userId),
  });
}

/** Whether the request asks for database rows only, as the typed rows request does. */
export function isDatabaseRowOnlyMentionRequest(request: MentionSearchRequest) {
  const include = request.include ?? [];

  return include.length === 1 && include[0] === MentionTargetKind.DatabaseRow;
}

export interface MentionSearchRequestsOptions {
  /**
   * Leave the typed rows request out, as when the picker matches every row of the database it is in
   * itself (MEN-WEB-15). The primary request still asks for no rows, so the server sends none.
   */
  skipRows?: boolean;
}

/**
 * The requests a picker request is sent as: a bare `@` as one request without database rows, a typed
 * one as the primary request for every other kind and a rows-only request, filtered to the database
 * of a database context, unless `options.skipRows` leaves that one out (and a primary one remains).
 */
export function buildMentionSearchRequests(
  request: MentionSearchRequest,
  options: MentionSearchRequestsOptions = {}
): MentionSearchRequest[] {
  const query = request.query?.trim() ?? '';
  const include = request.include ?? [];
  const includesDatabaseRows = include.length === 0 || include.includes(MentionTargetKind.DatabaseRow);

  if (!query) {
    // The picker never shows database rows for an empty query, so it does not ask for them. An
    // empty include means every kind, and is left to the server.
    const bareInclude = include.filter((kind) => kind !== MentionTargetKind.DatabaseRow);
    const dropsRows = bareInclude.length > 0 && bareInclude.length < include.length;

    return [dropsRows ? { ...request, include: bareInclude } : request];
  }

  if (!includesDatabaseRows) {
    return [request];
  }

  const primaryInclude =
    include.length > 0
      ? include.filter((kind) => kind !== MentionTargetKind.DatabaseRow)
      : ALL_MENTION_TARGETS_EXCEPT_DATABASE_ROWS;
  const primary = primaryInclude.length > 0 ? [{ ...request, include: primaryInclude }] : [];

  // A picker that asks for rows alone keeps its request: without it, it would send nothing.
  if (options.skipRows && primary.length > 0) return primary;

  return [
    ...primary,
    withDatabaseRowSearchFilter({
      ...request,
      include: [MentionTargetKind.DatabaseRow],
    }),
  ];
}

export function buildMentionSearchRequestsCacheKey(
  requests: MentionSearchRequest[],
  scope: MentionSearchCacheScope = {}
) {
  return [buildMentionSearchCacheScopeKey(scope), ...requests.map(buildMentionSearchCacheKey)].join('\n');
}

/** The section status a server sends when the section's source failed. Such a section has no items. */
export const MENTION_SECTION_STATUS_FAILED = 'failed';
/** The section status of an incomplete keyword result, or of People whose access lookup degraded. */
export const MENTION_SECTION_STATUS_PARTIAL = 'partial';

/** Whether the server reports that one of the response's sections failed. */
export function hasFailedMentionSection(response: MentionSearchResponse) {
  return response.sections.some((section) => section.status === MENTION_SECTION_STATUS_FAILED);
}

function requestIncludes(request: MentionSearchRequest, kind: MentionTargetKind) {
  const include = request.include ?? [];

  return include.length === 0 || include.includes(kind);
}

/**
 * Whether `response` has the shape of an answer to a request that Search superseded: partial, and
 * without any section of an object kind the request asked for. Search answers a superseded request
 * with no sections, and Cloud adds only its own People, Dates and Links sections. A partial answer
 * usually has such a section: a degraded or failed object search adds a failed one, and load-shed
 * paths come with items. A primary or bare answer can still have the shape without being
 * superseded: Cloud marks it partial when the People annotation degrades, and Search leaves out an
 * empty Pages section when no object matched.
 */
export function isSupersededMentionResponse(request: MentionSearchRequest, response: MentionSearchResponse) {
  if (response.partial !== true) return false;

  const objectKinds = new Set<MentionSearchSectionKind>();

  // Search returns database rows inside the Pages section; Cloud fails them as a rows section.
  if (requestIncludes(request, MentionTargetKind.Page) || requestIncludes(request, MentionTargetKind.DatabaseRow)) {
    objectKinds.add(MentionSearchSectionKind.Pages);
    objectKinds.add(MentionSearchSectionKind.DatabaseRows);
  }

  if (requestIncludes(request, MentionTargetKind.Database)) {
    objectKinds.add(MentionSearchSectionKind.Databases);
  }

  return objectKinds.size > 0 && !response.sections.some((section) => objectKinds.has(section.kind));
}

/**
 * Whether a response is the server's complete answer, as far as showing it goes: no section failed,
 * and a rows-only request was not superseded. `partial` alone, as when breadcrumb paths were
 * load-shed or the People annotation degraded, still counts as complete. Only the rows-only shape is
 * unambiguous, since Cloud adds no section of its own to that request. The panel aborts its own
 * superseded primary and bare requests, so their shape almost always means a degraded People
 * annotation over objects that matched nothing, which is shown as it is.
 */
export function isCompleteMentionResponse(request: MentionSearchRequest, response: MentionSearchResponse) {
  if (hasFailedMentionSection(response)) return false;

  return !isDatabaseRowOnlyMentionRequest(request) || !isSupersededMentionResponse(request, response);
}

/**
 * Whether a response may be cached: no section failed, and it does not have the superseded shape,
 * whatever the request. A primary or bare answer of that shape is shown, but sent again next time,
 * so that an answer that may lack its objects is never kept. A request that sent `client_features`
 * opted in to degraded answers, which Cloud marks `partial`, so neither a `partial` answer nor one
 * with a `partial` section is kept for it (Cloud's client opt-ins, MEN-CLOUD-12).
 */
export function isCacheableMentionResponse(request: MentionSearchRequest, response: MentionSearchResponse) {
  if (hasFailedMentionSection(response) || isSupersededMentionResponse(request, response)) return false;
  if (!request.client_features?.length) return true;

  return (
    response.partial !== true && !response.sections.some((section) => section.status === MENTION_SECTION_STATUS_PARTIAL)
  );
}

/**
 * Whether the rows-only request deserves its one retry: the server reported a failure it expects a
 * retry to fix (a failed section with `partial`), or superseded the request. A failed section
 * without `partial` is permanent, as when the keyword index is disabled, and is never retried.
 */
export function shouldRetryMentionRowsResponse(request: MentionSearchRequest, response: MentionSearchResponse) {
  return (
    (hasFailedMentionSection(response) && response.partial === true) || isSupersededMentionResponse(request, response)
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
