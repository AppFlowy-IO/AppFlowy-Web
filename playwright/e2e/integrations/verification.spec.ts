import { expect, Page, BrowserContext } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

async function openFixture(
  page: Page,
  context: BrowserContext,
  integrationsURL: string,
  expiresAt: string | null = null
) {
  const property = { id: 'generation-a', database_id: 'verification-browser-database' };
  const errors: string[] = [];
  const requests: string[] = [];

  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error('Verification fixture page error', error.message);
  });
  const target = (id: string) => ({
    target_id: id,
    database_id: property.database_id,
    property,
    can_edit: true,
    eligible: true,
    status: id === 'expired' ? 'expired' : id === 'verified' ? 'verified' : 'unverified',
    verification:
      id === 'unverified'
        ? null
        : {
            id: `record-${id}`,
            verified_by: { uid: 1, name: 'Reviewer' },
            verified_at: '2020-01-01T00:00:00Z',
            expires_at: id === 'expired' ? '2020-01-02T00:00:00Z' : expiresAt,
          },
  });

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());

    if (url.origin !== new URL(integrationsURL).origin) return route.abort();
    return route.fallback();
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;

    requests.push(`${route.request().method()} ${path}`);
    let data: unknown;

    if (path.endsWith('/verification-property')) data = { property, can_edit: true, eligible: true, views: {} };
    else if (path.endsWith('/verification/batch')) {
      const ids = (route.request().postDataJSON() as { target_ids: string[] }).target_ids.filter(
        (id) => id !== 'unknown'
      );

      data = { items: ids.map(target), targets: Object.fromEntries(ids.map((id) => [id, id])) };
    } else {
      errors.push(`Unexpected API request ${path}`);
      return route.fulfill({ status: 500, body: 'Unexpected request' });
    }

    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data, message: '' }) });
  });
  await page.route('**/verification-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('verification') })
  );
  await page.goto(new URL('/verification-fixture', integrationsURL).href);
  const rows = page.getByTestId('visible-rows').locator('li');

  await expect(rows).toHaveText(['unknown', 'expired', 'verified', 'unverified'], { timeout: 60000 });
  return { rows, errors, requests };
}

test('native Verification negative, empty and repeated AND/OR filters persist across reload', async ({
  page,
  context,
  integrationsURL,
}) => {
  const { rows, errors, requests } = await openFixture(page, context, integrationsURL);

  await test.step('filter known status, empty and negative status through native controls', async () => {
    await page.getByTestId('database-add-filter-button').click();
    await page.locator('[data-item-id="verification"]').click();
    await expect(rows).toHaveText(['verified']);
    await page.getByTestId('filter-condition-1').click();
    await expect(rows).toHaveText(['expired', 'unverified']);
    await page.getByTestId('filter-condition-2').click();
    await expect(rows).toHaveText(['unverified']);
    await page.getByTestId('filter-condition-3').click();
    await expect(rows).toHaveText(['expired', 'verified']);
    await page.getByTestId('filter-condition-0').click();
    await expect(rows).toHaveText(['verified']);
    await page.keyboard.press('Escape');
  });
  await test.step('combine Number AND/OR with repeated Verification predicates and reload', async () => {
    await page.getByTestId('database-add-filter-button').click();
    await page.locator('[data-item-id="number"]').click();
    await page.getByTestId('text-filter-input').fill('10');
    await expect(rows).toHaveCount(0);
    if (!(await page.getByTestId('filter-more-options-button').isVisible())) {
      await page.getByTestId('database-filter-condition').filter({ hasText: 'Number' }).click();
    }

    await page.getByTestId('filter-more-options-button').click();
    await page.getByRole('menuitem', { name: /advanced filter/i }).click();
    await page.getByTestId('advanced-filters-badge').click();
    await page.getByTestId('advanced-filter-row').nth(1).getByRole('button', { name: 'And', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Or', exact: true }).click();
    await expect(rows).toHaveText(['unknown', 'verified', 'unverified']);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(rows).toHaveText(['unknown', 'verified', 'unverified'], { timeout: 60000 });
    await page.getByTestId('advanced-filters-badge').click();
    await page.getByTestId('add-advanced-filter-button').click();
    await page.locator('[data-item-id="verification"]').click();
    await page.getByTestId('advanced-filter-row').nth(2).getByRole('button', { name: 'Or', exact: true }).click();
    await page.getByRole('menuitem', { name: 'And', exact: true }).click();
    await page.getByTestId('advanced-filter-row').nth(2).getByTestId('filter-condition-selector').click();
    await page.getByRole('menuitem', { name: 'Is empty', exact: true }).click();
    // The ordinary editor follows Desktop's left-nested mixed-operator tree:
    // (Verified OR Number = 10) AND Verification is empty.
    await expect(rows).toHaveText(['unverified']);
    const schema = JSON.parse((await page.getByTestId('native-schema').textContent())!);
    const tree = schema.data.database.views['verification-browser-view'].filters[0];

    expect(tree.filter_type).toBe(0);
    expect(tree.children[0].filter_type).toBe(1);
    await page.getByTestId('delete-all-filters-button').click();
    await page.getByTestId('confirm-delete-all-filters').click();
    await expect(rows).toHaveText(['unknown', 'expired', 'verified', 'unverified']);
  });
  expect(requests.some((request) => request.includes('/verification/batch'))).toBeTruthy();
  expect(errors).toEqual([]);
});

test('native Verification and Number sorts obey list priority, keyboard reorder and reload', async ({
  page,
  context,
  integrationsURL,
}) => {
  const { rows, errors } = await openFixture(page, context, integrationsURL);

  await test.step('apply and reorder ordinary and Verification sort priorities and reload', async () => {
    await page.getByTestId('database-actions-sort').click();
    await page.locator('[data-item-id="number"]').click();
    await expect(rows).toHaveText(['expired', 'verified', 'unknown', 'unverified']);
    await page.getByRole('button', { name: 'Add sort', exact: true }).click();
    await page.locator('[data-item-id="verification"]').click();
    await expect(rows).toHaveText(['verified', 'expired', 'unverified', 'unknown']);
    const handles = page.getByRole('button', { name: 'Reorder sort' });

    await handles.nth(1).focus();
    await page.keyboard.press('ArrowUp');
    await expect(rows).toHaveText(['unverified', 'verified', 'expired', 'unknown']);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(rows).toHaveText(['unverified', 'verified', 'expired', 'unknown'], { timeout: 60000 });
  });
  expect(errors).toEqual([]);
});

test('native Verification expiry updates filters without a cell mutation or new Cloud claim', async ({
  page,
  context,
  integrationsURL,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-17T00:00:00Z'));
  const { rows, errors } = await openFixture(page, context, integrationsURL, '2026-10-18T00:00:00.000001Z');

  await page.getByTestId('database-add-filter-button').click();
  await page.locator('[data-item-id="verification"]').click();
  await expect(rows).toHaveText(['verified']);
  await page.getByTestId('verification-filter-2').click();
  await expect(rows).toHaveText(['expired']);
  await page.clock.setFixedTime(new Date('2026-10-18T00:00:00.001Z'));
  await expect(rows).toHaveText(['expired', 'verified']);
  expect(errors).toEqual([]);
});
