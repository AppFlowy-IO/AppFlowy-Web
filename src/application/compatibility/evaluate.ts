import compare from 'semver/functions/compare';
import parse from 'semver/functions/parse';

import policy from './web-server-compatibility.json';

export type CompatibilityWarning =
  | { type: 'client-too-old'; clientVersion: string; requiredClientVersion: string; remedyReachable: boolean }
  | { type: 'server-too-old'; clientVersion: string; serverVersion: string; requiredServerVersion: string };

export type CompatibilityVerdict =
  | CompatibilityWarning
  | { type: 'compatible' }
  | { type: 'unknown'; reason: 'client-version' | 'server-version' };

/** Match desktop's normalization without flattening real SemVer prereleases. */
export function normalizeVersion(raw?: string) {
  if (typeof raw !== 'string') return null;

  const version = parse(raw.trim().replace(/^[vV]/, ''));

  if (!version) return null;
  if (['premium', 'stateless', 'pubsub', 'migrate-af-collab'].includes(version.prerelease.join('.'))) {
    version.prerelease = [];
  }

  version.build = [];
  version.format();
  return version;
}

function minimumServerVersion(client: string) {
  return [...policy.rows].reverse().find((row) => compare(client, row.client_from) >= 0)?.min_server ?? '0.0.0';
}

/** Installed-client check only; web has no desktop appcast or native updater. */
export function evaluateCompatibility({
  clientVersion,
  serverVersion,
  minClientVersion,
}: {
  clientVersion: string;
  serverVersion?: string;
  minClientVersion?: string;
}): CompatibilityVerdict {
  const client = normalizeVersion(clientVersion);
  const server = normalizeVersion(serverVersion);
  const requiredClient = normalizeVersion(minClientVersion);

  if (!client) return { type: 'unknown', reason: 'client-version' };

  // The server's client floor dominates, including contradictory deployments.
  // Missing, malformed and above-clamp requirements cannot deprecate a client.
  if (
    requiredClient &&
    compare(client, requiredClient) < 0 &&
    compare(requiredClient, policy.max_enforceable_client_floor) <= 0
  ) {
    return {
      type: 'client-too-old',
      clientVersion: client.version,
      requiredClientVersion: requiredClient.version,
      remedyReachable: !server || compare(server, minimumServerVersion(requiredClient.version)) >= 0,
    };
  }

  if (!server) return { type: 'unknown', reason: 'server-version' };

  const requiredServerVersion = minimumServerVersion(client.version);

  return compare(server, requiredServerVersion) >= 0
    ? { type: 'compatible' }
    : { type: 'server-too-old', clientVersion: client.version, serverVersion: server.version, requiredServerVersion };
}

export function isCompatibilityWarning(verdict: CompatibilityVerdict): verdict is CompatibilityWarning {
  return verdict.type === 'client-too-old' || verdict.type === 'server-too-old';
}

export interface BannerSession {
  serverUrl: string;
  demand?: string;
  dismissed: boolean;
}

/** Preserve dismissal through outages, but reset it when a known requirement changes. */
export function updateBannerSession(
  previous: BannerSession,
  verdict: CompatibilityVerdict,
  rawServerUrl: string
): BannerSession {
  const serverUrl = rawServerUrl.trim().toLowerCase().replace(/\/+$/, '');
  const session = previous.serverUrl === serverUrl ? previous : { serverUrl, dismissed: false };

  if (verdict.type === 'unknown') return session;

  const demand = isCompatibilityWarning(verdict)
    ? JSON.stringify([
        verdict.type,
        verdict.type === 'client-too-old' ? verdict.requiredClientVersion : verdict.requiredServerVersion,
        verdict.type === 'client-too-old' && verdict.remedyReachable,
      ])
    : undefined;

  return session.demand === demand ? session : { serverUrl, demand, dismissed: false };
}
