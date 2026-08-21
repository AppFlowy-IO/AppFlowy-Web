import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v5 as uuidv5 } from 'uuid';

import { RowMetaKey } from '../../../src/application/database-yjs/database.type';
import {
  publishedDatabasePayload,
  publishedRowDocumentId,
} from '../../../src/application/publish-snapshot/__fixtures__/published-page-snapshots';
import type {
  PublishedDatabaseSnapshotPayload,
  PublishedJsonObject,
} from '../../../src/application/publish-snapshot/types';
import { YjsDatabaseKey, YjsEditorKey } from '../../../src/application/types';
import { DatabaseGridSelectors } from '../../support/selectors';

const { Given, When, Then } = createBdd();

const ISSUE_NAMESPACE = 'issue-1645';
const ISSUE_PUBLISH_NAME = 'published-row-document';
const ISSUE_ROW_ID = '16450000-0000-4000-8000-000000000001';
const ISSUE_ROW_DOCUMENT_ID = uuidv5(RowMetaKey.DocumentId, ISSUE_ROW_ID);
const ISSUE_ROW_DOCUMENT_CONTENT = 'Published row document body';
const APP_PROVIDER_ERROR = 'useEventEmitter must be used within an AppProvider';

interface Issue1645State {
  browserErrors: string[];
}

const issueStateByPage = new WeakMap<Page, Issue1645State>();

Given('a public database snapshot contains a row document', async ({ page }) => {
  const state: Issue1645State = { browserErrors: [] };

  issueStateByPage.set(page, state);
  page.on('pageerror', (error) => state.browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      state.browserErrors.push(message.text());
    }
  });

  const snapshot = createIssue1645Snapshot();
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'content-type': 'application/json',
  };

  await page.route(`**/api/workspace/v2/published/${ISSUE_NAMESPACE}/${ISSUE_PUBLISH_NAME}/snapshot`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({ code: 0, data: snapshot, message: '' }),
    });
  });

  await page.route('**/api/workspace/v1/published-info/*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        code: 0,
        data: {
          namespace: ISSUE_NAMESPACE,
          publish_name: ISSUE_PUBLISH_NAME,
          publisher_email: 'publisher@example.com',
          view_id: snapshot.view.viewId,
          publish_timestamp: new Date(0).toISOString(),
          comments_enabled: false,
          duplicate_enabled: false,
        },
        message: '',
      }),
    });
  });

  await page.route(`**/api/workspace/published-outline/${ISSUE_NAMESPACE}`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({ code: 0, data: { children: [] }, message: '' }),
    });
  });
});

When('I open the public database snapshot', async ({ page }) => {
  await page.goto(`/${ISSUE_NAMESPACE}/${ISSUE_PUBLISH_NAME}`, { waitUntil: 'domcontentloaded' });

  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });
  await expect(DatabaseGridSelectors.rowById(page, ISSUE_ROW_ID)).toContainText('First published row', {
    timeout: 15000,
  });
});

When('I open the published database row', async ({ page }) => {
  const state = getIssueState(page);
  const row = DatabaseGridSelectors.rowById(page, ISSUE_ROW_ID);

  await row.hover();
  const openRowButton = row.getByTestId('row-expand-button');

  await expect(openRowButton).toBeVisible({ timeout: 10000 });
  await openRowButton.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('r'), {
      timeout: 10000,
      message: 'Expected the published database to navigate to the row page',
    })
    .toBe(ISSUE_ROW_ID);

  // Settle on either outcome so the Then step reports the regression directly:
  // the row content renders, or React reports the missing AppProvider context.
  await expect
    .poll(
      async () => {
        const rowDocumentVisible = await page
          .getByText(ISSUE_ROW_DOCUMENT_CONTENT, { exact: true })
          .isVisible()
          .catch(() => false);
        const providerErrorReported = state.browserErrors.some((message) => message.includes(APP_PROVIDER_ERROR));

        return rowDocumentVisible || providerErrorReported;
      },
      {
        timeout: 15000,
        message: 'Expected the published row document to render or report the AppProvider regression',
      }
    )
    .toBe(true);
});

Then('the published row document opens without an AppProvider error', async ({ page }) => {
  const state = getIssueState(page);
  const bodyText = await page.locator('body').innerText();
  const providerErrors = [...state.browserErrors, bodyText].filter((message) => message.includes(APP_PROVIDER_ERROR));

  expect(providerErrors, `Published row editor crashed: ${APP_PROVIDER_ERROR}`).toEqual([]);
  await expect(page.getByText(ISSUE_ROW_DOCUMENT_CONTENT, { exact: true })).toBeVisible({ timeout: 15000 });
});

function getIssueState(page: Page): Issue1645State {
  const state = issueStateByPage.get(page);

  if (!state) {
    throw new Error('Issue #1645 test state has not been initialized');
  }

  return state;
}

function createIssue1645Snapshot(): PublishedDatabaseSnapshotPayload {
  const snapshot = structuredClone(publishedDatabasePayload);
  const sourceRowId = snapshot.database.rows?.[0]?.rowId;
  const raw = snapshot.database.raw;
  const sourceRawRow = sourceRowId ? raw?.rows?.[sourceRowId] : undefined;
  const sourceRowDocument = raw?.row_documents?.[publishedRowDocumentId];

  if (!sourceRowId || !raw || !sourceRawRow || !sourceRowDocument) {
    throw new Error('Published database fixture is missing its row document data');
  }

  snapshot.namespace = ISSUE_NAMESPACE;
  snapshot.publishName = ISSUE_PUBLISH_NAME;
  snapshot.database.rows = snapshot.database.rows?.map((row) => ({ ...row, rowId: ISSUE_ROW_ID }));
  snapshot.database.views = snapshot.database.views?.map((view) => ({ ...view, rowIds: [ISSUE_ROW_ID] }));

  const rawDatabaseRow = sourceRawRow[YjsEditorKey.database_row] as PublishedJsonObject | undefined;

  if (!rawDatabaseRow) {
    throw new Error('Published database fixture is missing the raw database row');
  }

  rawDatabaseRow[YjsDatabaseKey.id] = ISSUE_ROW_ID;
  raw.rows = { [ISSUE_ROW_ID]: sourceRawRow };
  raw.row_documents = { [ISSUE_ROW_DOCUMENT_ID]: sourceRowDocument };

  const rawViews = raw.database?.[YjsDatabaseKey.views] as PublishedJsonObject | undefined;
  const rawActiveView = rawViews?.[snapshot.database.activeViewId] as PublishedJsonObject | undefined;

  if (!rawActiveView) {
    throw new Error('Published database fixture is missing its active raw view');
  }

  rawActiveView[YjsDatabaseKey.row_orders] = [{ id: ISSUE_ROW_ID, height: 36 }];
  return snapshot;
}
