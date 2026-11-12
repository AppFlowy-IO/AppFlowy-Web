import { expect, test } from '@playwright/test';
import { DatabaseViewLayout } from '../../../src/application/types';

import { addFormQuestion, openFormPreview } from '../../support/form-test-helpers';

test('isolated desktop form actions, multiline copy, question controls and local preview survive reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  let bootstrapRequests = 0;
  let share = {
    token: 'fixture-token',
    tier: 'workspace',
    anonymous: false,
    submission_access: 'none',
    share_url: 'https://appflowy.test/form/fixture-token',
    created_at: '2026-11-11T00:00:00Z',
  };
  await page.route('**/api/workspace/**/form/share', async (route) => {
    if (route.request().method() === 'GET') bootstrapRequests++;
    else share = { ...share, ...route.request().postDataJSON() };
    await route.fulfill({ json: { code: 0, data: share } });
  });
  await page.goto('/playwright/fixtures/form/refactor.html');
  await expect(page.getByTestId('form-share-button')).toBeVisible();
  await expect.poll(() => bootstrapRequests).toBe(1);
  await page.getByRole('button', { name: 'Mount form body' }).click();
  await expect(page.getByTestId('form-access-banner')).toHaveAttribute('data-tier', 'workspace');
  expect(bootstrapRequests).toBe(1);
  const body = page.getByTestId('form-builder-scroll-container');
  const actions = page.getByTestId('form-actions');
  await expect(actions.getByTestId('form-preview-button')).toBeVisible();
  await expect(actions.getByTestId('form-share-button')).toBeVisible();
  await expect(body.getByTestId('form-preview-button')).toHaveCount(0);

  const title = page.getByRole('textbox', { name: 'Form title', exact: true });
  await title.click();
  await title.press('ControlOrMeta+A');
  await title.pressSequentially('Customer feedback');
  await title.press('Enter');
  await title.pressSequentially('Tell us more');
  await title.press('Tab');
  await expect(title).toHaveValue('Customer feedback\nTell us more');

  await page.getByTestId('form-add-question-button').click();
  await expect(page.getByText('Existing properties', { exact: true })).toHaveCount(0);
  await expect(page.getByText('New question', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await addFormQuestion(page, 'RichText');
  await addFormQuestion(page, 'SingleSelect');
  const cards = page.getByTestId('form-question-card');
  await expect(cards.nth(0).getByRole('heading')).toContainText('(Text)');
  await expect(cards.nth(1).getByRole('heading')).toContainText('(Select)');

  const width = await cards.first().evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeCloseTo(600, 0);
  const addQuestionBounds = await page.getByTestId('form-add-question-button').boundingBox();
  const cardBounds = await cards.first().boundingBox();
  expect(addQuestionBounds!.width).toBeLessThan(200);
  expect(addQuestionBounds!.height).toBe(32);
  expect(addQuestionBounds!.x + addQuestionBounds!.width / 2).toBeCloseTo(cardBounds!.x + cardBounds!.width / 2, 0);
  await cards.first().hover();
  await cards.first().getByTestId('form-question-menu-trigger').click();
  const dots = cards.first().getByTestId('form-question-menu-trigger');
  await expect(dots).toHaveCSS('width', '32px');
  await page.getByRole('menu').hover();
  await expect.poll(() => dots.evaluate((el) => getComputedStyle(el.parentElement!).opacity)).toBe('0');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitemcheckbox', { name: 'Required' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Description', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  const description = cards.first().getByPlaceholder('Add description');
  await description.click();
  await description.pressSequentially('What worked well?');
  await expect(description).toHaveValue('What worked well?');
  await description.press('Tab');
  await expect(cards.first()).toHaveAttribute('data-required', 'true');

  const addOptionRow = cards.nth(1).getByTestId('form-add-option-row');
  const optionRowHeight = await addOptionRow.evaluate((el) => el.getBoundingClientRect().height);
  await cards.nth(1).getByRole('button', { name: 'Add option', exact: true }).click();
  await expect.poll(() => addOptionRow.evaluate((el) => el.getBoundingClientRect().height)).toBe(optionRowHeight);
  await cards.nth(1).getByPlaceholder('Option name').pressSequentially('Product');
  await cards.nth(1).getByPlaceholder('Option name').press('Enter');
  await cards.nth(1).getByPlaceholder('Option name').press('Escape');
  await expect(cards.nth(1).getByText('Product', { exact: true })).toBeVisible();

  let submissionRequests = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('public-form')) submissionRequests++;
  });
  await openFormPreview(page);
  const preview = page.getByTestId('form-preview-dialog');
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Customer feedback\nTell us more');
  await expect(preview.getByRole('heading', { level: 2 }).first()).toContainText('(Text)*');
  await expect(preview.getByText('Product', { exact: true })).toBeVisible();
  await preview.getByRole('textbox').first().pressSequentially('A local preview answer');
  await preview.getByRole('button', { name: 'Product', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Product', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath('form-preview.png') });
  await preview.getByTestId('public-form-submit').click();
  await expect(page.getByText('Submission valid — looks good!')).toBeVisible();
  await expect(preview.getByRole('textbox').first()).toHaveValue('A local preview answer');
  await expect(preview.getByRole('link', { name: 'Report abuse' })).toHaveAttribute(
    'href',
    'https://appflowy.com/report-abuse'
  );
  await preview.getByRole('button', { name: 'Close preview dialog' }).click();
  expect(submissionRequests).toBe(0);

  await page.getByTestId('form-share-button').click();
  await page.getByRole('button', { name: /Who can fill out/ }).click();
  await page.getByTestId('form-share-tier-choice-public').click();
  await expect(page.getByTestId('form-access-banner')).toHaveAttribute('data-tier', 'public');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.getByTestId('form-question-card').first()).toHaveCSS('transition-duration', '0.15s');
  await page.waitForTimeout(200);
  await page.screenshot({ path: test.info().outputPath('form-dark.png') });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.getByTestId('form-question-card').first()).toHaveCSS('transition-duration', '0.15s');
  await page.waitForTimeout(200);
  await page.screenshot({ path: test.info().outputPath('form-light.png') });
  await page.reload();
  await page.getByRole('button', { name: 'Mount form body' }).click();
  await expect(page.getByRole('textbox', { name: 'Form title', exact: true })).toHaveValue(
    'Customer feedback\nTell us more'
  );
  await expect(page.getByTestId('form-question-card').first()).toHaveAttribute('data-required', 'true');
  await expect(page.getByTestId('form-question-card').first().getByPlaceholder('Add description')).toHaveValue(
    'What worked well?'
  );
  await expect(page.getByTestId('form-question-card').nth(1).getByText('Product', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle read only' }).click();
  await expect(page.getByTestId('form-builder-scroll-container').getByText('Product', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add option', exact: true })).toBeDisabled();
});

test('menus fit a short viewport and read-only access preserves preview and link inspection', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  let patchRequests = 0;
  await page.route('**/api/workspace/**/form/share', async (route) => {
    if (route.request().method() === 'PATCH') patchRequests++;
    await route.fulfill({
      json: {
        code: 0,
        data: {
          token: 'fixture-token',
          tier: 'workspace',
          anonymous: false,
          submission_access: 'none',
          share_url: 'https://appflowy.test/form/fixture-token',
          created_at: '2026-11-11T00:00:00Z',
        },
      },
    });
  });
  await page.goto('/playwright/fixtures/form/refactor.html');
  await page.getByRole('button', { name: 'Mount form body' }).click();
  for (let index = 0; index < 4; index++) await addFormQuestion(page, 'RichText');
  await page.getByTestId('form-add-question-button').click();
  const picker = page.getByRole('menu');
  await expect(picker).toHaveAttribute('data-side', 'top');
  await expect(picker).toHaveAttribute('data-align', 'center');
  await expect
    .poll(async () => {
      const button = (await page.getByTestId('form-add-question-button').boundingBox())!;
      const popup = (await picker.boundingBox())!;
      return Math.max(
        Math.abs(popup.x + popup.width / 2 - button.x - button.width / 2),
        Math.abs(popup.y + popup.height + 4 - button.y)
      );
    })
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('add-question-menu-above-button.png') });
  const bounds = await picker.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
  await page.getByTestId('form-question-type-option-14').click();
  await expect(page.getByTestId('form-question-card')).toHaveCount(5);

  await page.getByRole('button', { name: 'Toggle read only' }).click();
  await expect(page.getByTestId('form-add-question-button')).toHaveCount(0);
  await expect(page.getByTestId('form-question-menu-trigger')).toHaveCount(0);
  await expect(page.getByTestId('form-preview-button')).toBeVisible();
  await page.getByTestId('form-share-button').click();
  await expect(page.getByRole('textbox', { name: 'Form share URL' })).toHaveValue(
    'https://appflowy.test/form/fixture-token'
  );
  await expect(page.getByTestId('form-share-anonymous-toggle')).toBeDisabled();
  await page.getByRole('button', { name: /Who can fill out/ }).click();
  await expect(page.getByTestId('form-share-tier-choice-public')).toBeDisabled();
  await expect(page.getByTestId('form-share-tier-choice-public')).toBeInViewport();
  expect(patchRequests).toBe(0);
});

