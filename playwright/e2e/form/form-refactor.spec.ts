import { expect, test } from '@playwright/test';

import { addFormQuestion, openFormPreview, signInAndAddFormViewViaTabBar } from '../../support/form-test-helpers';
import { generateRandomEmail } from '../../support/test-config';

test('desktop form actions, multiline copy, question controls and local preview survive reload', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAndAddFormViewViaTabBar(page, request, generateRandomEmail());
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
  await cards.first().hover();
  await cards.first().getByTestId('form-question-menu-trigger').click();
  await page.getByRole('menuitemcheckbox', { name: 'Required' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Description', exact: true }).click();
  await page.keyboard.press('Escape');
  const description = cards.first().getByPlaceholder('Add description');
  await description.pressSequentially('What worked well?');
  await description.press('Tab');
  await expect(cards.first()).toHaveAttribute('data-required', 'true');

  await cards.nth(1).getByRole('button', { name: 'Add option', exact: true }).click();
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
  await preview.getByRole('button', { name: 'Close preview dialog' }).click();
  expect(submissionRequests).toBe(0);

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Form title', exact: true })).toHaveValue(
    'Customer feedback\nTell us more'
  );
  await expect(page.getByTestId('form-question-card').first()).toHaveAttribute('data-required', 'true');
  await expect(page.getByTestId('form-question-card').first().getByPlaceholder('Add description')).toHaveValue(
    'What worked well?'
  );
  await expect(page.getByTestId('form-question-card').nth(1).getByText('Product', { exact: true })).toBeVisible();
});
