import axios from 'axios';

import { getServerInfoSnapshot, type ServerInfoState } from '@/utils/server-info';

import { getAxios } from './core';

/**
 * The `ServerInfo.mention_features` value of a server that counts mention picker sessions (Cloud
 * `MENTION_FEATURE_SESSION_METRICS_V1`). Reports go only to a server that lists it.
 */
export const MENTION_FEATURE_SESSION_METRICS_V1 = 'session_metrics_v1';

/** The longest duration a report may carry, in milliseconds; Cloud refuses a report above it. */
export const MENTION_SESSION_MAX_MS = 600_000;
/** The deepest selected position a report may carry. */
export const MENTION_SESSION_MAX_RANK = 1_000;
/** The most requests a report may count. */
export const MENTION_SESSION_MAX_REQUESTS = 1_000;
// Cloud counts every query length from 7 as `7+`, so longer ones are sent as this.
const MENTION_SESSION_MAX_QUERY_LENGTH = 1_000;

const MENTION_SESSION_TIMEOUT_MS = 3_000;

// The vocabularies of Cloud's collector (`api/metrics/search/mention_client.rs`). A value outside
// them is never sent: Cloud would count it as `other`, and it could carry text the user typed.
const TRIGGERS = ['at', 'plus', 'page_link'] as const;
const OUTCOMES = ['selected', 'dismissed', 'error'] as const;
const SECTIONS = ['suggested', 'people', 'pages', 'databases', 'database_rows', 'dates', 'links'] as const;
const SOURCES = ['server', 'cache', 'local'] as const;
const TIERS = ['exact', 'prefix', 'word_start', 'substring', 'body'] as const;

/** What opened the picker: '@', '+' or '[['. */
export type MentionSessionTrigger = (typeof TRIGGERS)[number];
/**
 * How the session ended: an item was inserted, the picker closed without one, or it closed while
 * it could not show results.
 */
export type MentionSessionOutcome = (typeof OUTCOMES)[number];
/** The serialized `MentionSearchSectionKind` of the section that showed the selected item. */
export type MentionSessionSection = (typeof SECTIONS)[number];
/** Where the selected item came from: a server answer, a cached one, or a client-only lane. */
export type MentionSessionSource = (typeof SOURCES)[number];
/** How the selected item's title matched the query. */
export type MentionSessionTier = (typeof TIERS)[number];

/**
 * One closed mention picker session, as `POST /api/workspace/{workspace_id}/mentions/metrics`
 * takes it (Cloud `MentionPickerSessionReport`, `appflowy-entity` `mention_dto/session_report.rs`).
 * Field names and values are the server's. A report carries no query text and no object,
 * workspace or account identity. Times are whole milliseconds from the trigger.
 */
export interface MentionPickerSessionReport {
  client: 'web';
  trigger: MentionSessionTrigger;
  outcome: MentionSessionOutcome;
  /** Characters typed after the trigger when the session ended; Cloud counts a bucket. */
  query_len: number;
  /** The selected item's 1-based position among the results on screen, across sections. */
  selected_rank?: number;
  selected_section?: MentionSessionSection;
  selected_source?: MentionSessionSource;
  selected_tier?: MentionSessionTier;
  /** From the trigger to the first rendered list with at least one item. */
  time_to_first_paint_ms?: number;
  /** From the trigger to the selection. */
  time_to_select_ms?: number;
  /** From the trigger to the first server answer the list showed. */
  server_ms?: number;
  /** Mention search requests the session sent. */
  requests_sent: number;
  /** Requests of `requests_sent` that the session aborted while they were pending. */
  requests_aborted: number;
  /** Whether the picker showed an empty result at some point. */
  zero_result_shown: boolean;
}

/** A session as the picker describes it. The reporter adds `client` and checks every value. */
export type MentionPickerSession = Omit<MentionPickerSessionReport, 'client'>;

/**
 * - `sent`: the server took the report.
 * - `refused`: the server answered with an AppResponse error inside HTTP 200 (not a member, or
 *   numbers no session produces).
 * - `skipped`: nothing was sent: the server does not advertise `session_metrics_v1`, reports are
 *   off for this tab, there is no API client, or the session is not one to report.
 * - `failed`: the request failed. After a 404 the tab sends no more reports.
 */
export type MentionSessionReportResult = 'sent' | 'refused' | 'skipped' | 'failed';

// Set by a 404: the server advertises the feature but lacks the route, as after a rollback.
let disabledForTab = false;

function isOneOf<T extends string>(vocabulary: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value);
}

/** A count as a whole number from 0 to `max`. */
function boundedCount(value: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : 0;
}

