import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { FieldType, FieldVisibility } from '../../../src/application/database-yjs/database.type';
import { YDatabase, YDatabaseRow, YjsDatabaseKey, YjsEditorKey } from '../../../src/application/types';
import { canonicalizeUserUid } from '../../../src/application/user-uid';
import { DatabaseTestWindow } from '../../../src/components/database/database-test-context';
import { addFeedView, seedPrimaryTitlesDirect, waitForFeedCards } from '../../support/feed-test-helpers';
import { createFieldDirect } from '../../support/gallery-test-helpers';
import { waitForDatabaseTestContext } from '../../support/relation-test-helpers';
import { DatabaseFeedSelectors } from '../../support/selectors';
import { TestConfig } from '../../support/test-config';

const { Given, When, Then } = createBdd();

type AttributionKey = YjsDatabaseKey.created_by | YjsDatabaseKey.last_edited_by;
type AttributionSearchState = {
  uid: string;
  displayName: string;
  fieldId: string;
  attribute: AttributionKey;
  firstRowId: string;
  nextRowId: string;
};

const states = new WeakMap<Page, AttributionSearchState>();

function stateFor(page: Page): AttributionSearchState {
  const state = states.get(page);

  if (!state) throw new Error('Feed attribution search fixture was not initialized');
  return state;
}

async function updateAttribution(page: Page, updates: Array<{ rowId: string; attribute: AttributionKey; uid?: string }>) {
  await page.evaluate(async ({ updates, dataSection, rowSection }) => {
    const context = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__;

    if (!context) throw new Error('Database test context was unavailable');
    for (const update of updates) {
      const doc = context.rowMap?.[update.rowId] ?? await context.ensureRow?.(update.rowId);

      if (!doc) throw new Error(`Attribution row ${update.rowId} was unavailable`);
      const row = doc.getMap(dataSection).get(rowSection) as YDatabaseRow;

      doc.transact(() => {
        if (update.uid === undefined) row.delete(update.attribute);
        else row.set(update.attribute, update.uid);
      });
    }
  }, { updates, dataSection: YjsEditorKey.data_section, rowSection: YjsEditorKey.database_row } as const);
}

