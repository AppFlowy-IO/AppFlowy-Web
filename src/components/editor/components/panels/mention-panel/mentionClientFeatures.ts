/**
 * The mention search opt-ins the editor's @ picker sends, in the request's `client_features`. Cloud
 * lists the opt-ins it accepts in `ServerInfo.mention_features` (MEN-CLOUD-05, -12) and serves one
 * only when a request names it and the workspace's rollout flag for it is on; otherwise it answers
 * byte for byte as if the request named nothing. Released servers advertise none, and ignore the
 * field anyway. The picker sends an opt-in only while the server lists it, and only on the requests
 * that can use what it changes:
 *
 * - `section_degradation_v1` (MEN-CLOUD-12, every request of a picker with its `mentionTypeaheadV2`
 *   switch on): a roster refresh or a database restore fails its sections (People, or Databases and
 *   Database rows) in a 200 marked `partial`, instead of a RetryLater for the whole answer; a
 *   degraded access lookup marks People `partial`.
 * - `typeahead_deadline_v1` (MEN-CLOUD-13, the same requests): a typed query's sources answer within
 *   short deadlines; a late one answers a failed section, and the answer is `partial`. A bare `@` is
 *   never served it.
 * - `reasons_v1` (MEN-X-09, every request of a picker that shows the item details,
 *   `mentionItemDetails.ts`): each person, page, database and row may carry a `reason`, which the
 *   item details' chip shows when it has copy for the signal, and nothing otherwise. Without the
 *   item details the picker shows no reason, so it does not ask for them.
 * - `suggested_v1` (MEN-X-10, only the bare `@` of the `@` picker, behind the Suggested switch,
 *   {@link MENTION_SUGGESTED_DEFAULT}): the answer may start with a Suggested section of at most
 *   three items, each moved out of its own section. The picker shows it first and each item once
 *   (`withSuggestedItemsOnce`), rows included. Typed queries are never served it.
 * - `selection_memory_v1` (MEN-CLOUD-20, only typed queries, behind the selection memory switch,
 *   {@link MENTION_SELECTION_MEMORY_DEFAULT}): the user's past picks for the query order each tier
 *   on the server. Cloud lists it only where it keeps selection memory and its rollout flag is past
 *   `off`, never in a self-hosted build. The switch is on by default, so that flag decides; off, the
 *   user has declined, and the picker neither names it nor reports picks. With it on, the picker
 *   also reports each item it inserts (`mention-pick-feedback.ts`). A bare `@` is never served it.
 *
 * The degradation opt-ins oblige the client to keep handling RetryLater and never to cache a
 * `partial` answer or one with a `failed` or `partial` section (`isCacheableMentionResponse`). The
 * picker already shows a failed section's kinds as missing, with the local lane and the
 * "unavailable, retry" row. Every request's cache key holds the opt-ins it carries
 * (`buildMentionSearchCacheKey`), so an answer shaped for one set never answers another. A request
 * to a server that advertises none of them carries no `client_features`: it is the request released
 * Web sends.
 */
import {
  isMentionSelectionMemoryAdvertised,
  MENTION_FEATURE_SELECTION_MEMORY_V1,
} from '@/application/services/js-services/http/mention-pick-feedback';
import { MentionSearchRequest } from '@/application/types';
import { getServerInfoSnapshot, type ServerInfoState } from '@/utils/server-info';

import { isMentionFeatureAdvertised } from './mentionSearchScheduler';
import { MENTION_FEATURE_SECTION_DEGRADATION_V1, MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1 } from './mentionUtils';

export { MENTION_FEATURE_SECTION_DEGRADATION_V1, MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1 };
export { MENTION_FEATURE_SELECTION_MEMORY_V1 };

/** Ranking reasons on people, pages, databases and rows (Cloud `MENTION_FEATURE_REASONS_V1`). */
export const MENTION_FEATURE_REASONS_V1 = 'reasons_v1';
/** The Suggested section of a bare `@` (Cloud `MENTION_FEATURE_SUGGESTED_V1`). */
export const MENTION_FEATURE_SUGGESTED_V1 = 'suggested_v1';

/** The degradation opt-ins this client handles, in the order it sends them (sorted, as cache keys read them). */
export const WEB_MENTION_CLIENT_FEATURES: readonly string[] = Object.freeze([
  MENTION_FEATURE_SECTION_DEGRADATION_V1,
  MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1,
]);

/**
 * Whether a picker that opens now asks for the Suggested section, unless the browser overrides it.
 * Keep it false until Suggested's precision reaches 25% (MEN-X-10): picks from it over the openings
 * that showed it.
 */
export const MENTION_SUGGESTED_DEFAULT = false;
/** `localStorage` key that turns the Suggested opt-in on (`true`) or off (`false`). */
export const MENTION_SUGGESTED_OVERRIDE_KEY = '__mention_suggested';

/**
 * Whether a picker that opens now takes part in selection memory where the server keeps it: names
 * `selection_memory_v1` on typed queries and reports each pick. On, so the server's advertisement,
 * which follows its rollout flag, decides, as MEN-CLOUD-20 plans for hosted. Cloud keeps no opt-out
 * of its own: a user who declines is one whose client sends neither. No user-facing setting writes
 * this switch yet; MEN-CLOUD-20's privacy review decides one.
 */
export const MENTION_SELECTION_MEMORY_DEFAULT = true;
/** `localStorage` key that turns selection memory off (`false`) or on (`true`) for this browser. */
export const MENTION_SELECTION_MEMORY_OVERRIDE_KEY = '__mention_selection_memory';

