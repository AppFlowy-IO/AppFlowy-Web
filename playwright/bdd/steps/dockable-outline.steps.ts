import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { EditorSelectors, ShareSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

import type { YjsEditor } from '../../../src/application/slate-yjs';
import type { CustomEditor } from '../../../src/application/slate-yjs/command';
import type { BlockNode } from '../../../src/components/editor/editor.type';

const { Given, When, Then } = createBdd();
const publishedPages = new WeakMap<Page, Page>();
const activePages = new WeakMap<Page, Page>();
const currentPage = (page: Page) => activePages.get(page) ?? page;
const outline = (page: Page) => currentPage(page).getByTestId('dockable-outline');
const panel = (page: Page) => outline(page).locator('.dockable-outline-panel');

Given('a dockable outline document with {int} headings is open', async ({ page, request }, count: number) => {
  const email =
    process.env.APPFLOWY_E2E_OUTLINE_EMAIL || process.env.APPFLOWY_E2E_SIMPLE_TABLE_EMAIL || generateRandomEmail();

  await signInAndWaitForApp(page, request, email);
  await createDocumentPageAndNavigate(page);
  const editor = EditorSelectors.slateEditor(page);

  await expect(editor).toBeVisible();
  await editor.click();
  if (!count) return;
  const html = Array.from({ length: count }, (_, index) => {
    const level = (index % 6) + 1;

    return (
      `<h${level}>Section ${index + 1}</h${level}>` +
      Array.from({ length: 6 }, () => '<p>Article content for navigating between sections.</p>').join('')
    );
  }).join('');

  await page.evaluate(async (html) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob(['Outline article'], { type: 'text/plain' }),
      }),
    ]);
  }, html);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(editor.locator('[data-block-type="heading"]')).toHaveCount(count);
  await page.mouse.move(400, 100);
});

Given('the dockable outline uses the {string} theme', async ({ page }, theme: string) => {
  await currentPage(page).emulateMedia({ colorScheme: theme as 'light' | 'dark' });
  await expect(currentPage(page).locator('html')).toHaveAttribute('data-dark-mode', String(theme === 'dark'));
});

When('I hover the dockable outline indicator', async ({ page }) => {
  await outline(page).getByTestId('dockable-outline-trigger').hover();
});

When('I briefly leave and reenter the dockable outline', async ({ page }) => {
  const target = currentPage(page);

  await target.mouse.move(400, 100);
  await target.waitForTimeout(150);
  await expect(outline(page)).toHaveAttribute('data-expanded', 'true');
  await panel(page).hover();
  await target.waitForTimeout(350);
});

When('I leave the dockable outline', async ({ page }) => {
  await currentPage(page).mouse.move(400, 100);
});

When('I click dockable outline heading {string}', async ({ page }, text: string) => {
  await panel(page).getByRole('button', { name: text, exact: true }).click();
});

When('I scroll the document to outline heading {string}', async ({ page }, text: string) => {
  await currentPage(page)
    .locator('.heading')
    .filter({ has: currentPage(page).getByText(text, { exact: true }) })
    .first()
    .evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
});

Then('the dockable outline is absent', async ({ page }) => {
  await expect(outline(page)).toHaveCount(0);
});

Then('the dockable outline is collapsed', async ({ page }) => {
  await expect(outline(page)).toHaveAttribute('data-expanded', 'false');
  await expect(panel(page)).toBeHidden();
});

Then('the dockable outline is expanded', async ({ page }) => {
  await expect(outline(page)).toHaveAttribute('data-expanded', 'true');
  await expect(panel(page)).toHaveCSS('opacity', '1');
});

Then('the dockable outline contains {int} headings', async ({ page }, count: number) => {
  await expect(panel(page).locator('.dockable-outline-item')).toHaveCount(count);
});

Then('the editable dockable outline has no display settings', async ({ page }) => {
  await expect(panel(page).getByRole('button', { name: 'Outline display options' })).toHaveCount(0);
});

Then('dockable outline heading {string} is active', async ({ page }, text: string) => {
  await expect(panel(page).getByRole('button', { name: text, exact: true })).toHaveAttribute('aria-current', 'location');
});

Then('the document is at outline heading {string}', async ({ page }, text: string) => {
  const target = currentPage(page);
  const heading = target.locator('.heading').filter({ hasText: text }).first();

  await expect
    .poll(async () => heading.evaluate((element) => Math.round(element.getBoundingClientRect().top)))
    .toBeLessThan(100);
  await expect(panel(page).getByRole('button', { name: text, exact: true })).toHaveAttribute('aria-current', 'location');
  const blockId = await heading.getAttribute('id');

  expect(new URL(target.url()).searchParams.get('blockId')).toBe(blockId?.replace(/^heading-/, ''));
});

Then('the dockable outline fits above the viewport bottom gap', async ({ page }) => {
  const bounds = await panel(page).boundingBox();
  const viewport = currentPage(page).viewportSize()!;

  expect(bounds).toBeTruthy();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 39);
  expect(bounds!.height).toBeGreaterThanOrEqual(8 * 28 + 72);
});

