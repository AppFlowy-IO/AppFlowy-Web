import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { HEADER_HEIGHT } from '../../../src/application/constants';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createChildDocumentUnder, renameCurrentPage } from '../../support/duplicate-test-helpers';
import { createDocumentPageAndNavigate, currentViewIdFromUrl } from '../../support/page-utils';
import { AddPageSelectors, EditorSelectors, ShareSelectors } from '../../support/selectors';
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
const articleLayouts = new WeakMap<Page, { left: number; width: number; scrollTop: number }>();
const renamedHeadingIds = new WeakMap<Page, string>();
const beforeOutlineMoves = new WeakMap<Page, { height: number; headings: string[] }>();
const outlineColors: Record<string, { bgColor: string; token: number }> = {
  default: { bgColor: '', token: 20 },
  purple: { bgColor: 'appflowy_them_color_tint1', token: 14 },
  green: { bgColor: 'appflowy_them_color_tint7', token: 8 },
};

function outlineColor(name: string) {
  const color = outlineColors[name];

  if (!color) throw new Error(`Unknown outline color: ${name}`);
  return color;
}

async function expectedOutlineColors(page: Page, name: string) {
  return currentPage(page).evaluate(
    ({ name, token }) => {
      const reference = document.createElement('div');

      document.body.append(reference);
      reference.style.backgroundColor = `var(--block-icon-color-${token})`;
      reference.style.color = `var(--block-text-color-${token})`;
      const accent = getComputedStyle(reference).backgroundColor;
      const text = getComputedStyle(reference).color;

      reference.style.backgroundColor = `var(--block-bg-color-${token})`;
      const background = getComputedStyle(reference).backgroundColor;

      reference.style.backgroundColor =
        name === 'default'
          ? 'var(--fill-content-hover)'
          : `color-mix(in srgb, var(--block-bg-hover-color-${token}) 60%, transparent)`;
      const fill = getComputedStyle(reference).backgroundColor;

      reference.remove();
      return { accent, text, background, fill };
    },
    { name, token: outlineColor(name).token }
  );
}

function articleLayout(page: Page) {
  return currentPage(page)
    .getByTestId('editor-content')
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const scroller = element.closest<HTMLElement>('.appflowy-scroll-container');

      return { left: bounds.left, width: bounds.width, scrollTop: scroller?.scrollTop ?? window.scrollY };
    });
}

async function openOutlineDocument(page: Page, request: APIRequestContext, count: number, paragraphs = 6) {
  await page.setViewportSize({ width: 1440, height: 900 });
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
      Array.from({ length: paragraphs }, () => '<p>Article content for navigating between sections.</p>').join('')
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
}

Given('a dockable outline document with {int} headings is open', async ({ page, request }, count: number) => {
  await openOutlineDocument(page, request, count);
});

Given('a compact dockable outline document with 3 headings is open', async ({ page, request }) => {
  await openOutlineDocument(page, request, 3, 0);
});

Given('a multi-column dockable outline document is open', async ({ page, request }) => {
  await openOutlineDocument(page, request, 3, 24);
  // Use real Slate columns and blocks so the browser measures their rendered layout.
  await page.evaluate(() => {
    const editor = (window as Window & { __TEST_EDITOR__?: YjsEditor }).__TEST_EDITOR__;

    if (!editor) throw new Error('The outline editor is unavailable');
    const nodes = editor.children.slice();
    const indexes = nodes.flatMap((node, index) => ('type' in node && node.type === 'heading' ? [index] : []));
    const left = nodes.slice(indexes[0], indexes[2]);
    const right = nodes.slice(indexes[2]);
    const spacers = right.splice(1, 5);

    right.unshift(...spacers);
    editor.deselect();
    editor.withoutNormalizing(() => {
      for (let index = nodes.length - 1; index >= indexes[0]; index--) {
        editor.apply({ type: 'remove_node', path: [index], node: nodes[index] });
      }

      editor.apply({
        type: 'insert_node',
        path: [indexes[0]],
        node: {
          type: 'simple_columns',
          blockId: 'outline-columns',
          data: {},
          children: [
            { type: 'simple_column', blockId: 'outline-left', data: { ratio: 0.5 }, children: left },
            { type: 'simple_column', blockId: 'outline-right', data: { ratio: 0.5 }, children: right },
          ],
        } as BlockNode,
      });
    });
  });
  await expect(EditorSelectors.slateEditor(page).locator('[data-block-type="simple_column"]')).toHaveCount(2);
  await expect(EditorSelectors.slateEditor(page).locator('.heading')).toHaveCount(3);
});