const NO_FEATURES: readonly string[] = Object.freeze([]);

/** The browser's `true` or `false` for `key`, else `fallback`, also when storage cannot be read. */
function readSwitch(key: string, fallback: boolean): boolean {
  try {
    const value = typeof window === 'undefined' ? null : window.localStorage?.getItem(key) ?? null;

    return value === 'true' ? true : value === 'false' ? false : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Whether a picker that opens now asks for the Suggested section: {@link MENTION_SUGGESTED_DEFAULT}
 * unless the browser overrides it, with or without the picker's v2. Storage that cannot be read
 * gives the default.
 */
export function readMentionSuggestedEnabled(): boolean {
  return readSwitch(MENTION_SUGGESTED_OVERRIDE_KEY, MENTION_SUGGESTED_DEFAULT);
}

/**
 * Whether a picker that opens now takes part in selection memory:
 * {@link MENTION_SELECTION_MEMORY_DEFAULT} unless the browser overrides it, with or without the
 * picker's v2. Storage that cannot be read gives the default. Off, typed queries do not name
 * `selection_memory_v1` and no pick is reported, whatever the server advertises.
 */
export function readMentionSelectionMemoryEnabled(): boolean {
  return readSwitch(MENTION_SELECTION_MEMORY_OVERRIDE_KEY, MENTION_SELECTION_MEMORY_DEFAULT);
}

/**
 * The degradation opt-ins a v2 picker's requests to this server carry: those
 * {@link WEB_MENTION_CLIENT_FEATURES} lists that the server advertises in `mention_features`. None
 * while server info is loading, failed, or from a server that advertises nothing.
 */
export function mentionClientFeatures(serverInfo: ServerInfoState = getServerInfoSnapshot()): readonly string[] {
  const features = WEB_MENTION_CLIENT_FEATURES.filter((feature) => isMentionFeatureAdvertised(feature, serverInfo));

  return features.length > 0 ? features : NO_FEATURES;
}

/** What a picker that opens now can use of what the opt-ins change. */
export interface MentionPickerFeatureSettings {
  /** The picker's v2 is on: it handles failed and `partial` sections (the degradation opt-ins). */
  degradedAnswers: boolean;
  /** The item details are on: they show reasons (`reasons_v1`). */
  reasons: boolean;
  /** The Suggested switch is on, and the picker is the `@` one (`suggested_v1` on its bare `@`). */
  suggested: boolean;
  /**
   * The selection memory switch is on (`selection_memory_v1` on typed queries). The picker reports
   * picks only with it on, so a user who declines sends neither.
   */
  selectionMemory: boolean;
}

/** The opt-ins of one picker opening, by the requests that carry them. */
export interface MentionPickerClientFeatures {
  /** Every request: the bare `@`, and a typed query's primary and rows requests. */
  readonly every: readonly string[];
  /** Only the bare `@` request. */
  readonly bare: readonly string[];
  /** Only a typed query's requests. */
  readonly typed: readonly string[];
}

/** No opt-in on any request: a closed picker, or one without server search. */
export const NO_MENTION_PICKER_CLIENT_FEATURES: MentionPickerClientFeatures = Object.freeze({
  every: NO_FEATURES,
  bare: NO_FEATURES,
  typed: NO_FEATURES,
});

/**
 * The opt-ins a picker opening sends to this server, by request (see the module header): each only
 * while the server advertises it, the degradation opt-ins with the picker's v2, `reasons_v1` with
 * the item details, `suggested_v1` on the bare `@` with the Suggested switch, and
 * `selection_memory_v1` on typed queries with the selection memory switch. Loading or failed server
 * info, and a server that advertises nothing, give none.
 */
export function mentionPickerClientFeatures(
  settings: MentionPickerFeatureSettings,
  serverInfo: ServerInfoState = getServerInfoSnapshot()
): MentionPickerClientFeatures {
  const every = [
    ...(settings.degradedAnswers ? mentionClientFeatures(serverInfo) : NO_FEATURES),
    ...(settings.reasons && isMentionFeatureAdvertised(MENTION_FEATURE_REASONS_V1, serverInfo)
      ? [MENTION_FEATURE_REASONS_V1]
      : NO_FEATURES),
  ];
  const bare =
    settings.suggested && isMentionFeatureAdvertised(MENTION_FEATURE_SUGGESTED_V1, serverInfo)
      ? [MENTION_FEATURE_SUGGESTED_V1]
      : NO_FEATURES;
  const typed =
    settings.selectionMemory && isMentionSelectionMemoryAdvertised(serverInfo)
      ? [MENTION_FEATURE_SELECTION_MEMORY_V1]
      : NO_FEATURES;

  if (every.length === 0 && bare.length === 0 && typed.length === 0) return NO_MENTION_PICKER_CLIENT_FEATURES;
  return { every, bare, typed };
}

/**
 * `request` with the opt-ins of its lane: every request's, then the bare `@`'s for an empty query
 * (as `buildMentionSearchRequests` tells a bare `@`) or a typed query's. `client_features` lists them
 * sorted, and is left out when there are none, so the request is then the one released Web sends.
 */
export function withMentionClientFeatures(
  request: MentionSearchRequest,
  features: MentionPickerClientFeatures
): MentionSearchRequest {
  const lane = request.query?.trim() ? features.typed : features.bare;
  const sent = Array.from(new Set([...features.every, ...lane])).sort();
  const { client_features: _replaced, ...rest } = request;

  return sent.length > 0 ? { ...rest, client_features: sent } : rest;
}
