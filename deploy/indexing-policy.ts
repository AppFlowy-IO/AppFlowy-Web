/**
 * Decides, per request, whether a published page is server-rendered and
 * whether it may be indexed.
 *
 * This is the only place that decision is made. Routes and HTML rendering read
 * the returned decision and never re-derive it, so the policy can be reviewed
 * and tested in isolation.
 *
 * Default is `shell` with no robots directives: byte-for-byte the response
 * published pages had before SSR existed. Publishers made their pages public
 * under that behaviour, so nothing changes for them until someone opts in.
 */

import { APP_PATHS } from './app-paths';

export type PublishRenderMode =
  // Head-only HTML with an empty body. THE DEFAULT.
  | 'shell'
  // Full server-rendered body, indexable.
  | 'ssr-indexable'
  // Full server-rendered body with noindex. Supported by the renderer but no
  // input produces it yet; it lets indexing be decoupled from rendering later.
  | 'ssr-noindex';

export type IndexingDecisionReason =
  | 'reserved_namespace'
  | 'kill_switch'
  | 'publisher_opted_out'
  | 'publisher_opted_in'
  | 'namespace_allowlist'
  | 'default_off';

export interface IndexingDecision {
  mode: PublishRenderMode;
  /** Machine-readable cause, for logs and tests. */
  reason: IndexingDecisionReason;
  /**
   * Robots directive to send as both `X-Robots-Tag` and `<meta name="robots">`,
   * or null to send neither.
   */
  robots: string | null;
}

export interface ResolvePublishRenderModeInput {
  namespace: string;
  publishName?: string;
  /**
   * The `config` object from the published-metadata response, if any. Typed as
   * unknown because AppFlowy-Cloud does not send it yet and it arrives as
   * untrusted JSON either way.
   */
  publishConfig?: unknown;
  env: NodeJS.ProcessEnv;
}

export const NOINDEX_DIRECTIVE = 'noindex, nofollow, noarchive, nosnippet';

// Publish namespaces are the first path segment, so a namespace equal to an
// app path segment ("app", "login", ...) would be the authenticated app. Route
// order already sends those to the bare shell before the publish route runs;
// this list makes the policy refuse them too, independently of route order.
const RESERVED_NAMESPACES = new Set(APP_PATHS.map((appPath) => appPath.replace(/^\//, '')));

const KILL_SWITCH_ON_VALUES = new Set(['true', '1', 'yes', 'on']);

/**
 * Reads `APPFLOWY_SSR_KILL_SWITCH`.
 *
 * @param env - The process environment.
 * @returns true when the kill switch is set to `true`, `1`, `yes` or `on`
 *   (case-insensitive, surrounding whitespace ignored); false for anything else,
 *   including unset. Parsing is deliberately liberal: when someone reaches for
 *   the kill switch, a value like `TRUE` must not be silently ignored.
 */
export const isKillSwitchOn = (env: NodeJS.ProcessEnv): boolean =>
  KILL_SWITCH_ON_VALUES.has((env.APPFLOWY_SSR_KILL_SWITCH ?? '').trim().toLowerCase());

/**
 * Parses `APPFLOWY_INDEXABLE_NAMESPACES`.
 *
 * @param raw - Comma-separated namespace list, possibly undefined.
 * @returns The set of namespaces, each trimmed, with empty entries dropped.
 *   Matching is exact and case-sensitive, because publish namespaces are
 *   case-sensitive in the URL: allowlisting `docs` must not enable `Docs`.
 */
export const parseNamespaceAllowlist = (raw: string | undefined): Set<string> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );

/**
 * Reads the publisher's indexing choice from the published-metadata `config`.
 *
 * @param publishConfig - The untrusted `config` value from the metadata response.
 * @returns true or false only when `config.indexing_enabled` is a real boolean.
 *   Anything else — missing config, null, a string "true", 1, a malformed
 *   object — returns undefined, meaning "the publisher said nothing". A value
 *   we cannot read with certainty must never count as an opt-in.
 */
export const readPublisherIndexingFlag = (publishConfig: unknown): boolean | undefined => {
  if (typeof publishConfig !== 'object' || publishConfig === null || Array.isArray(publishConfig)) {
    return undefined;
  }

  const flag = (publishConfig as Record<string, unknown>).indexing_enabled;

  return typeof flag === 'boolean' ? flag : undefined;
};

/**
 * Decides the render mode for a published-page request.
 *
 * Precedence, first match wins:
 *   0. namespace collides with an app path → shell (`reserved_namespace`)
 *   1. kill switch on                      → shell (`kill_switch`)
 *   2. publisher flag === false            → shell + noindex (`publisher_opted_out`)
 *   3. publisher flag === true             → ssr-indexable (`publisher_opted_in`)
 *   4. namespace in allowlist              → ssr-indexable (`namespace_allowlist`)
 *   5. otherwise                           → shell (`default_off`)
 *
 * @param input - The request's namespace and publish name, the untrusted
 *   publish config from the metadata response, and the environment.
 * @returns The decision. This function never throws: every unexpected input
 *   resolves to `shell`, the least-exposing mode.
 */
export const resolvePublishRenderMode = ({
  namespace,
  publishConfig,
  env,
}: ResolvePublishRenderModeInput): IndexingDecision => {
  if (RESERVED_NAMESPACES.has(namespace)) {
    return { mode: 'shell', reason: 'reserved_namespace', robots: null };
  }

  // The kill switch is checked before anything else, including a publisher's
  // explicit opt-in, so SSR can be turned off everywhere with a single variable
  // and no other configuration.
  //
  // It emits no robots directive: flipping it must return pages to exactly
  // their pre-SSR response, not de-index them from search engines that already
  // render the client app (Googlebot does).
  if (isKillSwitchOn(env)) {
    return { mode: 'shell', reason: 'kill_switch', robots: null };
  }

  const publisherFlag = readPublisherIndexingFlag(publishConfig);

  // A publisher's explicit choice beats the operator's namespace allowlist in
  // both directions: the page owner knows whether the page is meant to be found.
  // An explicit opt-out is the one case where we actively ask for noindex,
  // because the publisher requested it.
  if (publisherFlag === false) {
    return { mode: 'shell', reason: 'publisher_opted_out', robots: NOINDEX_DIRECTIVE };
  }

  if (publisherFlag === true) {
    return { mode: 'ssr-indexable', reason: 'publisher_opted_in', robots: null };
  }

  if (parseNamespaceAllowlist(env.APPFLOWY_INDEXABLE_NAMESPACES).has(namespace)) {
    return { mode: 'ssr-indexable', reason: 'namespace_allowlist', robots: null };
  }

  // Default: today's response, with no robots directive. Adding noindex here
  // would de-index every existing customer page that search engines currently
  // find by running the client app.
  return { mode: 'shell', reason: 'default_off', robots: null };
};

/**
 * Whether a mode needs the page snapshot fetched and rendered into the body.
 *
 * @param mode - A render mode from `resolvePublishRenderMode`.
 * @returns true for the SSR modes, false for `shell`.
 */
export const modeRendersBody = (mode: PublishRenderMode): boolean => mode !== 'shell';
