import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { addFieldWithType, loginAndCreateGrid } from '../../support/field-type-helpers';
import { BoardSelectors, DatabaseGridSelectors, DatabaseViewSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { waitForDatabaseDocReady } from '../../support/yjs-inject-helpers';

const { Given, When, Then } = createBdd();

type BoardRenderingState = {
  boardUrl?: string;
  loadedRowCount: number;
  dateFieldName?: string;
};

const stateByPage = new WeakMap<Page, BoardRenderingState>();
// A new Grid starts with three rows, all of which belong to the "No Type" column.
const NEW_GRID_ROW_COUNT = 3;
// The Board reaches its terminal state well before this. Without the fix it
// keeps its loading skeleton or stays blank indefinitely.
const BOARD_RENDER_TIMEOUT = 20_000;

function requireState(page: Page): BoardRenderingState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('No Board rendering database was opened for this page');
  return state;
}

async function addBoardViewFromTabBar(page: Page) {
  const addViewButton = DatabaseViewSelectors.addViewButton(page);

  await expect(addViewButton).toBeVisible();
  await addViewButton.click();

  const menu = page.locator('[data-slot="dropdown-menu-content"]:visible');

  await expect(menu).toHaveCount(1);
  await menu.getByRole('menuitem', { name: 'Board', exact: true }).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Board');
  await expect(page).toHaveURL(/[?&]v=/);
  requireState(page).boardUrl = page.url();
}

async function switchToViewTab(page: Page, name: string) {
  const tab = DatabaseViewSelectors.viewTab(page).filter({ hasText: name });

  await expect(tab).toHaveCount(1);
  await tab.click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText(name);
}

/**
 * Wait until the database collab has no pending local updates, so a reload
 * reads the injected state back from the server rather than from memory.
 */
async function waitForDatabaseUpdatesSent(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const objectId = (window as unknown as { __TEST_DATABASE_DOC__: { guid: string } }).__TEST_DATABASE_DOC__.guid;

          return new Promise<number>((resolve, reject) => {
            const request = indexedDB.open('af_database_cache');

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const records = db.transaction('sync_outbox', 'readonly').objectStore('sync_outbox').getAll();

              records.onsuccess = () => {
                db.close();
                resolve(
                  (records.result as { objectId: string }[]).filter((record) => record.objectId === objectId).length
                );
              };
              records.onerror = () => {
                db.close();
                reject(records.error);
              };
            };
          });
        }),
      { timeout: 20_000, message: 'Waiting for the database update to reach the server' }
    )
    .toBe(0);
}

Given('a Grid database with a Board view is open for Board rendering', async ({ page, request }) => {
  setupPageErrorHandling(page);
  stateByPage.set(page, { loadedRowCount: NEW_GRID_ROW_COUNT });
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await addBoardViewFromTabBar(page);
  await expect(BoardSelectors.mainColumns(page)).toBeVisible({ timeout: BOARD_RENDER_TIMEOUT });
  await expect(BoardSelectors.cards(page)).toHaveCount(NEW_GRID_ROW_COUNT, { timeout: BOARD_RENDER_TIMEOUT });
});

Given('the database lists a row whose data does not exist on the server', async ({ page }) => {
  await waitForDatabaseDocReady(page);
  // A row order whose DatabaseRow collab was never created, as left behind by
  // an interrupted import or a client that never synced the row itself.
  await page.evaluate(() => {
    type YArrayLike = { push: (items: unknown[]) => void };
    type YMapLike = { get: (key: string) => unknown; forEach: (fn: (value: YMapLike) => void) => void };
    const doc = (
      window as unknown as {
        __TEST_DATABASE_DOC__: { getMap: (name: string) => YMapLike; transact: (fn: () => void) => void };
      }
    ).__TEST_DATABASE_DOC__;
    const database = doc.getMap('data').get('database') as YMapLike;
    const rowId = crypto.randomUUID();

    doc.transact(() => {
      (database.get('views') as YMapLike).forEach((view) => {
        (view.get('row_orders') as YArrayLike).push([{ id: rowId, height: 36 }]);
      });
    });
  });
  await waitForDatabaseUpdatesSent(page);
});

