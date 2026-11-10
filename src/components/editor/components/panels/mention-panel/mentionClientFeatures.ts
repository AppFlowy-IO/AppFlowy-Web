/**
 * The mention search opt-ins the editor's @ picker sends (MEN-WEB-09), in the request's
 * `client_features`. Cloud lists the opt-ins it accepts in `ServerInfo.mention_features`
 * (MEN-CLOUD-12, -13) and serves one only when a request names it and the workspace's rollout flag
 * for it is on; otherwise it answers byte for byte as if the request named nothing. Released servers
 * advertise none, and ignore the field anyway.
 *
 * - `section_degradation_v1`: a roster refresh or a database restore fails its sections (People, or
 *   Databases and Database rows) in a 200 marked `partial`, instead of a RetryLater for the whole
 *   answer; a degraded access lookup marks People `partial`.
 * - `typeahead_deadline_v1`: a typed query's sources answer within short deadlines; a late one
 *   answers a failed section, and the answer is `partial`. A bare `@` is never served it.
 *
 * Both oblige the client to keep handling RetryLater and never to cache a `partial` answer or one
 * with a `failed` or `partial` section (`isCacheableMentionResponse`). The picker already shows a
 * failed section's kinds as missing, with the local lane and the "unavailable, retry" row.
 *
 * The picker sends them only with its `mentionTypeaheadV2` switch on, and only the ones the server
 * advertises: a request to a server that advertises none carries no `client_features`, so it is the
 * request released Web sends.
 */
import { getServerInfoSnapshot, type ServerInfoState } from '@/utils/server-info';

/** Failed or partial sections instead of a RetryLater for the whole answer. */
export const MENTION_FEATURE_SECTION_DEGRADATION_V1 = 'section_degradation_v1';
/** Short per-source deadlines on typed queries; a late source answers a failed section. */
export const MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1 = 'typeahead_deadline_v1';

/** The opt-ins this client handles, in the order it sends them (sorted, as cache keys read them). */
export const WEB_MENTION_CLIENT_FEATURES: readonly string[] = Object.freeze([
  MENTION_FEATURE_SECTION_DEGRADATION_V1,
  MENTION_FEATURE_TYPEAHEAD_DEADLINE_V1,
]);

const NO_FEATURES: readonly string[] = Object.freeze([]);

/**
 * The opt-ins a request to this server carries: those {@link WEB_MENTION_CLIENT_FEATURES} lists that
 * the server advertises in `mention_features`. None while server info is loading, failed, or from a
 * server that advertises nothing.
 */
export function mentionClientFeatures(serverInfo: ServerInfoState = getServerInfoSnapshot()): readonly string[] {
  const advertised: unknown = serverInfo.status === 'available' ? serverInfo.info.mention_features : undefined;

  if (!Array.isArray(advertised)) return NO_FEATURES;

  const features = WEB_MENTION_CLIENT_FEATURES.filter((feature) => advertised.includes(feature));

  return features.length > 0 ? features : NO_FEATURES;
}