Given('a Feed whose visible {string} names the current user on one card', async ({ page }, property: string) => {
  if (property !== 'Created by' && property !== 'Last edited by') {
    throw new Error(`Unsupported attribution property: ${property}`);
  }

  await waitForDatabaseTestContext(page);
  // Read the same profile endpoints as UserService using the browser's active
  // session. Database's test context does not expose an HTTP client. Credentials
  // stay in the page, and this also works against the built SSR app in CI.
  const profile = await page.evaluate(async (apiUrl) => {
    const context = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__;
    const session = JSON.parse(localStorage.getItem('token') || '{}') as { access_token?: string };

    if (!session.access_token || !context?.workspaceId) throw new Error('Authenticated database session was unavailable');
    type ProfileResponse = {
      code: number;
      data?: { uid?: string | number; uid_string?: string; name?: string; email?: string };
    };

    const readProfile = async (path: string): Promise<ProfileResponse> => {
      const response = await fetch(new URL(path, apiUrl), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) throw new Error(`Attribution profile request failed (${response.status})`);
      return response.json() as Promise<ProfileResponse>;
    };

    const [userResponse, memberResponse] = await Promise.all([
      readProfile(`/api/user/profile?workspace_id=${encodeURIComponent(context.workspaceId)}`),
      readProfile(`/api/workspace/${context.workspaceId}/workspace-profile`),
    ]);
    const user = userResponse.data;
    const member = memberResponse.data;

    if (userResponse.code !== 0 || memberResponse.code !== 0 || !user || !member) {
      throw new Error('Attribution fixture could not load the current workspace profile');
    }

    const uid = user.uid_string ?? (
      typeof user.uid === 'string' || Number.isSafeInteger(user.uid) ? String(user.uid) : null
    );

    return { uid, displayName: member.name || member.email || '' };
  }, TestConfig.apiUrl);
  const uid = canonicalizeUserUid(profile.uid);

  if (!uid || !profile.displayName.trim()) throw new Error('Current profile lacks an exact UID or display name');

  const createdFieldId = await createFieldDirect(page, { fieldType: FieldType.CreatedBy, name: 'Created by' });
  const editedFieldId = await createFieldDirect(page, { fieldType: FieldType.LastEditedBy, name: 'Last edited by' });
  const rowIds = await seedPrimaryTitlesDirect(page, ['Attribution first record', 'Hidden attribution record', 'Attribution next record']);

  await addFeedView(page);
  await waitForFeedCards(page, 3);
  const isCreatedBy = property === 'Created by';
  const attribute = isCreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by;
  const hiddenAttribute = isCreatedBy ? YjsDatabaseKey.last_edited_by : YjsDatabaseKey.created_by;
  const fieldId = isCreatedBy ? createdFieldId : editedFieldId;

  await updateAttribution(page, rowIds.flatMap((rowId) => [
    { rowId, attribute: YjsDatabaseKey.created_by },
    { rowId, attribute: YjsDatabaseKey.last_edited_by },
  ]));
  await updateAttribution(page, [
    { rowId: rowIds[0], attribute, uid },
    { rowId: rowIds[1], attribute: hiddenAttribute, uid },
  ]);
  // Configure only the tested field as visible. The second card carries the
  // same user in the other, hidden attribution field and must never match.
  await page.evaluate(({ fieldId, keys, dataSection, databaseSection, shown, hidden }) => {
    const context = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__;

    if (!context) throw new Error('Database test context was unavailable');
    const database = context.databaseDoc.getMap(dataSection).get(databaseSection) as YDatabase;
    const settings = database.get(keys.views).get(context.activeViewId).get(keys.field_settings);

    context.databaseDoc.transact(() => {
      for (const id of settings.keys()) settings.get(id).set(keys.visibility, id === fieldId ? shown : hidden);
    });
  }, {
    fieldId,
    keys: { views: YjsDatabaseKey.views, field_settings: YjsDatabaseKey.field_settings, visibility: YjsDatabaseKey.visibility },
    dataSection: YjsEditorKey.data_section,
    databaseSection: YjsEditorKey.database,
    shown: FieldVisibility.AlwaysShown,
    hidden: FieldVisibility.AlwaysHidden,
  } as const);

  states.set(page, { uid, displayName: profile.displayName, fieldId, attribute, firstRowId: rowIds[0], nextRowId: rowIds[2] });
  await expect(page.getByTestId(`attribution-cell-${rowIds[0]}-${fieldId}`)).toContainText(profile.displayName);
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(3);
});

When('the user searches the Feed for that attribution display name', async ({ page }) => {
  await page.getByTestId('database-actions-search').click();
  await page.getByTestId('database-actions-search-input').fill(stateFor(page).displayName);
});

Then('only the initially attributed Feed card appears', async ({ page }) => {
  await expect(DatabaseFeedSelectors.cardByRowId(page, stateFor(page).firstRowId)).toBeVisible();
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(1);
});

When('the visible attribution moves to another Feed card', async ({ page }) => {
  const { attribute, firstRowId, nextRowId, uid } = stateFor(page);

  await updateAttribution(page, [{ rowId: firstRowId, attribute }, { rowId: nextRowId, attribute, uid }]);
});

Then('the same search shows only the newly attributed Feed card', async ({ page }) => {
  const { displayName, firstRowId, nextRowId, fieldId } = stateFor(page);

  await expect(page.getByTestId('database-actions-search-input')).toHaveValue(displayName);
  await expect(DatabaseFeedSelectors.cardByRowId(page, firstRowId)).toBeHidden();
  await expect(DatabaseFeedSelectors.cardByRowId(page, nextRowId)).toBeVisible();
  await expect(page.getByTestId(`attribution-cell-${nextRowId}-${fieldId}`)).toContainText(displayName);
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(1);
});

When('the visible attribution is removed from that Feed card', async ({ page }) => {
  const { attribute, nextRowId } = stateFor(page);

  await updateAttribution(page, [{ rowId: nextRowId, attribute }]);
});

Then('no Feed cards match until the attribution search is cleared', async ({ page }) => {
  await expect(page.getByTestId('database-actions-search-input')).toHaveValue(stateFor(page).displayName);
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(0);
  await page.getByTestId('database-actions-search-clear').click();
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(3);
});