Given('the Board has no grouping and the database has no Select or Checkbox property', async ({ page }) => {
  const boardViewId = new URL(requireState(page).boardUrl ?? '').searchParams.get('v');

  if (!boardViewId) throw new Error('The Board view id is unknown');

  // Edit the schema while the Board is not mounted, as an older client would
  // have left it: no persisted grouping and nothing a Board can group by.
  await switchToViewTab(page, 'Grid');
  await waitForDatabaseDocReady(page);
  await page.evaluate((viewId) => {
    type YArrayLike = {
      length: number;
      get: (index: number) => { id: string };
      delete: (index: number, length: number) => void;
    };
    type YMapLike = {
      get: (key: string) => unknown;
      delete: (key: string) => void;
      forEach: (fn: (value: YMapLike, key: string) => void) => void;
    };
    const doc = (
      window as unknown as {
        __TEST_DATABASE_DOC__: { getMap: (name: string) => YMapLike; transact: (fn: () => void) => void };
      }
    ).__TEST_DATABASE_DOC__;
    const database = doc.getMap('data').get('database') as YMapLike;
    const fields = database.get('fields') as YMapLike;
    // SingleSelect, MultiSelect and Checkbox.
    const groupableTypes = [3, 4, 5];
    const removedFieldIds: string[] = [];

    fields.forEach((field, fieldId) => {
      if (groupableTypes.includes(Number(field.get('ty')))) removedFieldIds.push(fieldId);
    });

    doc.transact(() => {
      (database.get('views') as YMapLike).forEach((view, id) => {
        const fieldOrders = view.get('field_orders') as YArrayLike;

        for (let index = fieldOrders.length - 1; index >= 0; index -= 1) {
          if (removedFieldIds.includes(fieldOrders.get(index).id)) fieldOrders.delete(index, 1);
        }

        removedFieldIds.forEach((fieldId) => (view.get('field_settings') as YMapLike | undefined)?.delete(fieldId));
        if (id === viewId) {
          const groups = view.get('groups') as YArrayLike;

          groups.delete(0, groups.length);
        }
      });
      removedFieldIds.forEach((fieldId) => fields.delete(fieldId));
    });
  }, boardViewId);
  await waitForDatabaseUpdatesSent(page);
});

Given('a Grid database grouped by a new Date property is open for Board rendering', async ({ page, request }) => {
  setupPageErrorHandling(page);
  stateByPage.set(page, { loadedRowCount: NEW_GRID_ROW_COUNT });
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const dateFieldId = await addFieldWithType(page, FieldType.DateTime);

  expect(dateFieldId).not.toBe('');
  await waitForDatabaseDocReady(page);
  requireState(page).dateFieldName = await page.evaluate((fieldId) => {
    type YMapLike = { get: (key: string) => unknown };
    const doc = (window as unknown as { __TEST_DATABASE_DOC__: { getMap: (name: string) => YMapLike } })
      .__TEST_DATABASE_DOC__;
    const fields = (doc.getMap('data').get('database') as YMapLike).get('fields') as YMapLike;

    return String((fields.get(fieldId) as YMapLike).get('name'));
  }, dateFieldId);

  const groupSettingsTrigger = page.getByTestId('grid-group-settings-trigger');

  await page.getByTestId('database-actions-settings').click();
  await expect(groupSettingsTrigger).toBeVisible();
  await groupSettingsTrigger.click();
  await page.getByTestId(`grid-group-by-field-${dateFieldId}`).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid^="grid-group-header-"]').first()).toBeVisible();
});