test('question menus align their top-right with the trigger bottom-right and handle viewport collisions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/workspace/**/form/share', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          token: 'fixture-token',
          tier: 'workspace',
          anonymous: false,
          submission_access: 'none',
          share_url: 'https://appflowy.test/form/fixture-token',
          created_at: '2026-11-11T00:00:00Z',
        },
      },
    })
  );
  await page.goto('/playwright/fixtures/form/refactor.html');
  await page.getByRole('button', { name: 'Mount form body' }).click();
  for (let index = 0; index < 4; index++) await addFormQuestion(page, 'RichText');
  let card = page.getByTestId('form-question-card').first();
  let trigger = card.getByTestId('form-question-menu-trigger');
  const menu = page.getByRole('menu');
  await card.hover();
  await trigger.click();
  await expect(menu).toHaveAttribute('data-side', 'bottom');
  await expect(menu).toHaveAttribute('data-align', 'end');
  await expect
    .poll(async () => {
      const button = (await trigger.boundingBox())!;
      const popup = (await menu.boundingBox())!;
      return Math.max(
        Math.abs(popup.x + popup.width - button.x - button.width),
        Math.abs(popup.y - button.y - button.height)
      );
    })
    .toBeLessThanOrEqual(1);
  const cardBounds = (await card.boundingBox())!;
  const buttonBounds = (await trigger.boundingBox())!;
  expect(Math.abs(cardBounds.x + cardBounds.width - buttonBounds.x - buttonBounds.width - 16)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('question-menu-desktop-anchor.png') });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 720, height: 480 });
  card = page.getByTestId('form-question-card').nth(3);
  trigger = card.getByTestId('form-question-menu-trigger');
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await trigger.click();
  await expect(menu).toHaveAttribute('data-side', 'top');
  await expect
    .poll(async () => {
      const button = (await trigger.boundingBox())!;
      const popup = (await menu.boundingBox())!;
      return Math.max(
        Math.abs(popup.x + popup.width - button.x - button.width),
        Math.abs(popup.y + popup.height - button.y)
      );
    })
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 720, height: 240 });
  await card.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const popup = (await menu.boundingBox())!;
      return popup.y >= -1 && popup.y + popup.height <= 241;
    })
    .toBe(true);
  await menu.getByRole('menuitem', { name: 'Remove from form' }).scrollIntoViewIfNeeded();
  await expect(menu.getByRole('menuitem', { name: 'Remove from form' })).toBeInViewport();
});