Given('a dockable outline document with equal-height headings is open', async ({ page, request }) => {
  await openOutlineDocument(page, request, 3, 12);
  await page.evaluate(() => {
    const testWindow = window as Window & { __TEST_EDITOR__?: YjsEditor; __TEST_CUSTOM_EDITOR__?: typeof CustomEditor };
    const editor = testWindow.__TEST_EDITOR__;
    const command = testWindow.__TEST_CUSTOM_EDITOR__;

    if (!editor || !command) throw new Error('The outline editor is unavailable');
    for (const node of editor.children) {
      if ('type' in node && node.type === 'heading' && node.blockId) {
        command.setBlockData(editor, node.blockId, { level: 6 });
      }
    }
  });
  await expect(EditorSelectors.slateEditor(page).locator('.heading.level-6')).toHaveCount(3);
});

When(
  'I position outline document heading {string} {int} pixels above the reading line',
  async ({ page }, text: string, pixels: number) => {
    await currentPage(page)
      .locator('.heading')
      .filter({ has: currentPage(page).getByText(text, { exact: true }) })
      .first()
      .evaluate(
        (element, { headerHeight, pixels }) => {
          const scroller = element.closest<HTMLElement>('.appflowy-scroll-container');

          if (!scroller) throw new Error('The outline article scroll container is unavailable');
          const readingLine = Math.max(0, scroller.getBoundingClientRect().top) + headerHeight + 16;

          scroller.scrollTop += element.getBoundingClientRect().top - (readingLine - pixels);
        },
        { headerHeight: HEADER_HEIGHT, pixels }
      );
  }
);

When('I move the second outline heading directly below the first', async ({ page }) => {
  const target = currentPage(page);
  const editor = EditorSelectors.slateEditor(target);

  beforeOutlineMoves.set(
    page,
    await editor.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      headings: Array.from(element.querySelectorAll('.heading')).map((heading) => heading.id),
    }))
  );
  await target.evaluate(() => {
    const editor = (window as Window & { __TEST_EDITOR__?: YjsEditor }).__TEST_EDITOR__;

    if (!editor) throw new Error('The outline editor is unavailable');
    const indexes = editor.children.flatMap((node, index) => ('type' in node && node.type === 'heading' ? [index] : []));

    editor.apply({ type: 'move_node', path: [indexes[1]], newPath: [indexes[0] + 1] });
  });
});

Then('the outline editor height and heading order are unchanged', async ({ page }) => {
  const before = beforeOutlineMoves.get(page);

  if (!before) throw new Error('The original outline block layout was not recorded');
  const after = await EditorSelectors.slateEditor(currentPage(page)).evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    headings: Array.from(element.querySelectorAll('.heading')).map((heading) => heading.id),
  }));

  expect(after.headings).toEqual(before.headings);
  expect(after.height).toBeCloseTo(before.height, 0);
});

When('I scroll the outline article to the bottom', async ({ page }) => {
  await EditorSelectors.slateEditor(currentPage(page)).evaluate((element) => {
    const scroller = element.closest<HTMLElement>('.appflowy-scroll-container');

    if (!scroller) throw new Error('The outline article scroll container is unavailable');
    scroller.scrollTop = scroller.scrollHeight;
  });
});

When('I replace outline headings with page mentions and surrounding text', async ({ page }) => {
  const sourceUrl = page.url();
  const parentName = `Outline mentions ${Date.now()}`;

  await renameCurrentPage(page, parentName);
  await createChildDocumentUnder(page, parentName, 'Desktop guide');
  const desktopId = currentViewIdFromUrl(page);

  await createChildDocumentUnder(page, parentName, 'To-dos');
  const todosId = currentViewIdFromUrl(page);

  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
  await expect(EditorSelectors.slateEditor(page).locator('[data-block-type="heading"]')).toHaveCount(3);
  // Model a desktop-authored heading containing only a page mention, and a
  // heading containing a page mention followed by ordinary inline text.
  await page.evaluate(
    ({ desktopId, todosId }) => {
      const editor = (window as Window & { __TEST_EDITOR__?: YjsEditor }).__TEST_EDITOR__;

      if (!editor) throw new Error('The outline editor is unavailable');
      const headingIndexes = editor.children.flatMap((node, index) =>
        'type' in node && node.type === 'heading' ? [index] : []
      );

      [desktopId, todosId].forEach((pageId, index) => {
        const headingIndex = headingIndexes[index];
        const node = editor.children[headingIndex];

        if (!('children' in node)) throw new Error('The fixture heading is unavailable');
        const text = node.children[0];

        if (!('children' in text)) throw new Error('The fixture heading text is unavailable');
        const leaf = text.children[0];

        if (!('text' in leaf)) throw new Error('The fixture heading leaf is unavailable');
        const path = [headingIndex, 0, 0];

        editor.apply({ type: 'remove_text', path, offset: 0, text: leaf.text });
        editor.apply({ type: 'insert_node', path, node: { text: '@', mention: { type: 'page', page_id: pageId } } });
        if (index === 1)
          editor.apply({ type: 'insert_node', path: [headingIndex, 0, 1], node: { text: ' quick start' } });
      });
    },
    { desktopId, todosId }
  );
  await expect(page.locator('.heading .mention-content').first()).toHaveText('Desktop guide');
  await expect(page.locator('.heading .mention-content').nth(1)).toHaveText('To-dos');
  await page.mouse.move(400, 100);
});