When('I add a Board view from the tab bar for Board rendering', async ({ page }) => {
  await addBoardViewFromTabBar(page);
});

When('I reopen the Board view', async ({ page }) => {
  const { boardUrl } = requireState(page);

  if (!boardUrl) throw new Error('The Board view URL is unknown');
  await page.goto(boardUrl);
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Board', { timeout: 30_000 });
});

When('I switch to the Grid view of the Board rendering database', async ({ page }) => {
  await switchToViewTab(page, 'Grid');
});

When('I group the Board by {string} from the Board message', async ({ page }, fieldName: string) => {
  const message = page.getByTestId('board-no-group');

  await message.getByTestId('board-no-group-group-by').click();

  const menu = page.getByTestId('board-no-group-menu');

  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: fieldName, exact: true }).click();
});

Then('the Board shows its columns with every loaded card', async ({ page }) => {
  await expect(BoardSelectors.mainColumns(page)).toBeVisible({ timeout: BOARD_RENDER_TIMEOUT });
  await expect(page.getByTestId('kanban-skeleton')).toHaveCount(0);
  await expect(BoardSelectors.cards(page)).toHaveCount(requireState(page).loadedRowCount);
});

Then('the Grid view of the Board rendering database shows its rows', async ({ page }) => {
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
  await expect
    .poll(() => DatabaseGridSelectors.dataRows(page).count())
    .toBeGreaterThanOrEqual(requireState(page).loadedRowCount);
});

Then('the Board is grouped by a new {string} Single select property', async ({ page }, fieldName: string) => {
  await expect(BoardSelectors.mainColumns(page)).toBeVisible({ timeout: BOARD_RENDER_TIMEOUT });
  await waitForDatabaseDocReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        type YMapLike = { get: (key: string) => unknown; forEach: (fn: (value: YMapLike) => void) => void };
        const win = window as unknown as {
          __TEST_DATABASE_DOC__: { getMap: (name: string) => YMapLike };
          __TEST_DATABASE_VIEW_ID__: string;
        };
        const database = win.__TEST_DATABASE_DOC__.getMap('data').get('database') as YMapLike;
        const fields: { name: string; type: number }[] = [];

        (database.get('fields') as YMapLike).forEach((field) => {
          fields.push({ name: String(field.get('name')), type: Number(field.get('ty')) });
        });

        const view = (database.get('views') as YMapLike).get(win.__TEST_DATABASE_VIEW_ID__) as YMapLike;
        const groups = (view.get('groups') as { toJSON: () => { field_id: string }[] }).toJSON();
        const groupedField = (database.get('fields') as YMapLike).get(groups[0]?.field_id ?? '') as YMapLike | undefined;

        return {
          groupedBy: groupedField ? String(groupedField.get('name')) : null,
          groupCount: groups.length,
          // Single select is FieldType 3.
          matchingFields: fields.filter((field) => field.type === 3).map((field) => field.name),
        };
      })
    )
    .toEqual({ groupedBy: fieldName, groupCount: 1, matchingFields: [fieldName] });
});

Then('the Board shows every loaded card in the {string} column', async ({ page }, columnName: string) => {
  const column = BoardSelectors.columnByName(page, columnName);

  await expect(column).toHaveCount(1);
  await expect(column.locator('.board-card')).toHaveCount(requireState(page).loadedRowCount);
});

Then('the Board says it cannot draw its grouping by the Date property', async ({ page }) => {
  const { dateFieldName } = requireState(page);
  const message = page.getByTestId('board-no-group');

  if (!dateFieldName) throw new Error('The Date property name is unknown');
  await expect(message).toBeVisible({ timeout: BOARD_RENDER_TIMEOUT });
  await expect(message.getByTestId('board-no-group-description')).toContainText(dateFieldName);
  await expect(message.getByTestId('board-no-group-group-by')).toBeVisible();
  await expect(BoardSelectors.mainColumns(page)).toHaveCount(0);
});