Then('the dockable outline has an internal scrollbar', async ({ page }) => {
  expect(
    await panel(page)
      .locator('.dockable-outline-list')
      .evaluate((element) => element.scrollHeight - element.clientHeight)
  ).toBeGreaterThan(28);
});

Then('the dockable outline has no internal scrollbar', async ({ page }) => {
  expect(
    await panel(page)
      .locator('.dockable-outline-list')
      .evaluate((element) => element.scrollHeight - element.clientHeight)
  ).toBeLessThanOrEqual(1);
});

When('I move to the end of the outline document', async ({ page }) => {
  const editor = EditorSelectors.slateEditor(page);

  await editor.locator('.text-element').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
});

When('I customize the inline outline to purple and depth 2', async ({ page }) => {
  await expect(page.locator('.outline-block')).toBeVisible();
  // Exercise propagation of persisted Outline Block data.
  await page.evaluate(() => {
    const testWindow = window as Window & { __TEST_EDITOR__?: YjsEditor; __TEST_CUSTOM_EDITOR__?: typeof CustomEditor };
    const editor = testWindow.__TEST_EDITOR__;
    const command = testWindow.__TEST_CUSTOM_EDITOR__;
    const node = editor?.children.find((node) => (node as BlockNode).type === 'outline') as BlockNode | undefined;

    if (!editor || !command || !node) throw new Error('Inline outline editor is unavailable');
    command.setBlockData(editor, node.blockId, { depth: 2, bgColor: 'appflowy_them_color_tint1' });
  });
});

Then('the inline outline contains {int} headings', async ({ page }, count: number) => {
  await expect(currentPage(page).locator('.outline-block .group')).toHaveCount(count);
});

Then('both outlines share the purple accent', async ({ page }) => {
  const colors = await outline(page).evaluate((element) => {
    const docked = getComputedStyle(element.querySelector('.dockable-outline-marker')!);
    const inline = document.querySelector('.outline-block .group > div') as HTMLElement;
    const reference = document.createElement('div');

    reference.style.backgroundColor = getComputedStyle(inline).getPropertyValue('--outline-accent-strip');
    document.body.append(reference);
    const expected = getComputedStyle(reference).backgroundColor;

    reference.remove();
    return { docked: docked.backgroundColor, inline: expected };
  });

  expect(colors.docked).toBe(colors.inline);
  expect(await outline(page).evaluate((element) => element.style.getPropertyValue('--outline-accent'))).toBe(
    'var(--block-icon-color-14)'
  );
});

Then('the dockable outline uses the theme surface and text colors', async ({ page, $testInfo }) => {
  const colors = await panel(page).evaluate((element) => {
    const actual = getComputedStyle(element);
    const reference = document.createElement('div');

    reference.style.backgroundColor = 'var(--surface-layer-04)';
    reference.style.color = 'var(--block-text-color-20)';
    document.body.append(reference);
    const expected = getComputedStyle(reference);
    const result = [actual.backgroundColor, actual.color, expected.backgroundColor, expected.color];

    reference.remove();
    return result;
  });

  expect(colors.slice(0, 2)).toEqual(colors.slice(2));
  await $testInfo.attach('dockable-outline-theme', {
    body: await currentPage(page).screenshot(),
    contentType: 'image/png',
  });
});

Then('the active dockable outline item is visible in its scroll area', async ({ page }) => {
  await expect
    .poll(async () =>
      panel(page)
        .locator('[aria-current="location"]')
        .evaluate((element) => {
          const list = element.closest('.dockable-outline-list')!.getBoundingClientRect();
          const row = element.getBoundingClientRect();

          return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
        })
    )
    .toBe(true);
});

When('I open the inline comment panel for the outline document', async ({ page }) => {
  await page.getByTestId('inline-comment-toggle').click();
  await expect(page.getByTestId('inline-comment-sidebar')).toBeVisible();
});

When('I close the inline comment panel for the outline document', async ({ page }) => {
  await page.getByTestId('inline-comment-toggle').click();
  await expect(page.getByTestId('inline-comment-sidebar')).toBeHidden();
});

When('I visit the published outline document', async ({ page }) => {
  const popup = page.waitForEvent('popup');

  await ShareSelectors.visitSiteButton(page).click();
  const target = await popup;

  await target.waitForLoadState('domcontentloaded');
  publishedPages.set(page, target);
  activePages.set(page, target);
  await expect(target.getByTestId('editor-content')).toBeVisible();
});

When('I choose dockable outline display mode {string}', async ({ page }, mode: string) => {
  await panel(page).getByRole('button', { name: 'Outline display options' }).click();
  await currentPage(page).getByRole('menuitemradio', { name: mode, exact: true }).click();
});

When('I reload the outline document', async ({ page }) => {
  await currentPage(page).reload({ waitUntil: 'domcontentloaded' });
  await expect(currentPage(page).getByTestId('editor-content')).toBeVisible();
});

When('I return to the outline editor', async ({ page }) => {
  activePages.delete(page);
  await publishedPages.get(page)?.close();
  await page.bringToFront();
});
