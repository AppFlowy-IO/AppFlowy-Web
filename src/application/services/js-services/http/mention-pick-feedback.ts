import axios from 'axios';

import { MentionSearchResultItem, MentionTargetKind } from '@/application/types';
import { boundMentionText, countCodePoints, normalizeMentionText } from '@/utils/normalize-text';
import { getServerInfoSnapshot, type ServerInfoState } from '@/utils/server-info';

import { getAxios } from './core';

/**
 * The `ServerInfo.mention_features` value of a server that keeps selection memory (Cloud
 * `MENTION_FEATURE_SELECTION_MEMORY_V1`, MEN-CLOUD-20). Cloud lists it only where it keeps the
 * memory and its rollout flag is past `off`, never in a self-hosted build. Picks are reported only
 * to a server that lists it. The @ picker names it in typed queries' `client_features`, and reports
 * picks, only while its selection memory switch is on (`mentionClientFeatures.ts`): a user who
 * declines sends neither.
 */
export const MENTION_FEATURE_SELECTION_MEMORY_V1 = 'selection_memory_v1';

/** The deepest position a report may carry (Cloud `MENTION_PICK_MAX_POSITION`). */
export const MENTION_PICK_MAX_POSITION = 1_000;
/** The longest query a report may count (Cloud `MENTION_PICK_MAX_QUERY_LEN`). */
export const MENTION_PICK_MAX_QUERY_LEN = 1_000;

const MENTION_PICK_TIMEOUT_MS = 3_000;

/** The kinds a pick can name: those with an object (Cloud `MentionPickFeedback::target`). */
const PICK_KINDS = [
  MentionTargetKind.Person,
  MentionTargetKind.Page,
  MentionTargetKind.Database,
  MentionTargetKind.DatabaseRow,
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One item the user inserted from the @ picker, as
 * `POST /api/workspace/{workspace_id}/mentions/feedback` takes it (Cloud `MentionPickFeedback`,
 * `appflowy-entity` `mention_dto/pick_feedback.rs`). It carries no query text, title or name: the
 * server accepts a pick only when one of its own answers of the last minute served the item to the
 * same user, and learns from that answer what was typed. Cloud's optional `request_id` is not sent,
 * since Cloud does not expose the search response's `x-request-id` header to another origin.
 */
export interface MentionPickFeedback {
  /** The item's `kind`, as servers send it. */
  target_kind: (typeof PICK_KINDS)[number];
  /** The item's `object_id`. */
  target_id: string;
  /** The item's 1-based position among the results on screen, across sections. */
  position?: number;
  /**
   * Characters typed after the trigger, counted after the typeahead contract's normalization, as
   * Cloud counts the query of the answer it joins the pick to; 0 for a bare `@`.
   */
  query_len?: number;
}

/** A pick as the picker describes it. The reporter keeps only what {@link MentionPickFeedback} sends. */
export interface MentionPick {
  /** The inserted item, as the server listed it. */
  item: Pick<MentionSearchResultItem, 'kind' | 'object_id'>;
  /** Its 1-based position among the results on screen, across sections. */
  position?: number;
  /** What was typed after the trigger. Only its length leaves the tab. */
  query: string;
}

/**
 * - `sent`: the server took the report (204), whether or not it keeps the pick.
 * - `refused`: the server answered with an AppResponse error inside HTTP 200 (not a member, or a
 *   value no pick produces).
 * - `skipped`: nothing was sent: the server does not advertise `selection_memory_v1`, reports are
 *   off for this tab, there is no API client or workspace, or the item names no object.
 * - `failed`: the request failed. After a 404 the tab reports no more picks.
 */
export type MentionPickFeedbackResult = 'sent' | 'refused' | 'skipped' | 'failed';

// Set by a 404: the server advertises the feature but lacks the route, as after a rollback.
let disabledForTab = false;

function isPickKind(kind: unknown): kind is MentionPickFeedback['target_kind'] {
  return (PICK_KINDS as readonly unknown[]).includes(kind);
}

/**
 * The body a pick sends, or nothing when the item names no object a pick can have: a person, page,
 * database or row with a UUID `object_id`. Dates, reminders, links and items without an id have
 * none. The position is sent only when it is a whole number from 1 to
 * {@link MENTION_PICK_MAX_POSITION}; the query becomes its length alone.
 */
export function mentionPickFeedbackPayload(pick: MentionPick): MentionPickFeedback | undefined {
  const { kind, object_id: objectId } = pick.item;

  if (!isPickKind(kind) || typeof objectId !== 'string' || !UUID.test(objectId)) return undefined;

  const payload: MentionPickFeedback = {
    target_kind: kind,
    target_id: objectId,
    query_len: Math.min(MENTION_PICK_MAX_QUERY_LEN, countCodePoints(normalizeMentionText(boundMentionText(pick.query)))),
  };
  const { position } = pick;

  if (position !== undefined && Number.isInteger(position) && position >= 1 && position <= MENTION_PICK_MAX_POSITION) {
    payload.position = position;
  }

  return payload;
}

/** Whether the server keeps selection memory. Loading or failed server info does not. */
export function isMentionSelectionMemoryAdvertised(serverInfo: ServerInfoState = getServerInfoSnapshot()): boolean {
  const features: unknown = serverInfo.status === 'available' ? serverInfo.info.mention_features : undefined;

  return Array.isArray(features) && features.includes(MENTION_FEATURE_SELECTION_MEMORY_V1);
}

/** Whether a pick would be reported now: advertised, and the tab has not seen the route missing. */
export function mentionPickFeedbackEnabled(serverInfo?: ServerInfoState): boolean {
  return !disabledForTab && isMentionSelectionMemoryAdvertised(serverInfo);
}

/** Lets a test start with reports enabled again after a 404. */
export function resetMentionPickFeedbackForTests() {
  disabledForTab = false;
}

function isAppResponseRefusal(data: unknown) {
  if (typeof data !== 'object' || data === null) return false;

  const { code } = data as { code?: unknown };

  return typeof code === 'number' && code !== 0;
}

/**
 * Reports one inserted item, fire-and-forget: a single attempt with a 3 s timeout, no transport
 * retry or authentication recovery, and only to a server that advertises `selection_memory_v1`,
 * so older servers are never called. It never rejects: the pick is already inserted, and nothing
 * here may hold or undo it.
 */
export async function reportMentionPick(
  workspaceId: string | undefined,
  pick: MentionPick,
  serverInfo?: ServerInfoState
): Promise<MentionPickFeedbackResult> {
  try {
    const client = getAxios();

    if (!workspaceId || !client || !mentionPickFeedbackEnabled(serverInfo)) return 'skipped';

    const payload = mentionPickFeedbackPayload(pick);

    if (!payload) return 'skipped';

    const response = await client.post<unknown>(
      `/api/workspace/${encodeURIComponent(workspaceId)}/mentions/feedback`,
      payload,
      {
        timeout: MENTION_PICK_TIMEOUT_MS,
        skipTransportRetry: true,
        // Feedback must not rotate credentials, invalidate a session, or replay a failed report.
        skipAuthRefresh: true,
      }
    );

    return isAppResponseRefusal(response?.data) ? 'refused' : 'sent';
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) disabledForTab = true;
    // Feedback must never affect the picker or display a user-facing error.
    return 'failed';
  }
}
