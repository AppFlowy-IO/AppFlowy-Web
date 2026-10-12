import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { AddPageSelectors, DatabaseGridSelectors, DatabaseViewSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

for (const failure of ['offline', 'unsupported server'] as const) {
  for (const kind of ['document', 'database'] as const) {
    test(`${failure} refuses new ${kind} creation while preserving the open database and sidebar`, async ({
      page,
      request,
    }) => {
      await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
      const initialResponse = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/v2/page-view/database/default')
      );

      await createDatabaseView(page, 'Grid', 0);
      const initial = await initialResponse;
      const body = await initial.json();
      const command = initial.request().postDataJSON();

      expect(body.code).toBe(0);
      await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
      if (failure === 'unsupported server') {
        await page.route('**/api/server-info**', async (route) => {
          const response = await route.fetch();
          const info = await response.json();

          info.data.enable_atomic_creation = false;
          info.data.enable_atomic_creation_defaults = false;
          await route.fulfill({ response, json: info });
        });
        const capabilities = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/server-info');

        await page.reload();
        await capabilities;
        await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
      }
      const beforeUrl = page.url();
      const mutations: string[] = [];

      page.on('request', (req) => {
        if (req.method() === 'POST' && new URL(req.url()).pathname.includes('/page-view')) mutations.push(req.url());
      });
      await page.locator('[data-testid="inline-add-page"]:visible').first().click();
      const action =
        kind === 'document' ? AddPageSelectors.addDocumentButton(page) : AddPageSelectors.addGridButton(page);

      await expect(action).toBeVisible();
      if (failure === 'offline') await page.context().setOffline(true);
      try {
        await action.click();
        const message =
          failure === 'offline'
            ? 'Connect to the internet to create this item.'
            : 'Update the server to use this creation feature.';

        await expect(page.getByText(message, { exact: true })).toBeVisible();
        expect(page.url()).toBe(beforeUrl);
        await expect(page.getByTestId(`page-${command.container_id}`)).toHaveAttribute('data-selected', 'true');
        await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute(
          'data-testid',
          `view-tab-${command.database.view_id}`
        );
        await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
        await expect(page.getByRole('button', { name: 'Finish creating your page' })).toHaveCount(0);
        expect(mutations).toEqual([]);
      } finally {
        await page.context().setOffline(false);
      }
    });
  }
}
