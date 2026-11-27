import { normalizeVersion } from './evaluate';
import policy from './web-server-compatibility.json';

// Embedded in the bundle: a stale browser tab must keep reporting the version it loaded.
export const WEB_CLIENT_VERSION =
  typeof __APPFLOWY_WEB_VERSION__ === 'string' ? __APPFLOWY_WEB_VERSION__ : policy.reviewed_through_client_version;

/**
 * The version a build reports where the server compares it with the minimum client version a
 * workspace enforces: `major.minor.patch`, with a pre-release if it has one. A build version of
 * another shape reports its leading numbers (`0.20.11_test` reports `0.20.11`), and one without
 * any reports `fallback`.
 */
export function reportedClientVersion(buildVersion: string, fallback: string): string {
  const version = normalizeVersion(buildVersion)?.version;

  if (version) return version;

  return /^[vV]?((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))/.exec(buildVersion.trim())?.[1] ?? fallback;
}

/**
 * What this client sends as its version on the realtime socket and with its collab writes.
 * Builds that predate it sent the constant `0.10.0` on the socket and the word `web` with the
 * writes, which is how the server recognises them.
 */
export const WEB_CLIENT_REPORTED_VERSION = reportedClientVersion(
  WEB_CLIENT_VERSION,
  policy.reviewed_through_client_version
);
