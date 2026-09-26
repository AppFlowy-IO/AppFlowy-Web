import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

import { assertSuccessfulAppFlowyResponse } from '../../support/appflowy-response';
import { acknowledgeDatabaseRestore } from '../../support/database-history-helpers';
import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { editFirstGridCell, firstGridCellText } from '../../support/duplicate-test-helpers';
import { getVisibleDataRowIds } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, HeaderSelectors, RevertedDialogSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

import type { DatabaseRestoreJob } from '../../../src/application/database-history.type';
import type { DatabaseTestWindow } from '../../../src/components/database/database-test-context';

const savedContent = 'Saved database row';
const changedContent = 'Changed after saving the database version';
const clientHeaders = { 'client-version': '0.18.10', 'x-platform': 'web' };

interface HistoryFixture {
  databasePath: string;
  headers: Record<string, string>;
  rowId: string;
  version: string;
}

async function responseData<T>(response: APIResponse, operation: string): Promise<T> {
  const bodyText = await response.text();

  assertSuccessfulAppFlowyResponse({ bodyText, ok: response.ok(), status: response.status(), operation });
  return (JSON.parse(bodyText) as { data: T }).data;
}

async function expectServerRow(
  request: APIRequestContext,
  fixture: Omit<HistoryFixture, 'version'>,
  text: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(`${fixture.databasePath}/row/detail`, {
          headers: fixture.headers,
          params: { ids: fixture.rowId, with_doc: false },
        });
        const rows = await responseData<Array<{ id: string; cells: Record<string, unknown> }>>(
          response,
          'Read saved row'
        );

        return Object.values(rows.find((row) => row.id === fixture.rowId)?.cells ?? {});
      },
      { timeout: 30000, message: 'Wait for the real server to acknowledge the row edit' }
    )
    .toContain(text);
}

async function createHistoryFixture(page: Page, request: APIRequestContext): Promise<HistoryFixture> {
  // Every scenario owns a new account/workspace; never restore the shared seeded database.
  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', { verify: waitForGridReady });
  await expect(RevertedDialogSelectors.dialog(page)).toBeHidden();
  const grid = DatabaseGridSelectors.grid(page);

  await editFirstGridCell(page, grid, savedContent);
  const { workspaceId, databaseId, accessToken } = await page.evaluate(() => {
    const context = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__;
    const token = localStorage.getItem('token');

    if (!context?.databaseDoc || !token) throw new Error('Database test context and authentication must be ready');
    return {
      workspaceId: context.workspaceId,
      databaseId: context.databaseDoc.guid,
      accessToken: (JSON.parse(token) as { access_token: string }).access_token,
    };
  });
  const fixture = {
    databasePath: `${TestConfig.apiUrl}/api/workspace/${workspaceId}/database/${databaseId}`,
    headers: { ...clientHeaders, Authorization: `Bearer ${accessToken}` },
    rowId: (await getVisibleDataRowIds(page))[0],
  };

  await expectServerRow(request, fixture, savedContent);
  await responseData(
    await request.get(`${fixture.databasePath}/blob/generate`, { headers: fixture.headers }),
    'Generate database snapshot source'
  );
  const version = await responseData<string>(
    await request.post(`${fixture.databasePath}/history`, {
      headers: fixture.headers,
      data: { name: 'Saved database version' },
    }),
    'Create database history version'
  );

  await editFirstGridCell(page, grid, changedContent);
  await expectServerRow(request, fixture, changedContent);
  return { ...fixture, version };
}

async function restoreFromPeer(request: APIRequestContext, fixture: HistoryFixture): Promise<DatabaseRestoreJob> {
  const job = await responseData<DatabaseRestoreJob>(
    await request.post(`${fixture.databasePath}/history/${fixture.version}/restore-jobs`, {
      headers: { ...fixture.headers, 'Idempotency-Key': randomUUID() },
      data: { require_checkpoint: true },
    }),
    'Start peer database restore'
  );

  await expect
    .poll(
      async () => {
        const completed = await responseData<DatabaseRestoreJob>(
          await request.get(`${fixture.databasePath}/history/restore-jobs/${job.job_id}`, { headers: fixture.headers }),
          'Read peer database restore'
        );

        if (completed.state === 'failed') throw new Error(`Peer database restore failed: ${completed.error}`);
        return completed.state;
      },
      { timeout: 90000, intervals: [500, 1000, 2000] }
    )
    .toBe('succeeded');
  return job;
}

test.describe('Database version history restore notices', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ request }) => {
    const capabilities = await responseData<{
      enable_database_history: boolean;
      enable_database_history_version_ui: boolean;
    }>(
      await request.get(`${TestConfig.apiUrl}/api/server-info`, { headers: clientHeaders }),
      'Read database history capabilities'
    );

    expect(capabilities, 'Database history browser tests require both history capabilities').toMatchObject({
      enable_database_history: true,
      enable_database_history_version_ui: true,
    });
  });

  test('acknowledges a local restore after preview without prompting for preview or initial load', async ({
    page,
    request,
  }) => {
    const fixture = await createHistoryFixture(page, request);

    await HeaderSelectors.moreActionsButton(page).click();
    await page.getByTestId('more-page-database-history').click();
    const history = page.getByTestId('database-version-history-modal');

    await expect(history).toBeVisible();
    await history.getByTestId('database-history-version').filter({ hasText: 'Saved database version' }).click();
    await expect(history.getByTestId('database-grid')).toContainText(savedContent);
    await expect(RevertedDialogSelectors.dialog(page)).toBeHidden();
    await history.getByTestId('database-history-restore').click();
    await page.getByTestId('database-history-confirm-restore').click();

    await acknowledgeDatabaseRestore(page);
    await expect(history).toBeHidden();
    await expect.poll(() => firstGridCellText(DatabaseGridSelectors.grid(page))).toBe(savedContent);
    await expectServerRow(request, fixture, savedContent);
    await editFirstGridCell(page, DatabaseGridSelectors.grid(page), 'Continue editing after local restore');
    await expectServerRow(request, fixture, 'Continue editing after local restore');
    await expect(RevertedDialogSelectors.dialog(page)).toBeHidden();
  });

  test('interrupts an active editor for each peer restore and keeps initial reopening silent', async ({
    page,
    request,
  }) => {
    const fixture = await createHistoryFixture(page, request);
    const grid = DatabaseGridSelectors.grid(page);
    const firstCell = grid.locator('[data-testid^="grid-cell-"]').first();

    await firstCell.click();
    const editor = firstCell.locator('textarea');

    await expect(editor).toBeVisible();
    await editor.fill('An edit in progress when the peer restores');
    await expect(editor).toBeFocused();
    await restoreFromPeer(request, fixture);
    await acknowledgeDatabaseRestore(page);
    await expect.poll(() => firstGridCellText(grid)).toBe(savedContent);

    await editFirstGridCell(page, grid, 'Continue editing after peer restore');
    await expectServerRow(request, fixture, 'Continue editing after peer restore');
    await expect(RevertedDialogSelectors.dialog(page)).toBeHidden();

    // Restoring the same historical snapshot again produces a new generation and a new acknowledgement.
    await restoreFromPeer(request, fixture);
    await acknowledgeDatabaseRestore(page);
    await expect.poll(() => firstGridCellText(grid)).toBe(savedContent);
    await page.reload();
    await waitForGridReady(page);
    await expect.poll(() => firstGridCellText(grid)).toBe(savedContent);
    await expect(RevertedDialogSelectors.dialog(page)).toBeHidden();
  });
});
