import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then } = createBdd();

type ScrollTestWindow = Window & {
  __tabReturnState?: { editor: Element; scrollTop: number };
};

When('I fill the document with enough content to scroll', async ({ page }) => {
  const editor = page.getByTestId('editor-content').first();

  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.insertText(
    Array.from({ length: 60 }, (_, index) => `Scroll regression paragraph ${index + 1}`).join('\n')
  );
  await expect(editor).toContainText('Scroll regression paragraph 60');
  await expect
    .poll(() =>
      page
        .locator('.appflowy-scroll-container')
        .first()
        .evaluate((element) => element.scrollHeight)
    )
    .toBeGreaterThan(1500);
});

When('I return to the document tab after scrolling down', async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.querySelector('[data-testid="editor-content"]');
    const scroller = document.querySelector('.appflowy-scroll-container');

    if (!editor || !scroller) throw new Error('The document is not mounted');
    (document.activeElement as HTMLElement | null)?.blur();
    scroller.scrollTop = 700;
    (window as ScrollTestWindow).__tabReturnState = { editor, scrollTop: scroller.scrollTop };
  });
  await expect
    .poll(() =>
      page
        .locator('.appflowy-scroll-container')
        .first()
        .evaluate((el) => el.scrollTop)
    )
    .toBe(700);

  const permissionRefresh = page.waitForResponse((response) => response.url().includes('/permission?collab_type='));

  // Headless browsers do not consistently hide background tabs. Deliver the
  // same lifecycle events explicitly so this also exercises revalidation in CI.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect([200, 304]).toContain((await permissionRefresh).status());
  await expect(page.getByTestId('page-title-input')).toBeVisible();
  // Let the title's animation-frame autofocus and browser scroll settle.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
});

Then('the document keeps its scroll position without focusing the title', async ({ page }) => {
  const state = await page.evaluate(() => {
    const before = (window as ScrollTestWindow).__tabReturnState;
    const editor = document.querySelector('[data-testid="editor-content"]');
    const scroller = document.querySelector('.appflowy-scroll-container');

    if (!before || !scroller) throw new Error('The scroll checkpoint is missing');
    return {
      sameEditor: before.editor === editor,
      scrollDelta: Math.abs(scroller.scrollTop - before.scrollTop),
      titleFocused: document.activeElement?.getAttribute('data-testid') === 'page-title-input',
    };
  });

  expect(state.sameEditor).toBe(true);
  expect(state.titleFocused, 'permission refresh must not autofocus the title').toBe(false);
  expect(state.scrollDelta, 'returning to the tab must preserve the reading position').toBeLessThan(2);
  await expect(page.getByTestId('editor-content').first()).toContainText('Scroll regression paragraph 60');
});
