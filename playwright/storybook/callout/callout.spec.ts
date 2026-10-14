import { expect, Page, test } from '@playwright/test';

async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement('span');

    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;

    probe.remove();
    return color;
  }, token);
}

const block = (page: Page) => page.getByTestId('callout').first();
async function menu(page: Page) {
  // Initial editor layout can reset the hover controls; move again after that settles.
  await expect(async () => {
    await page.mouse.move(0, 0);
    await block(page).getByText('Hello World', { exact: true }).hover();
    await expect(page.getByTestId('hover-controls')).toHaveCSS('opacity', '1', { timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.getByTestId('drag-block').click();
  return page.getByTestId('controls-menu');
}

test.beforeEach(async ({ page }, info) => {
  await page.goto(`/iframe.html?id=editor-blocks-callout--editing&viewMode=story&theme=${info.project.name}`);
  await expect(block(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
});

test('emoji selection, icon removal and preset restoration', async ({ page }) => {
  await block(page).getByTestId('callout-icon-button').click();
  await page.getByTestId('icon-popover-tab-emoji').click();
  await page.getByRole('button', { name: '😀' }).click();
  await expect(block(page).getByTestId('callout-icon-button')).toContainText('😀');
  await block(page).getByTestId('callout-icon-button').click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(block(page).getByTestId('callout-icon-button')).toHaveCount(0);
  await expect(block(page)).toHaveAttribute('data-callout-icon', 'removed');
  const actions = await menu(page);

  await actions.getByRole('button', { name: 'Quick Style', exact: true }).click();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(block(page).getByTestId('callout-icon-button')).toBeVisible();
  await expect(block(page).locator('svg')).toHaveCount(1);
});

test('Flutter: Enter in the middle of a sentence keeps the remainder in a child', async ({ page }) => {
  const text = block(page).getByText('Hello World', { exact: true });

  await text.click();
  await text.evaluate((element) => {
    const range = document.createRange();
    const selection = window.getSelection()!;

    range.setStart(element.firstChild!, 5);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  // Slate throttles native selectionchange notifications by 100 ms.
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(block(page).locator('[data-block-type="paragraph"]')).toHaveCount(1);
  await expect(block(page).locator('[data-block-type="paragraph"]')).toHaveText(' World');
  await expect(block(page).locator(':scope > .text-element')).toContainText('Hello');
});

test('preset hover and text swatches use the design tokens', async ({ page }, info) => {
  const actions = await menu(page);

  await actions.getByRole('button', { name: 'Quick Style', exact: true }).click();
  const infoButton = page.getByRole('button', { name: 'Info', exact: true });
  await expect.poll(async () => Math.round((await infoButton.boundingBox())?.height || 0)).toBe(32);
  await infoButton.hover();
  await expect(infoButton).toHaveCSS('border-color', await tokenColor(page, '--block-border-color-12'));
  await infoButton.click();
  await expect(block(page)).toHaveCSS('color', await tokenColor(page, '--block-text-color-12'));
  const nextMenu = await menu(page);

  await nextMenu.getByRole('button', { name: 'Text Color', exact: true }).click();
  const jade = page.getByRole('button', { name: 'Jade', exact: true });

  await expect(jade.locator('span')).toHaveCSS('color', await tokenColor(page, '--palette-text-color-10'));
  await jade.click();
  await expect(block(page)).toHaveCSS('color', await tokenColor(page, '--block-text-color-10'));
  await page.screenshot({ path: `test-results/callout-color-${info.project.name}.png` });
});

test('Delete uses red text and standard hover fill; other actions remain neutral', async ({ page }, info) => {
  const actions = await menu(page);
  const deleteButton = actions.getByTestId('delete');

  await deleteButton.hover();
  await expect(deleteButton).toHaveCSS('color', await tokenColor(page, '--text-error'));
  await expect(deleteButton).toHaveCSS('background-color', await tokenColor(page, '--fill-content-hover'));
  await page.screenshot({ path: `test-results/callout-delete-${info.project.name}.png` });
  await actions.getByTestId('duplicate').hover();
  await expect(actions.getByTestId('duplicate')).not.toHaveCSS('color', await tokenColor(page, '--text-error'));
  await deleteButton.click();
  await expect(page.getByText('Hello World', { exact: true })).toHaveCount(0);
});

test('removing an icon adds four pixels and keeps child text aligned', async ({ page }) => {
  const callout = page.getByTestId('callout').nth(1);
  const positions = await callout.evaluate((el) => {
    const first = el.querySelector(':scope > .text-element .text-content')!.getBoundingClientRect();
    const child = el.querySelector('[data-block-type="paragraph"] .text-content')!.getBoundingClientRect();
    const row = el.querySelector(':scope > .text-element')!;

    return { first: first.left, child: child.left, padding: getComputedStyle(row).paddingLeft };
  });

  expect(positions.padding).toBe('4px');
  expect(positions.first).toBe(positions.child);
});

test('read-only callouts have no interactive icon picker', async ({ page }, info) => {
  await page.goto(`/iframe.html?id=editor-blocks-callout--read-only&viewMode=story&theme=${info.project.name}`);
  await expect(page.getByTestId('callout')).toHaveCount(10);
  await expect(block(page).getByTestId('callout-icon-button')).toBeDisabled();
  await page.screenshot({ path: `test-results/callout-presets-${info.project.name}.png`, fullPage: true });
});

test('Flutter: selecting a catalog icon preserves its SVG and chosen color', async ({ page }) => {
  await block(page).getByTestId('callout-icon-button').click();
  await page.getByTestId('icon-popover-tab-icon').click();
  await page.getByPlaceholder('Search').fill('help-question-1');
  const icon = page.getByRole('button', { name: 'help question 1', exact: true });

  await expect(icon).toBeVisible();
  const paths = await icon.locator('svg').innerHTML();

  await icon.click();
  await page.locator('[role="dialog"] .grid.grid-cols-6 button').first().click();
  await expect(block(page).getByTestId('callout-icon-button').locator('svg')).toHaveCount(1);
  expect(await block(page).getByTestId('callout-icon-button').locator('svg').innerHTML()).toBe(paths);
});

test('uploaded custom icons render and can be removed', async ({ page }) => {
  await block(page).getByTestId('callout-icon-button').click();
  await page.getByTestId('icon-popover-tab-upload').click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'callout.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="blue"/></svg>'
    ),
  });
  await expect(block(page).getByTestId('callout-icon-button').locator('img')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml;base64,/
  );
  await block(page).getByTestId('callout-icon-button').click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(block(page).getByTestId('callout-icon-button')).toHaveCount(0);
});

test('all ten quick styles apply their background and text colors', async ({ page }) => {
  const styles = [
    ['Basic', 20],
    ['Info', 12],
    ['Tip', 10],
    ['Warning', 4],
    ['Alert', 1],
    ['Insight', 14],
    ['Idea', 16],
    ['Spark', 2],
    ['Context', 6],
    ['Note', 8],
  ] as const;

  for (const [index, [name, token]] of styles.entries()) {
    const actions = await menu(page);

    await actions.getByRole('button', { name: 'Quick Style', exact: true }).click();
    if (index >= 5) await page.getByRole('button', { name: 'Special styles', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(block(page)).toHaveCSS('background-color', await tokenColor(page, `--block-bg-color-${token}`));
    await expect(block(page)).toHaveCSS('color', await tokenColor(page, `--block-text-color-${token}`));
  }
});

test('Flutter: the options menu converts a callout and keeps its text', async ({ page }) => {
  const actions = await menu(page);

  await actions.getByRole('button', { name: 'Turn into', exact: true }).click();
  await page.getByRole('button', { name: 'Heading 1', exact: true }).click();
  await expect(page.locator('[data-block-type="heading"]').getByText('Hello World', { exact: true })).toBeVisible();
  await expect(page.getByTestId('callout')).toHaveCount(2);
});

test('Flutter: insert a callout from the slash menu', async ({ page }) => {
  await page.getByText('Following paragraph', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/callout');
  await page.getByTestId('slash-panel').getByText('Callout', { exact: true }).click();
  await expect(page.getByTestId('callout')).toHaveCount(4);
  const inserted = page.getByTestId('callout').last();

  await expect(inserted.getByTestId('callout-icon-button').locator('svg')).toBeVisible();
  await page.keyboard.type('New callout');
  await expect(inserted).toContainText('New callout');
});
