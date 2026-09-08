import { expect, test } from '@playwright/test';

import { WorkspaceDatabaseWithViews } from '../../../src/application/services/services.type';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';

test('cloud_linked_grid_picker.feature: container-less Feed, To-dos and Grid databases remain linkable', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  setupPageErrorHandling(page);
  await page.setViewportSize({ height: 1000, width: 1440 });
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await renameCurrentDatabasePage(page, 'New Grid');
  await createDatabaseView(page, 'Feed', 6000);
  await renameCurrentDatabasePage(page, 'New Feed');
  await createDatabaseView(page, 'Grid', 6000);
  await renameCurrentDatabasePage(page, 'To-dos');
  const documentId = await createDocumentPageAndNavigate(page);
  const names = ['New Feed', 'To-dos', 'New Grid'];
  let legacyNames: string[] = [];

  // Desktop uses a pre-seeded cloud template account. Adapt its legacy catalog
  // shape while keeping real authorized database/view/row IDs for linking.
  await page.route(/\/api\/workspace\/[^/]+\/database\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const includedNames = new Set<string>();

    body.data.databases = (body.data.databases as WorkspaceDatabaseWithViews[]).flatMap((database) => {
      const container = database.views.find((view) => view.is_container);
      const primary = database.views.find((view) => !view.is_container && !view.embedded);
      const name = container?.name ?? primary?.name;

      if (!primary || !name || !names.includes(name) || includedNames.has(name)) return [];
      includedNames.add(name);
      legacyNames.push(name);
      return [
        {
          ...database,
          // Keep newly linked view mappings in the catalog so their collabs can
          // load; only the legacy container is absent from this fixture.
          views: database.views
            .filter((view) => !view.is_container)
            .map((view) =>
              view.view_id === primary.view_id
                ? { ...view, name, parent_view_id: container?.parent_view_id ?? view.parent_view_id }
                : view
            ),
        },
      ];
    });
    body.data.has_more = false;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  const editor = page.locator(`#editor-${documentId}`);

  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type('/');
  await page.getByTestId('slash-menu-linkedGrid').click();
  const picker = page.locator('.MuiPopover-paper').last();

  for (const name of names) await expect(picker.getByText(name, { exact: true })).toHaveCount(1);
  expect(new Set(legacyNames)).toEqual(new Set(names));
  await expect(picker.locator('span.flex-1.truncate')).toHaveCount(3);
  await picker.getByRole('textbox').fill('New Feed');
  await expect(picker.locator('span.flex-1.truncate')).toHaveCount(1);
  const [linkedView] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/page-view/${documentId}/database-view`)
    ),
    picker.getByRole('button').click(),
  ]);

  expect(linkedView.ok()).toBe(true);
  await expect(editor.getByTestId('database-grid')).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])')).toHaveCount(3);
});
