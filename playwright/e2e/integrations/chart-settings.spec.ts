import { expect, type Page } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

async function openFixture(page: Page, base: string) {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/chart-settings-fixture', (route) => route.fulfill({
    contentType: 'text/html', body: fixtureHTML('chart-settings'),
  }));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith('/view/width-document/navigation')) {
      return route.fulfill({ json: { code: 0, data: {
        view_id: 'width-space', name: 'Space', is_space: true, extra: { unrelated_space: true }, children: [{
          view_id: 'width-document', name: 'Document', layout: 0, extra: { preserve_me: 'owned fixture' },
        }],
      } } });
    }

    if (route.request().method() === 'PATCH' && path.endsWith('/page-view/width-document')) {
      return route.fulfill({ json: { code: 0 } });
    }

    throw new Error(`Unexpected fixture API request: ${path}`);
  });
  await page.goto(new URL('/chart-settings-fixture', base).href);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 60_000 });
  return errors;
}

test('pointer can enter a left-opening Chart submenu, choose a property and dismiss outside', async ({ page, integrationsURL }) => {
  const errors = await openFixture(page, integrationsURL);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('chart-settings-trigger').hover();
  const panel = page.getByTestId('chart-settings-panel');

  await expect(panel).toHaveAttribute('data-page', 'root');
  await expect(panel.locator('..')).toHaveAttribute('data-side', 'left');
  await page.getByRole('button', { name: 'What to show Role', exact: true }).click();
  await expect(panel).toHaveAttribute('data-page', 'x_what');
  await page.waitForTimeout(350);
  await expect(panel).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Name', exact: true }).click();
  await expect.poll(async () => JSON.parse((await page.getByTestId('chart-setting').textContent())!).x_field_id).toBe('name');
  await expect(panel).toHaveAttribute('data-page', 'root');
  // Radix marks the underlying page inert while its modal menu is open.
  // A real outside pointer still dismisses it, without activating that button.
  const outside = await page.locator('button').filter({ hasText: /^Outside$/ }).boundingBox();

  expect(outside).not.toBeNull();
  await page.mouse.click(outside!.x + outside!.width / 2, outside!.y + outside!.height / 2);
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a custom width submits exactly once from its left-opening submenu', async ({ page, integrationsURL }) => {
  const errors = await openFixture(page, integrationsURL);
  const patches: unknown[] = [];

  page.on('request', (request) => {
    if (request.method() === 'PATCH') patches.push(request.postDataJSON());
  });
  await page.getByRole('button', { name: 'Document menu', exact: true }).click();
  await page.getByTestId('document-width-action').hover();
  await expect(page.getByTestId('document-width-menu')).toHaveAttribute('data-side', 'left');
  await page.getByTestId('document-width-input').fill('1200');
  await expect(page.getByTestId('document-width-input')).toHaveValue('1200');
  expect(patches).toEqual([]);
  // A user may pause over Apply; entering the submenu must keep it open.
  await page.getByTestId('document-width-apply').hover();
  await page.waitForTimeout(350);
  await expect(page.getByTestId('document-width-menu')).toBeVisible();
  await page.getByTestId('document-width-apply').click();
  await expect.poll(() => patches).toEqual([{
    name: 'Document', extra: { preserve_me: 'owned fixture', document_width: { mode: 'fixed', max_width: 1200 } },
  }]);
  await expect(page.getByTestId('document-width-menu')).toHaveCount(0);
  await expect(page.getByTestId('width-setting')).toHaveText(JSON.stringify({
    is_space: false, preserve_me: 'owned fixture', document_width: { mode: 'fixed', max_width: 1200 },
  }));
  expect(errors).toEqual([]);
});

test('keyboard enters the standalone Chart panel and navigates its property page', async ({ page, integrationsURL }) => {
  const errors = await openFixture(page, integrationsURL);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('chart-settings-trigger').press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Vertical bar', exact: true })).toBeFocused();
  for (let index = 0; index < 5; index++) await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'What to show Role', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chart-settings-panel')).toHaveAttribute('data-page', 'x_what');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chart-settings-panel')).toHaveAttribute('data-page', 'root');
  await expect(page.getByRole('button', { name: 'What to show Role', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