test('Form uses the desktop tab icon, full-width title, and Layout settings without Sort', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/workspace/**/form/share', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          token: 'fixture-token',
          tier: 'workspace',
          anonymous: false,
          submission_access: 'none',
          share_url: 'https://appflowy.test/form/fixture-token',
          created_at: '2026-11-11T00:00:00Z',
        },
      },
    })
  );
  await page.goto('/playwright/fixtures/form/refactor.html');
  await page.getByRole('button', { name: 'Mount form body' }).click();
  const title = page.getByRole('textbox', { name: 'Form title', exact: true });
  const copy = page.getByTestId('form-respondent-copy');
  await expect.poll(async () => (await title.boundingBox())!.width).toBe(600);
  await expect(title).toHaveCSS('height', '36px');
  await title.click();
  await title.pressSequentially('Customer feedback for the community');
  await title.press('Tab');
  await expect(title).toHaveCSS('height', '36px');

  const icon = page.getByTestId('fixture-tab-bar').getByTestId('form-view-icon');
  await expect(icon).toHaveAttribute('viewBox', '0 0 20 20');
  await expect(icon).toHaveCSS('width', '16px');
  await expect(icon).toHaveCSS('height', '16px');
  await expect(page.getByTestId('database-actions-settings')).toBeVisible();
  await expect(page.getByTestId('database-actions-sort')).toHaveCount(0);
  await expect(page.getByTestId('database-actions-filter')).toHaveCount(0);
  await page.getByTestId('database-actions-settings').click();
  await expect(page.getByTestId('form-settings-menu').getByRole('menuitem')).toHaveCount(1);
  await page.getByTestId('database-layout-settings-trigger').click();
  await expect(page.getByTestId(`database-layout-option-${DatabaseViewLayout.Form}`)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect.poll(() => icon.locator('path').evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(228, 232, 245)');
  await page.screenshot({ path: test.info().outputPath('form-tab-settings-dark.png') });
  await page.setViewportSize({ width: 480, height: 600 });
  await expect
    .poll(async () => {
      const field = (await title.boundingBox())!;
      const column = (await copy.boundingBox())!;
      return Math.abs(field.width - column.width);
    })
    .toBeLessThanOrEqual(1);
  await expect(title).toHaveValue('Customer feedback for the community');
});

