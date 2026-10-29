import path from 'node:path';

import { expect, type Page, type Response } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { createDocumentPageAndNavigate } from '../support/page-utils';

import type { Artifact, PresentationStatus, ReviewedStyle, StoredSession } from '../../src/components/presentation/server-contract';

const { When, Then } = createBdd();

interface State { name: string; uploads: number; analyses: number; reviews: number; style?: ReviewedStyle; secondUrl?: string }

const states = new WeakMap<Page, State>();
const endpoint = (response: Response, suffix: string, method: string) =>
  new URL(response.url()).pathname.endsWith(suffix) && response.request().method() === method;

async function data<T>(response: Response): Promise<T> {
  expect(response.status()).toBe(200);
  const body = await response.json();

  expect(body.code).toBe(0);
  return body.data;
}

async function newPage(page: Page, label: string) {
  const space = page.getByTestId('space-item').first();

  await space.hover();
  const id = await createDocumentPageAndNavigate(page);
  const title = page.getByTestId('page-title-input').filter({ visible: true }).first();

  await title.fill(`Template reuse ${label} ${Date.now()}`);
  await title.press('Tab');
  await page.locator(`#editor-${id}`).click();
  await page.keyboard.insertText('Review the project plan, confirm the owner, and agree on the next milestone.');
}

async function openSetup(page: Page) {
  await page.getByTestId('present-button').click();
  await page.getByRole('menuitem', { name: 'Generate AI ppt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create presentation', exact: true })).toBeVisible();
}

When('the test user uploads and reviews the template fixture on a new page', async ({ page }) => {
  const state: State = { name: `Template reuse ${Date.now()}`, uploads: 0, analyses: 0, reviews: 0 };

  states.set(page, state);
  page.on('request', (request) => {
    const url = new URL(request.url());

    if (!url.pathname.startsWith('/api/presentation/')) return;
    if (url.pathname.endsWith('/template') && request.method() === 'POST') state.uploads++;
    if (/\/styles\/[^/]+\/analyze$/.test(url.pathname) && request.method() === 'POST') state.analyses++;
    if (/\/styles\/[^/]+\/review$/.test(url.pathname) && request.method() === 'PUT') state.reviews++;
  });
  await newPage(page, 'upload');
  // Reopening after the editor sync prevents a source-revision refresh from aborting the upload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const statusResponse = page.waitForResponse((response) => endpoint(response, '/status', 'GET'));

  await openSetup(page);
  const status = await data<PresentationStatus>(await statusResponse);

  expect(status.maxTemplateBytes).toBe((status.plan === 'free' ? 5 : 50) * 1024 * 1024);
  await page.getByRole('button', { name: 'Import template', exact: true }).click();
  // A previous run/user selection is intentionally restored across pages. Start a new upload
  // through the picker rather than assuming an empty workspace preference.
  const templates = page.getByRole('button', { name: 'Saved templates', exact: true });

  if (await templates.isVisible()) {
    await templates.click();
    await page.getByRole('menuitemradio', { name: 'Upload a new template', exact: true }).click();
  }

  await expect(page.getByLabel('Import presentation template', { exact: true })).toBeEnabled();
  await expect(page.getByText(`.pptx or .potx · up to ${status.maxTemplateBytes! / (1024 * 1024)} MB`, { exact: true })).toBeVisible();
  const upload = page.waitForResponse((response) => endpoint(response, '/template', 'POST'));
  const analysis = page.waitForResponse((response) => /\/styles\/[^/]+\/analyze$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST', { timeout: 100_000 });

  await page.getByLabel('Import presentation template', { exact: true }).setInputFiles(
    path.resolve('playwright/live-presentation/fixtures/brand-template.pptx')
  );
  const uploadResponse = await upload;

  await expect(page.getByLabel('Template name', { exact: true })).toBeVisible();
  expect(uploadResponse.status()).toBe(200);
  const analyzed = await data<Artifact<ReviewedStyle>>(await analysis);
  const candidate = { style: analyzed.content };

  expect(analyzed.origin).toBe('template');
  expect(candidate.style.reference.version).toBe(2);
  expect(candidate.style.analysis?.description.length).toBeGreaterThan(0);
  await expect(page.getByLabel('AI theme analysis', { exact: true })).toContainText(candidate.style.analysis!.description);
  expect(candidate.style.theme.color.toLowerCase()).toBe('#1f7a8c');
  expect(candidate.style.theme.font).toBe('Arial');
  expect(candidate.style.templateSlides).toHaveLength(2);
  await page.getByLabel('Template name', { exact: true }).fill(state.name);
  const review = page.waitForResponse((response) => endpoint(response, `/styles/${candidate.style.reference.id}/review`, 'PUT'));
  const session = page.waitForResponse((response) => endpoint(response, '/session', 'PUT'));

  await page.getByRole('button', { name: 'Use this template', exact: true }).click();
  state.style = (await data<Artifact<ReviewedStyle>>(await review)).content;
  expect(state.style.reference).toEqual({ id: candidate.style.reference.id, version: 3 });
  expect((await data<StoredSession>(await session)).payload.style).toEqual(state.style.reference);
});

Then('the saved template is immediately selectable in the presentation dialog', async ({ page }) => {
  const { name } = states.get(page)!;

  await expect(page.getByRole('button', { name: 'Saved templates', exact: true })).toHaveText(name);
  await page.getByRole('button', { name: 'Remove template' }).click();
  await page.getByRole('button', { name: 'Saved templates', exact: true }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.getByText(/Template selected\./)).toBeVisible();
  expect(states.get(page)!.reviews).toBe(1);
});

When('the test user selects that template on another new page', async ({ page }) => {
  const { name } = states.get(page)!;

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await newPage(page, 'reuse');
  states.get(page)!.secondUrl = page.url();
  await openSetup(page);
  // Explicitly choose a different style first, even if the actor's last preference was restored.
  const builtinSession = page.waitForResponse((response) => endpoint(response, '/session', 'PUT'));

  await page.getByRole('button', { name: 'AppFlowy themes', exact: true }).click();
  expect((await data<StoredSession>(await builtinSession)).payload.style).toBeNull();
  await page.getByRole('button', { name: 'Import template', exact: true }).click();
  await page.getByRole('button', { name: 'Saved templates', exact: true }).click();
  const session = page.waitForResponse((response) => endpoint(response, '/session', 'PUT'));

  await page.getByRole('menuitemradio', { name, exact: true }).click();
  expect((await data<StoredSession>(await session)).payload.style).toEqual(states.get(page)!.style!.reference);
  await expect(page.getByLabel('Template accent color')).toHaveValue('#1f7a8c');
  await expect(page.getByText(/Template selected\./)).toBeVisible();
});

Then('reopening the second page restores the same reviewed template without another upload', async ({ page }) => {
  const { name } = states.get(page)!;

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(states.get(page)!.secondUrl!);
  await openSetup(page);
  await expect(page.getByRole('button', { name: 'Saved templates', exact: true })).toHaveText(name);
  await expect(page.getByLabel('Template accent color')).toHaveValue('#1f7a8c');
  await expect(page.getByRole('button', { name: 'Use this template', exact: true })).toHaveCount(0);
  expect(states.get(page)!.uploads).toBe(1);
  expect(states.get(page)!.analyses).toBe(1);
  expect(states.get(page)!.reviews).toBe(1);
});
