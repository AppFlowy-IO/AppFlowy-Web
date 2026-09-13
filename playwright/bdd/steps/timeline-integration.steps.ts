import { BrowserContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import {
  AddPageSelectors,
  DatabaseViewSelectors,
  EditorSelectors,
  ShareSelectors,
  SlashCommandSelectors,
  TimelineSelectors,
} from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

interface IntegrationState {
  docViewId?: string;
  publishedUrl?: string;
  visitorContext?: BrowserContext;
  visitorPage?: Page;
}

const states = new WeakMap<Page, IntegrationState>();

function state(page: Page): IntegrationState {
  let current = states.get(page);

  if (!current) {
    current = {};
    states.set(page, current);
  }

  return current;
}

After(async ({ page }) => {
  const current = states.get(page);

  await current?.visitorContext?.close().catch(() => undefined);
  states.delete(page);
});

/** Sidebar `+` → Timeline; resolves once the new page renders its timeline. */
async function addTimelinePage(page: Page) {
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.getByTestId('add-timeline-page-button').click({ force: true });
  await expect(TimelineSelectors.view(page)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

Given('I am signed in to a fresh workspace', async ({ page, request, $testInfo }) => {
  $testInfo.setTimeout(240_000);
  await signInAndWaitForApp(page, request, generateRandomEmail());
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
  await page.waitForTimeout(3000);
});

When('I add a Timeline page from the sidebar', async ({ page }) => {
  await addTimelinePage(page);
});

Given('a timeline page exists', async ({ page }) => {
  await addTimelinePage(page);
});

Then('the timeline view renders with an empty canvas and a New row footer', async ({ page }) => {
  await expect(TimelineSelectors.view(page)).toBeVisible();
  await expect(TimelineSelectors.header(page)).toBeVisible();
  await expect(TimelineSelectors.bars(page)).toHaveCount(0);
  await expect(page.getByTestId('timeline-new-row')).toBeVisible();
});

Then('the view tab is a Timeline tab', async ({ page }) => {
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Timeline');
});

Given('I am editing a new document', async ({ page }) => {
  state(page).docViewId = await createDocumentPageAndNavigate(page);
});

When('I insert a Timeline through the slash menu', async ({ page }) => {
  const editor = EditorSelectors.firstEditor(page);

  await editor.click({ force: true });
  await page.keyboard.type('/');
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('slash-menu-timeline').click({ force: true });
});

Then('the timeline opens in the page modal', async ({ page }) => {
  const dialog = page.locator('[role="dialog"]').last();

  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId('timeline-view')).toBeVisible({ timeout: 30_000 });
});

When('I close the timeline page modal', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 });
});

Then('the document contains a timeline block', async ({ page }) => {
  const docViewId = state(page).docViewId ?? '';
  const block = page.locator(`#editor-${docViewId} [data-block-type="timeline"]`);

  await expect(block).toHaveCount(1, { timeout: 15_000 });
  await expect(block.getByTestId('timeline-view')).toBeVisible({ timeout: 30_000 });
});

When('I link the timeline database as a timeline through the slash menu', async ({ page }) => {
  await insertLinkedDatabaseViaSlash(page, state(page).docViewId ?? '', 'New Database', 'Timeline');
});

Then('the document contains a timeline block titled {string}', async ({ page }, title) => {
  const docViewId = state(page).docViewId ?? '';
  const block = page.locator(`#editor-${docViewId} [data-block-type="timeline"]`);

  await expect(block).toHaveCount(1, { timeout: 15_000 });
  await expect(block.getByTestId('timeline-view')).toBeVisible({ timeout: 30_000 });
  await expect(block).toContainText(title);
});

When('I publish the timeline page', async ({ page }) => {
  await ShareSelectors.shareButton(page).click({ force: true });
  const popover = ShareSelectors.sharePopover(page);

  await expect(popover).toBeVisible({ timeout: 10_000 });
  await popover.getByText('Publish', { exact: true }).click({ force: true });
  const publishButton = ShareSelectors.publishConfirmButton(page);

  await expect(publishButton).toBeEnabled({ timeout: 15_000 });
  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname.endsWith('/publish'),
    { timeout: 60_000 }
  );

  await publishButton.click({ force: true });
  expect((await response).ok()).toBeTruthy();
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 30_000 });
  const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  expect(namespace).not.toBe('');
  expect(publishName).not.toBe('');
  state(page).publishedUrl = `${new URL(page.url()).origin}/${namespace}/${publishName}`;
  await page.keyboard.press('Escape');
});

When('a visitor opens the published timeline', async ({ page, browser }) => {
  const current = state(page);
  const publishedUrl = current.publishedUrl ?? '';

  expect(publishedUrl).not.toBe('');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const visitor = await context.newPage();

  setupPageErrorHandling(visitor);
  current.visitorContext = context;
  current.visitorPage = visitor;
  await visitor.goto(publishedUrl, { waitUntil: 'domcontentloaded' });
  // The published container opens on its first view; switch to the Timeline tab.
  const timelineTab = DatabaseViewSelectors.viewTab(visitor).filter({ hasText: 'Timeline' });

  await expect(timelineTab).toBeVisible({ timeout: 60_000 });
  await timelineTab.click();
});

Then('the visitor sees the {string} and {string} bars without editing controls', async ({ page }, first, second) => {
  const visitor = state(page).visitorPage;

  if (!visitor) throw new Error('The visitor page was not opened');
  await expect(TimelineSelectors.view(visitor)).toBeVisible({ timeout: 60_000 });
  await expect(TimelineSelectors.barByTitle(visitor, first)).toBeVisible({ timeout: 30_000 });
  await expect(TimelineSelectors.barByTitle(visitor, second)).toBeVisible();
  await expect(visitor.getByTestId('timeline-new-row')).toHaveCount(0);
  await expect(visitor.locator('[data-testid^="timeline-handle-"]')).toHaveCount(0);
});