/** A duration as whole milliseconds, or nothing when no session can take that long. */
function boundedDuration(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;

  const milliseconds = Math.round(value);

  return milliseconds <= MENTION_SESSION_MAX_MS ? milliseconds : undefined;
}

function boundedRank(value: number | undefined) {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= MENTION_SESSION_MAX_RANK
    ? value
    : undefined;
}

/**
 * The body a report sends, or nothing when the session is not one to report. Only the report's
 * own fields are copied. A label outside its vocabulary is left out, and the selection fields are
 * sent only for a selection. Numbers are whole and within the bounds Cloud accepts, so the server
 * never refuses a report for them.
 */
export function mentionPickerSessionPayload(session: MentionPickerSession): MentionPickerSessionReport | undefined {
  const { trigger, outcome } = session;

  if (!isOneOf(TRIGGERS, trigger) || !isOneOf(OUTCOMES, outcome)) return undefined;

  const requestsSent = boundedCount(session.requests_sent, MENTION_SESSION_MAX_REQUESTS);
  const payload: MentionPickerSessionReport = {
    client: 'web',
    trigger,
    outcome,
    query_len: boundedCount(session.query_len, MENTION_SESSION_MAX_QUERY_LENGTH),
    requests_sent: requestsSent,
    requests_aborted: boundedCount(session.requests_aborted, requestsSent),
    zero_result_shown: session.zero_result_shown === true,
  };
  const firstPaint = boundedDuration(session.time_to_first_paint_ms);
  const server = boundedDuration(session.server_ms);

  if (firstPaint !== undefined) payload.time_to_first_paint_ms = firstPaint;
  if (server !== undefined) payload.server_ms = server;
  if (outcome !== 'selected') return payload;

  const rank = boundedRank(session.selected_rank);
  const timeToSelect = boundedDuration(session.time_to_select_ms);

  if (rank !== undefined) payload.selected_rank = rank;
  if (isOneOf(SECTIONS, session.selected_section)) payload.selected_section = session.selected_section;
  if (isOneOf(SOURCES, session.selected_source)) payload.selected_source = session.selected_source;
  if (isOneOf(TIERS, session.selected_tier)) payload.selected_tier = session.selected_tier;
  if (timeToSelect !== undefined) payload.time_to_select_ms = timeToSelect;
  return payload;
}

/** Whether the server advertises picker session reports. Loading or failed server info does not. */
export function isMentionSessionMetricsAdvertised(serverInfo: ServerInfoState = getServerInfoSnapshot()): boolean {
  const features: unknown = serverInfo.status === 'available' ? serverInfo.info.mention_features : undefined;

  return Array.isArray(features) && features.includes(MENTION_FEATURE_SESSION_METRICS_V1);
}

/** Whether a report would be sent now: advertised, and the tab has not seen the route missing. */
export function mentionSessionMetricsEnabled(serverInfo?: ServerInfoState): boolean {
  return !disabledForTab && isMentionSessionMetricsAdvertised(serverInfo);
}

/** Lets a test start with reports enabled again after a 404. */
export function resetMentionSessionMetricsForTests() {
  disabledForTab = false;
}

function isAppResponseRefusal(data: unknown) {
  if (typeof data !== 'object' || data === null) return false;

  const { code } = data as { code?: unknown };

  return typeof code === 'number' && code !== 0;
}

/**
 * Reports one closed picker session, best-effort: a single attempt with a 3 s timeout, never
 * sharing a search's cancellation signal, and only to a server that advertises
 * `session_metrics_v1`, so older servers are never called. Errors are swallowed.
 */
export async function reportMentionPickerSession(
  workspaceId: string | undefined,
  session: MentionPickerSession,
  serverInfo?: ServerInfoState
): Promise<MentionSessionReportResult> {
  const payload = mentionPickerSessionPayload(session);
  const client = getAxios();

  if (!workspaceId || !payload || !client || !mentionSessionMetricsEnabled(serverInfo)) return 'skipped';

  try {
    const response = await client.post<unknown>(
      `/api/workspace/${encodeURIComponent(workspaceId)}/mentions/metrics`,
      payload,
      {
        timeout: MENTION_SESSION_TIMEOUT_MS,
        skipTransportRetry: true,
        // Telemetry must not rotate credentials, invalidate a session, or replay a failed report.
        skipAuthRefresh: true,
      }
    );

    return isAppResponseRefusal(response?.data) ? 'refused' : 'sent';
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) disabledForTab = true;
    // Observability must never affect the picker or display a user-facing error.
    return 'failed';
  }
}