Then('both outlines show the resolved page-mention headings', async ({ page }) => {
  const labels = ['Desktop guide', 'To-dos quick start', 'Section 3'];

  await expect(panel(page).locator('.dockable-outline-item')).toHaveText(labels);
  await expect(currentPage(page).locator('.outline-block .group .flex-grow')).toHaveText(labels);
  await expect(panel(page).getByRole('button', { name: 'Untitled heading', exact: true })).toHaveCount(0);
});

Then('all outline document headings are in the viewport', async ({ page }) => {
  const viewport = currentPage(page).viewportSize()!;
  const headings = currentPage(page).locator('.heading');

  await expect(headings).toHaveCount(3);
  for (const heading of await headings.all()) {
    await expect(heading).toBeInViewport();
    const bounds = await heading.boundingBox();

    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  }
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

When('I focus the dockable outline indicator', async ({ page }) => {
  await outline(page).getByTestId('dockable-outline-trigger').focus();
});

When('I press {string} in the dockable outline', async ({ page }, key: string) => {
  await currentPage(page).keyboard.press(key);
});

Then('dockable outline heading {string} has keyboard focus', async ({ page }, text: string) => {
  await expect(panel(page).getByRole('button', { name: text, exact: true })).toBeFocused();
});

Then('the dockable outline indicator has keyboard focus', async ({ page }) => {
  await expect(outline(page).getByTestId('dockable-outline-trigger')).toBeFocused();
});

When('I remember the outline article layout', async ({ page }) => {
  articleLayouts.set(page, await articleLayout(page));
});

Then('the outline article layout and scroll position are unchanged', async ({ page }) => {
  const before = articleLayouts.get(page);

  if (!before) throw new Error('The article layout was not recorded');
  const after = await articleLayout(page);

  expect(after.left).toBeCloseTo(before.left, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0);
});

When('I resize the outline viewport to height {int}', async ({ page }, height: number) => {
  await currentPage(page).setViewportSize({ width: 1440, height });
});

When('I scroll inside the dockable outline', async ({ page }) => {
  const list = panel(page).locator('.dockable-outline-list');
  const before = await list.evaluate((element) => element.scrollTop);

  await list.hover();
  await currentPage(page).mouse.wheel(0, 280);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
});

When('I append outline document heading {string}', async ({ page }, text: string) => {
  const editor = EditorSelectors.slateEditor(page);

  await editor.locator('.text-element').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(`# ${text}`);
  await expect(editor.locator('[data-block-type="heading"]').filter({ hasText: text })).toBeVisible();
  await page.mouse.move(400, 100);
});

When('I rename outline document heading {string} to {string}', async ({ page }, previous: string, text: string) => {
  const heading = EditorSelectors.slateEditor(page).locator('[data-block-type="heading"]').filter({ hasText: previous });
  const content = heading.locator('[data-slate-string]').first();

  await content.click();
  await content.selectText();
  await page.keyboard.insertText(text);
  await expect(heading).toHaveCount(0);
  await page.mouse.move(400, 100);
});

When(
  'I change mapped heading {string} to {string} while the outline is open',
  async ({ page }, previous: string, text: string) => {
    await expect(outline(page)).toHaveAttribute('data-expanded', 'true');
    const heading = page.locator('.heading').filter({ hasText: previous });
    const id = await heading.getAttribute('id');

    if (!id) throw new Error('The mapped heading has no anchor');
    renamedHeadingIds.set(page, id.replace(/^heading-/, ''));
    // Apply a real source-document edit without leaving the outline hover area.
    // This also exercises updates arriving while the navigation is already open.
    await page.evaluate(
      ({ id, text }) => {
        const editor = (window as Window & { __TEST_EDITOR__?: YjsEditor }).__TEST_EDITOR__;
        const index = editor?.children.findIndex((node) => (node as BlockNode).blockId === id);

        if (!editor || index === undefined || index < 0) throw new Error('The mapped heading is unavailable');
        const node = editor.children[index];

        if (!('children' in node)) throw new Error('The mapped heading has no text');
        const content = node.children[0];

        if (!('children' in content)) throw new Error('The mapped heading text is unavailable');
        const leaf = content.children[0];

        if (!('text' in leaf)) throw new Error('The mapped heading leaf is unavailable');
        const path = [index, 0, 0];

        editor.apply({ type: 'remove_text', path, offset: 0, text: leaf.text });
        editor.apply({ type: 'insert_text', path, offset: 0, text });
      },
      { id: id.replace(/^heading-/, ''), text }
    );
    await expect(page.locator(`[id="${id}"]`)).toHaveText(text);
  }
);

Then('both outlines list heading {string}', async ({ page }, text: string) => {
  await expect(panel(page).getByRole('button', { name: text, exact: true })).toBeVisible();
  await expect(currentPage(page).locator('.outline-block').getByText(text, { exact: true })).toBeVisible();
});

Then('the outline slash command is labeled {string}', async ({ page }, text: string) => {
  const command = page.getByTestId('slash-menu-outline');

  await expect(command.getByText(text, { exact: true })).toBeVisible();
  await expect(command.getByText('Outline', { exact: true })).toHaveCount(0);
});

Then('both outline titles are {string}', async ({ page }, text: string) => {
  await expect(panel(page)).toHaveAttribute('aria-label', text);
  await expect(panel(page).locator('.dockable-outline-header > span')).toHaveText(text);
  await expect(currentPage(page).locator('.outline-block').getByText(text, { exact: true })).toBeVisible();
});

Then('the outline link still targets the renamed heading', async ({ page }) => {
  const id = renamedHeadingIds.get(page);

  if (!id) throw new Error('The mapped heading anchor was not recorded');
  await expect.poll(() => new URL(currentPage(page).url()).searchParams.get('blockId')).toBe(id);
});

When('I turn outline document heading {string} into a paragraph', async ({ page }, text: string) => {
  const editor = EditorSelectors.slateEditor(page);
  const content = editor
    .locator('[data-block-type="heading"]')
    .filter({ hasText: text })
    .locator('[data-slate-string]')
    .first();

  await content.click();
  await content.selectText();
  await EditorSelectors.selectionToolbar(page).getByRole('button', { name: 'Text', exact: true }).click();
  await expect(editor.locator('[data-block-type="paragraph"]').filter({ hasText: text })).toBeVisible();
});

Then('dockable outline heading {string} is listed', async ({ page }, text: string) => {
  await expect(panel(page).getByRole('button', { name: text, exact: true })).toBeVisible();
});

Then('dockable outline heading {string} is not listed', async ({ page }, text: string) => {
  await expect(panel(page).getByRole('button', { name: text, exact: true })).toHaveCount(0);
});

When('I move the pointer to the dockable outline header', async ({ page }) => {
  await panel(page).locator('.dockable-outline-header').hover();
});

When('I hover dockable outline heading {string}', async ({ page }, text: string) => {
  await panel(page).getByRole('button', { name: text, exact: true }).hover();
});

Then(
  'dockable outline heading {string} has the {string} hover background',
  async ({ page }, text: string, color: string) => {
    const item = panel(page).getByRole('button', { name: text, exact: true });
    const expected = await expectedOutlineColors(page, color);

    expect(await item.evaluate((element) => element.matches(':hover'))).toBe(true);
    await expect(item).toHaveCSS('background-color', expected.fill);
  }
);

Then(
  'the active dockable outline item has the {string} selected background',
  async ({ page, $testInfo }, color: string) => {
    const expected = await expectedOutlineColors(page, color);

    await expect(panel(page).locator('[aria-current="location"]')).toHaveCSS('background-color', expected.fill);
    await $testInfo.attach(`outline-selected-${color}`, {
      body: await panel(page).screenshot(),
      contentType: 'image/png',
    });
  }
);

Then('dockable outline heading {string} has no selected background', async ({ page }, text: string) => {
  await expect(panel(page).getByRole('button', { name: text, exact: true })).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
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
  await expect(panel(page).locator('[aria-current="location"]')).toHaveCount(1);
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
  const viewport = currentPage(page).viewportSize()!;

  await expect
    .poll(async () => {
      const bounds = await panel(page).boundingBox();

      return bounds ? bounds.y + bounds.height : Infinity;
    })
    .toBeLessThanOrEqual(viewport.height - 39);
});

Then('the dockable outline has room for at least 8 headings', async ({ page }) => {
  await expect
    .poll(() =>
      panel(page)
        .locator('.dockable-outline-list')
        .evaluate((element) => {
          const row = element.querySelector('.dockable-outline-item')!.getBoundingClientRect();

          return Math.floor((element.clientHeight + 1) / row.height);
        })
    )
    .toBeGreaterThanOrEqual(8);
});

Then('the dockable outline indicator fits above the viewport bottom gap', async ({ page }) => {
  const bounds = await outline(page).getByTestId('dockable-outline-trigger').boundingBox();

  expect(bounds).toBeTruthy();
  expect(bounds!.height).toBeGreaterThan(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(currentPage(page).viewportSize()!.height - 39);
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

When(
  'I change the inline outline color to {string} while the dockable outline is open',
  async ({ page }, color: string) => {
    await expect(outline(page)).toHaveAttribute('data-expanded', 'true');
    await page.evaluate((bgColor) => {
      const testWindow = window as Window & {
        __TEST_EDITOR__?: YjsEditor;
        __TEST_CUSTOM_EDITOR__?: typeof CustomEditor;
      };
      const editor = testWindow.__TEST_EDITOR__;
      const command = testWindow.__TEST_CUSTOM_EDITOR__;
      const node = editor?.children.find((node) => (node as BlockNode).type === 'outline') as BlockNode | undefined;

      if (!editor || !command || !node) throw new Error('The inline outline is unavailable');
      command.setBlockData(editor, node.blockId, { bgColor });
    }, outlineColor(color).bgColor);
  }
);

Then('both outlines use the {string} color', async ({ page }, color: string) => {
  const expected = await expectedOutlineColors(page, color);
  const inline = currentPage(page).locator('.outline-block');

  await expect(inline).toHaveCSS('background-color', expected.background);
  await expect(inline).toHaveCSS('color', expected.text);
  await expect(outline(page).locator('.dockable-outline-marker-position .dockable-outline-marker')).toHaveCSS(
    'background-color',
    expected.accent
  );
  await expect(panel(page).locator('.dockable-outline-list-marker .dockable-outline-marker')).toHaveCSS(
    'background-color',
    expected.accent
  );
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

When('I open a page side peek from the outline document', async ({ page }) => {
  await AddPageSelectors.inlineAddButton(page).first().click();
  await AddPageSelectors.addDocumentButton(page).click();
  await expect(page.getByTestId('view-modal-close')).toBeVisible();
});

When('I close the page side peek from the outline document', async ({ page }) => {
  await page.getByTestId('view-modal-close').click();
  await expect(page.getByTestId('view-modal-close')).toBeHidden();
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

Then('dockable outline display mode {string} is selected', async ({ page, $testInfo }, mode: string) => {
  await panel(page).getByRole('button', { name: 'Outline display options' }).click();
  const target = currentPage(page);

  await expect(target.getByRole('menuitemradio', { name: mode, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(
    target.getByRole('menuitemradio', { name: mode === 'Always show' ? 'Show on hover' : 'Always show', exact: true })
  ).toHaveAttribute('aria-checked', 'false');
  await $testInfo.attach(`outline-display-${mode}`, {
    body: await target.getByRole('menu').screenshot(),
    contentType: 'image/png',
  });
  await panel(page).getByRole('button', { name: 'Outline display options' }).click();
});

When('I open the published outline in another tab', async ({ page }) => {
  const original = currentPage(page);
  const target = await page.context().newPage();

  await target.goto(original.url(), { waitUntil: 'domcontentloaded' });
  activePages.set(page, target);
  await expect(target.getByTestId('editor-content')).toBeVisible();
});

When('I return to the original published outline tab', async ({ page }) => {
  const target = publishedPages.get(page);

  if (!target) throw new Error('The original published outline tab is unavailable');
  await currentPage(page).close();
  activePages.set(page, target);
  await target.bringToFront();
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
