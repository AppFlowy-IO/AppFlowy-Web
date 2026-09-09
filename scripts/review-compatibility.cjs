#!/usr/bin/env node
/**
 * Advance `reviewed_through_client_version` in web-server-compatibility.json to a web release version.
 *
 * Vite refuses to build a release whose version is newer than the reviewed boundary (see
 * vite.config.ts), so every release must move it. The "Compatibility Review PR" workflow runs
 * this in CI and opens a pull request with the result. Run it locally to prepare a release:
 *
 *   node scripts/review-compatibility.cjs 0.18.1          # update the policy file
 *   node scripts/review-compatibility.cjs 0.18.1 --check  # report only, never write
 *
 * Stdout carries GitHub Actions outputs (`changed=`, `version=`, `previous=`, `min_server=`);
 * human-readable messages go to stderr. Exits non-zero when the version is invalid or when the
 * policy's `max_enforceable_client_floor` would no longer be above the reviewed version.
 */
const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.resolve(__dirname, '../src/application/compatibility/web-server-compatibility.json');

function log(message) {
  process.stderr.write(`${message}\n`);
}

function fail(message) {
  log(process.env.GITHUB_ACTIONS === 'true' ? `::error::${message}` : message);
  process.exit(1);
}

function output(name, value) {
  process.stdout.write(`${name}=${value}\n`);
}

/** Minimal SemVer parser matching how vite.config.ts and evaluate.ts normalize versions. */
function parseVersion(raw) {
  const match = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(raw ?? '').trim());

  if (!match) return null;

  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
    version: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
  };
}

function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);

  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;

  return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.main[i] !== b.main[i]) return a.main[i] < b.main[i] ? -1 : 1;
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);

  for (let i = 0; i < length; i += 1) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;

    const result = compareIdentifiers(a.prerelease[i], b.prerelease[i]);

    if (result !== 0) return result;
  }

  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const rawVersion = args.find((arg) => !arg.startsWith('--'));

  if (!rawVersion) fail('Usage: node scripts/review-compatibility.cjs <version> [--check]');

  const release = parseVersion(rawVersion);

  if (!release) fail(`"${rawVersion}" is not a release version (expected major.minor.patch).`);

  const source = fs.readFileSync(POLICY_PATH, 'utf8');
  const policy = JSON.parse(source);
  const reviewed = parseVersion(policy.reviewed_through_client_version);
  const cap = parseVersion(policy.max_enforceable_client_floor);
  const lastRow = Array.isArray(policy.rows) ? policy.rows[policy.rows.length - 1] : undefined;

  if (!reviewed || !cap || !lastRow?.min_server) fail(`${POLICY_PATH} is missing required fields.`);

  output('version', release.version);
  output('previous', reviewed.version);
  output('min_server', lastRow.min_server);

  if (compareVersions(release, reviewed) <= 0) {
    output('changed', 'false');
    log(`Already reviewed through ${reviewed.version}; nothing to do for ${release.version}.`);
    return;
  }

  if (compareVersions(release, cap) >= 0) {
    fail(
      `max_enforceable_client_floor (${cap.version}) must stay above the reviewed version. ` +
        `Raise it in web-server-compatibility.json before reviewing ${release.version}.`
    );
  }

  output('changed', 'true');

  if (checkOnly) {
    log(`reviewed_through_client_version would move ${reviewed.version} -> ${release.version} (check only).`);
    return;
  }

  const updated = source.replace(/("reviewed_through_client_version":\s*")[^"]*(")/, `$1${release.version}$2`);

  if (updated === source) fail('Could not find reviewed_through_client_version in the policy file.');

  fs.writeFileSync(POLICY_PATH, updated);
  log(`reviewed_through_client_version: ${reviewed.version} -> ${release.version}`);
}

main();