test('sharing shows pending persistence and copies the authoritative URL without resizing its button', async ({
  page,
}) => {
  let acceptPatch!: () => void;
  const patchAccepted = new Promise<void>((resolve) => {
    acceptPatch = resolve;
  });
  const url = 'https://appflowy.test/form/fixture-token';
  await page.route('**/api/workspace/**/form/share', async (route) => {
    const patch = route.request().method() === 'PATCH';
    if (patch) await patchAccepted;
    await route.fulfill({
      json: {
        code: 0,
        data: {
          token: 'fixture-token',
          tier: 'workspace',
          anonymous: patch,
          submission_access: 'none',
          share_url: url,
          created_at: '2026-11-11T00:00:00Z',
        },
      },
    });
  });
  await page.goto('/playwright/fixtures/form/refactor.html');
  await page.getByRole('button', { name: 'Mount form body' }).click();
  await page.getByTestId('form-share-button').click();
  await page.getByTestId('form-share-anonymous-toggle').click();
  await expect(page.getByRole('progressbar', { name: 'Saving form settings' })).toBeVisible();
  const copy = page.getByRole('button', { name: 'Copy form link', exact: true });
  const before = await copy.boundingBox();
  await copy.click();
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Copied' })).toBeVisible();
  expect((await copy.boundingBox())!.width).toBe(before!.width);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  acceptPatch();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByTestId('form-access-banner')).toHaveAttribute('data-anonymous', 'true');
});
