import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Seed an active Pro subscription for the workspace owned by `email`.
 *
 * The cloud's `is_workspace_on_paid_plan` reads directly from postgres
 * (`af_workspace_subscription`), so FE-side billing mocks (see
 * `mockProSubscription` in chart-test-helpers) can't unblock the
 * server-side gate on the form-share endpoints. Tests that need the
 * mint to succeed must seed at the database level — same posture as
 * the desktop's `the_workspace_has_an_active_pro_subscription.dart`.
 *
 * Strategy mirrors the desktop helper:
 *   1. Try local psql first (dev loop). Connection details come from
 *      `APPFLOWY_DATABASE_URL` / `DATABASE_URL`, or fall back to the
 *      standard local postgres at 127.0.0.1:5432.
 *   2. On failure, retry via `docker exec` against the
 *      appflowy-cloud-premium-postgres container (CI).
 *
 * `af_workspace_subscription` is owned by the billing service, not the
 * cloud-premium migrations — `CREATE TABLE IF NOT EXISTS` makes the
 * step idempotent so the very first form scenario in a fresh stack
 * still works.
 *
 * Lookup is by `email` rather than workspace_id because freshly-
 * registered cloud users always have exactly one workspace and we don't
 * want a second round-trip to the FE just to find its id. If the email
 * happens to own multiple workspaces (it shouldn't in test scenarios),
 * all of them get seeded.
 */
export async function seedProSubscriptionForUser(email: string): Promise<void> {
  const subscriptionId = `bdd-pro-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const sql = `
    CREATE TABLE IF NOT EXISTS af_workspace_subscription (
        workspace_id    UUID NOT NULL,
        subscription_id TEXT NOT NULL,
        workspace_plan  SMALLINT NOT NULL,
        active          BOOLEAN NOT NULL DEFAULT TRUE,
        version_history_ttl_secs       INTEGER,
        version_history_ttl_expires_at TIMESTAMPTZ,
        PRIMARY KEY (workspace_id, subscription_id),
        FOREIGN KEY (workspace_id) REFERENCES af_workspace(workspace_id) ON DELETE CASCADE
    );
    INSERT INTO af_workspace_subscription
        (workspace_id, subscription_id, workspace_plan, active)
    SELECT
        w.workspace_id,
        '${subscriptionId}',
        1,
        TRUE
    FROM af_workspace w
    JOIN af_user u ON u.uid = w.owner_uid
    WHERE u.email = '${email}'
    ON CONFLICT (workspace_id, subscription_id) DO NOTHING;
  `;

  const localResult = await runPsqlLocal(sql);

  if (localResult.ok) return;

  const dockerResult = await runPsqlInDocker(sql);

  if (dockerResult.ok) return;

  throw new Error(
    `Failed to seed Pro subscription for ${email}\n` +
      `  [local]  ${localResult.error}\n` +
      `  [docker] ${dockerResult.error}`,
  );
}

type RunResult = { ok: true } | { ok: false; error: string };

async function runPsqlLocal(sql: string): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGPASSWORD: process.env.PGPASSWORD ?? 'password',
  };
  const dbUrl = process.env.APPFLOWY_DATABASE_URL ?? process.env.DATABASE_URL;
  // When a URL is provided psql treats the first positional as the
  // conninfo string; otherwise the explicit host/user/port flags below
  // hit the standard local postgres the appflowy stack starts with
  // `docker-compose up -d postgres`.
  const args = dbUrl
    ? [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql]
    : [
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-p',
        '5432',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ];

  try {
    await execFileAsync('psql', args, { env });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };

    return {
      ok: false,
      error: e.stderr?.trim() ?? e.message ?? 'psql failed (no error message)',
    };
  }
}

async function runPsqlInDocker(sql: string): Promise<RunResult> {
  try {
    const { stdout: containerStdout } = await execFileAsync('docker', [
      'ps',
      '--filter',
      'name=appflowy-cloud-premium-postgres',
      '--format',
      '{{.ID}}',
    ]);
    const containerId = containerStdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!containerId) {
      return {
        ok: false,
        error: 'no postgres container matched appflowy-cloud-premium-postgres',
      };
    }

    await execFileAsync('docker', [
      'exec',
      containerId,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ]);
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };

    return {
      ok: false,
      error: e.stderr?.trim() ?? e.message ?? 'docker exec failed (no error message)',
    };
  }
}
