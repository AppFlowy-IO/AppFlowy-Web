import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Page } from '@playwright/test';

import { asset, block, embed, expect, fixturePath, insert, more, snapshot, test } from '../../support/image';

const photo = (origin: string, index: number, prefix = 'Photo') => ({
  id: `${prefix}-${index}`,
  alt_description: `${prefix} ${index}`,
  urls: { thumb: `${origin}/fixtures/${prefix}-${index}.png`, full: `${origin}/fixtures/${prefix}-${index}.png` },
  links: { download_location: `https://api.unsplash.com/photos/${prefix}-${index}/download` },
  user: { name: 'Fixture author', links: { html: 'https://unsplash.com/@fixture' } },
});

async function unsplash(page: Page, origin: string, trackingStatus = 200) {
  const tracked: string[] = [];

  await page.route('https://api.unsplash.com/photos?*', (route) =>
    route.fulfill({
      headers: { 'x-total': '6', 'x-per-page': '18', 'access-control-expose-headers': 'x-total,x-per-page' },
      json: Array.from({ length: 6 }, (_, index) => photo(origin, index)),
    })
  );
  await page.route('https://api.unsplash.com/photos/*/download*', (route) => {
    tracked.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: trackingStatus,
      json: trackingStatus === 200 ? { url: `${origin}/fixtures/download.png` } : { errors: ['Rate limited'] },
    });
  });
  return tracked;
}

async function openUnsplash(page: Page) {
  await insert(page);
  await page.getByRole('tab', { name: 'Unsplash', exact: true }).click();
  return page.getByRole('textbox', { name: 'Search for an image' });
}

async function seed(page: Page, origin: string, data: Record<string, unknown>, options: Record<string, string> = {}) {
  await page.evaluate(() => localStorage.removeItem('image-fixture'));
  const params = new URLSearchParams({
    ...options,
    seed: JSON.stringify({ type: 'image', data, children: [{ type: 'text', children: [{ text: '' }] }] }),
  });

  await page.goto(new URL(`${fixturePath}?${params}`, origin).href);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
}

async function update(page: Page, data: Record<string, unknown>) {
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent('test-image-update', { detail })), data);
}

test('Flutter Unsplash shows loading until the photo request completes', async ({ page, integrationsURL }) => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });

  await unsplash(page, integrationsURL);
  await page.route('https://api.unsplash.com/photos?*', async (route) => {
    await gate;
    await route.fulfill({
      headers: { 'x-total': '1', 'x-per-page': '18', 'access-control-expose-headers': 'x-total,x-per-page' },
      json: [photo(integrationsURL, 0)],
    });
  });
  await openUnsplash(page);
  await expect(page.getByTestId('image-uploader').getByRole('progressbar')).toBeVisible();
  finish();
  await expect(page.getByRole('option', { name: 'Photo 0', exact: true })).toBeVisible();
  await expect(page.getByTestId('image-uploader').getByRole('progressbar')).toHaveCount(0);
});

for (const status of [200, 500]) {
  test(`Flutter Unsplash tracks selection without blocking insertion (tracking ${status})`, async ({
    page,
    integrationsURL,
  }) => {
    const tracked = await unsplash(page, integrationsURL, status);

    await openUnsplash(page);
    await page.getByRole('option', { name: 'Photo 1', exact: true }).click();
    await expect(snapshot(page)).toContainText('Photo-1.png');
    await expect(block(page).locator('.image-content > img')).toBeVisible();
    await expect.poll(() => tracked).toEqual(['/photos/Photo-1/download']);
    await page.reload();
    await expect(block(page).locator('.image-content > img')).toBeVisible();
  });
}

test('Flutter Unsplash Tab and Shift+Tab switch between search and the image grid', async ({
  page,
  integrationsURL,
}) => {
  await unsplash(page, integrationsURL);
  const search = await openUnsplash(page);
  const grid = page.getByRole('listbox', { name: 'Unsplash' });

  await expect(grid.getByRole('option')).toHaveCount(6);
  await expect(search).toBeFocused();
  await search.press('Tab');
  await expect(grid).toBeFocused();
  await expect(grid.getByRole('option').nth(0)).toHaveAttribute('aria-selected', 'true');
  await grid.press('Shift+Tab');
  await expect(search).toBeFocused();
  await expect(grid.getByRole('option', { selected: true })).toHaveCount(0);
});

test('Flutter Unsplash arrow keys respect grid boundaries and Enter selects the active image', async ({
  page,
  integrationsURL,
}) => {
  await unsplash(page, integrationsURL);
  await openUnsplash(page);
  const grid = page.getByRole('listbox', { name: 'Unsplash' });

  await grid.focus();
  for (const [key, index] of [
    ['ArrowRight', 1],
    ['ArrowRight', 2],
    ['ArrowRight', 2],
    ['ArrowDown', 5],
    ['ArrowLeft', 4],
    ['ArrowUp', 1],
    ['ArrowUp', 1],
  ] as const) {
    await grid.press(key);
    await expect(grid.getByRole('option').nth(index)).toHaveAttribute('aria-selected', 'true');
  }

  await grid.press('Enter');
  await expect(snapshot(page)).toContainText('Photo-1.png');
  await expect(page.getByTestId('image-uploader')).toHaveCount(0);
});

test('Flutter Unsplash pointer navigation continues from the hovered photo with arrow keys', async ({
  page,
  integrationsURL,
}) => {
  await unsplash(page, integrationsURL);
  await openUnsplash(page);
  const grid = page.getByRole('listbox', { name: 'Unsplash' });

  await grid.focus();
  await grid.getByRole('option').nth(2).hover();
  await expect(grid.getByRole('option').nth(2)).toHaveAttribute('aria-selected', 'true');
  await grid.press('ArrowLeft');
  await expect(grid.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await grid.press('Enter');
  await expect(snapshot(page)).toContainText('Photo-1.png');
});

test('Flutter Unsplash debounces search and ignores an obsolete response', async ({ page, integrationsURL }) => {
  await unsplash(page, integrationsURL);
  const searches: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('https://api.unsplash.com/search/photos?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query')!;

    searches.push(query);
    if (query === 'old') await gate;
    await route
      .fulfill({ json: { results: [photo(integrationsURL, 0, query)], total: 1, total_pages: 1 } })
      .catch(() => undefined);
  });
  const search = await openUnsplash(page);

  await expect(page.getByRole('option')).toHaveCount(6);
  await search.pressSequentially('old', { delay: 30 });
  await expect.poll(() => searches).toEqual(['old']);
  await search.fill('new');
  await expect(page.getByRole('option', { name: 'new 0' })).toBeVisible();
  release();
  await search.press('Tab');
  await expect(page.getByRole('option')).toHaveText(['']);
  await expect(page.getByRole('option', { name: 'old 0' })).toHaveCount(0);
  expect(searches).toEqual(['old', 'new']);
});

for (const status of [403, 429]) {
  test(`Flutter Unsplash reports provider rejection ${status} and can recover with another search`, async ({
    page,
    integrationsURL,
  }) => {
    await page.route('https://api.unsplash.com/photos?*', (route) =>
      route.fulfill({ status, json: { errors: ['Rate limited'] } })
    );
    await page.route('https://api.unsplash.com/search/photos?*', (route) =>
      route.fulfill({ json: { results: [photo(integrationsURL, 0)], total: 1, total_pages: 1 } })
    );
    const search = await openUnsplash(page);

    await expect(page.getByRole('alert')).toHaveText('Unable to load images. Please try again.');
    await search.fill('recovered');
    await expect(page.getByRole('option', { name: 'Photo 0' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('closing Unsplash cancels a pending search without changing the image', async ({ page, integrationsURL }) => {
  await unsplash(page, integrationsURL);
  const queries: string[] = [];

  await page.route('https://api.unsplash.com/search/photos?*', (route) => {
    queries.push(route.request().url());
    return route.fulfill({ json: { results: [], total: 0, total_pages: 0 } });
  });
  const search = await openUnsplash(page);

  await expect(page.getByRole('option')).toHaveCount(6);
  await page.clock.install();
  await search.fill('never requested');
  await search.press('Escape');
  await expect(page.getByTestId('image-uploader')).toHaveCount(0);
  await page.clock.fastForward(1000);
  expect(queries).toEqual([]);
  await expect(block(page).getByRole('button', { name: 'Add an image' })).toBeVisible();
});

test('Flutter replacement works through both toolbar and action menu using JPEG and GIF fixtures', async ({ page }) => {
  await insert(page);
  await page.locator('input[type=file]').setInputFiles(asset);
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await expect(snapshot(page)).toContainText('/fixtures/design.png');
  for (const [entry, extension] of [
    ['toolbar', 'jpeg'],
    ['menu', 'gif'],
  ]) {
    if (entry === 'toolbar') {
      await block(page).hover();
      await block(page).getByRole('button', { name: 'Replace', exact: true }).click();
    } else await (await more(page)).getByRole('button', { name: 'Replace', exact: true }).click();
    await page
      .locator('input[type=file]')
      .setInputFiles(path.resolve(`playwright/fixtures/images/flutter-sample.${extension}`));
    await expect(snapshot(page)).toContainText(`/fixtures/flutter-sample.${extension}`);
    await expect(block(page).locator('.image-content > img')).toBeVisible();
  }

  await page.reload();
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await expect(snapshot(page)).toContainText('flutter-sample.gif');
});

test('Flutter captions preserve typing, middle edits, selection, undo and external changes', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  const caption = block(page).getByRole('textbox', { name: 'Image caption' });
  const text = 'My image caption';

  for (let index = 0; index < text.length; index++) {
    await caption.press(text[index] === ' ' ? 'Space' : text[index]);
    await expect(caption).toHaveValue(text.slice(0, index + 1));
  }

  await caption.press('Home');
  await caption.press('ArrowRight');
  await caption.press('ArrowRight');
  await caption.pressSequentially(' edited');
  await expect(caption).toHaveValue('My edited image caption');
  await expect.poll(() => caption.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(9);
  await caption.press('Shift+ArrowLeft');
  await caption.press('d');
  await caption.press('Backspace');
  await caption.press('Delete');
  await expect(caption).toHaveValue('My editeimage caption');
  await page.reload();
  await expect(caption).toHaveValue('My editeimage caption');
  await page.getByRole('button', { name: 'Remote edit' }).click();
  await expect(caption).toHaveValue('collaborator');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(caption).toHaveValue('My editeimage caption');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(caption).toHaveValue('collaborator');
  await (await more(page)).getByRole('button', { name: 'Remove caption', exact: true }).click();
  await expect(caption).toHaveCount(0);
  await page.reload();
  await expect(caption).toHaveCount(0);
});

test('Flutter captions retain IME composition and multiline edits', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  const caption = block(page).getByRole('textbox', { name: 'Image caption' });

  await caption.pressSequentially('My caption');
  await caption.press('Home');
  for (let index = 0; index < 3; index++) await caption.press('ArrowRight');
  const input = await page.context().newCDPSession(page);

  await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
  await expect(caption).toHaveValue('My nicaption');
  await input.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
  await input.send('Input.insertText', { text: '你好' });
  await caption.press('Enter');
  await caption.pressSequentially('second line ');
  await expect(caption).toHaveValue('My 你好\nsecond line caption');
  await input.detach();
  await page.reload();
  await expect(caption).toHaveValue('My 你好\nsecond line caption');
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await expect(caption).toHaveAttribute('readonly', '');
});

test('Flutter pointer resize preserves aspect ratio and persists, and keyboard handles respect their axes', async ({
  page,
}) => {
  await embed(page);
  const image = block(page).locator('.image-content > img');
  const before = (await image.boundingBox())!;
  const handle = block(page).getByRole('separator', { name: 'Resize image right' });

  await block(page).hover();
  const point = (await handle.boundingBox())!;

  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 - 120, point.y + point.height / 2, { steps: 8 });
  await page.mouse.up();
  const resized = (await image.boundingBox())!;

  expect(resized.width).toBeCloseTo(before.width - 120, 0);
  expect(resized.width / resized.height).toBeCloseTo(before.width / before.height, 2);
  await page.reload();
  await expect(image).toBeVisible();
  expect((await image.boundingBox())!.width).toBeCloseTo(resized.width, 0);
  await block(page).hover();
  const left = block(page).getByRole('separator', { name: 'Resize image left' });

  await left.focus();
  await left.press('ArrowUp');
  expect((await image.boundingBox())!.width).toBeCloseTo(resized.width, 0);
  await left.press('ArrowRight');
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(resized.width - 10, 0);
  const top = block(page).getByRole('separator', { name: 'Resize image top' });

  await top.focus();
  await top.press('ArrowDown');
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(resized.width - 20, 0);
  await expect(top).toBeFocused();

  // A collaborator's saved size wins over an in-flight local pointer gesture.
  const start = (await handle.boundingBox())!;

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x - 60, start.y + start.height / 2, { steps: 4 });
  await update(page, { width: 300 });
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(300);
  await page.mouse.move(start.x - 120, start.y + start.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(300);
  await expect(snapshot(page)).toContainText('"width":300');
});

for (const code of [1037, 1028]) {
  test(`Flutter upload rejection ${code} survives reopening and read-only access without retry`, async ({
    page,
    integrationsURL,
  }) => {
    let uploads = 0;

    await page.route('**/fixtures/upload', (route) => {
      uploads++;
      return route.fulfill({
        status: 413,
        json: { code, sourceDomain: 'appflowy.server', message: 'Server wording may change' },
      });
    });
    await page.goto(new URL(`${fixturePath}?controlled-upload`, integrationsURL).href);
    await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
    await insert(page);
    await page.locator('input[type=file]').setInputFiles(asset);
    const message =
      code === 1037 ? 'This file exceeds the upload size limit.' : 'This workspace has reached its storage limit.';

    await expect(block(page).getByText(message, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(block(page).getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(block(page).getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Read only' }).check();
    await expect(block(page).getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    expect(uploads).toBe(1);
  });
}

test('Flutter read-only empty and populated images preserve content without editing controls', async ({
  page,
  integrationsURL,
}) => {
  await seed(page, integrationsURL, {}, { 'read-only': '' });
  await expect(block(page).getByRole('button', { name: 'Add an image' })).toBeDisabled();
  await expect(block(page).getByRole('button', { name: 'Image options' })).toHaveCount(0);
  await expect(page.getByTestId('image-uploader')).toHaveCount(0);
  await seed(
    page,
    integrationsURL,
    { url: `${integrationsURL}/fixtures/readonly.png`, caption: 'Saved caption' },
    { 'read-only': '' }
  );
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await block(page).hover();
  await expect(block(page).getByRole('separator')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: 'Replace', exact: true })).toHaveCount(0);
  await expect(block(page).getByRole('textbox', { name: 'Image caption' })).toHaveAttribute('readonly', '');
});

test('Flutter offscreen images defer loading and keep the same decoded image after returning to view', async ({
  page,
  integrationsURL,
}) => {
  let requests = 0;

  await page.route('**/fixtures/lazy.png', (route) => {
    requests++;
    return route.fulfill({ path: asset, contentType: 'image/png' });
  });
  await seed(page, integrationsURL, { url: `${integrationsURL}/fixtures/lazy.png` }, { offscreen: '' });
  await expect(block(page)).toBeAttached();
  expect(requests).toBe(0);
  await block(page).scrollIntoViewIfNeeded();
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  const loaded = requests;

  await page.evaluate(() => window.scrollTo(0, 0));
  await block(page).scrollIntoViewIfNeeded();
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  expect(requests).toBe(loaded);
});

test('Flutter unsupported source types remain opaque and recover on a live source update', async ({
  page,
  integrationsURL,
}) => {
  let requests = 0;

  await page.route('**/fixtures/opaque.png', (route) => {
    requests++;
    return route.fulfill({ path: asset, contentType: 'image/png' });
  });
  await seed(page, integrationsURL, {
    url: `${integrationsURL}/fixtures/opaque.png`,
    image_type: 99,
    future: { quality: 99 },
  });
  await expect(block(page).getByRole('status')).toHaveText('This image source is not supported yet.');
  expect(requests).toBe(0);
  await expect(snapshot(page)).toContainText('"future":{"quality":99}');
  await update(page, { image_type: 2 });
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await expect(snapshot(page)).toContainText('"future":{"quality":99}');
});

test('Flutter clearing and replacing a source closes stale fullscreen content', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByTestId('gallery-preview-image')).toBeVisible();
  await update(page, { url: '', source: 'network' });
  await expect(page.getByTestId('gallery-preview')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: 'Add an image' })).toBeVisible();
  await update(page, { url: new URL('/fixtures/new.png', page.url()).href });
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await expect(block(page).getByText('Image load failed')).toHaveCount(0);
});

for (const { format, plainText, html } of [
  ...['png', 'jpeg', 'gif'].map((format) => ({ format, plainText: '', html: true })),
  { format: 'jpeg', plainText: '1.jpg', html: false },
  { format: 'jpeg', plainText: 'https://example.invalid/1.jpg', html: false },
]) {
  test(`Flutter pastes ${format} file bytes alongside ${html ? 'image HTML' : plainText}`, async ({ page }) => {
    const file = format === 'png' ? asset : path.resolve(`playwright/fixtures/images/flutter-sample.${format}`);
    const bytes = [...(await readFile(file))];

    await page.getByTestId('editor-content').click();
    await page.getByTestId('editor-content').evaluate(
      (element, { bytes, format, plainText, html }) => {
        const transfer = new DataTransfer();

        transfer.items.add(new File([new Uint8Array(bytes)], `pasted.${format}`, { type: `image/${format}` }));
        if (html) transfer.setData('text/html', '<img src="https://example.invalid/should-not-load.png">');
        if (plainText) transfer.setData('text/plain', plainText);
        // Chromium handles rich/file pastes through beforeinput, not onPaste.
        element.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertFromPaste',
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          })
        );
      },
      { bytes, format, plainText, html }
    );
    await expect(block(page)).toHaveCount(1);
    await expect(snapshot(page)).toContainText(`pasted.${format}`);
    await expect(block(page).locator('.image-content > img')).toBeVisible();
    await expect(snapshot(page)).not.toContainText('should-not-load');
    if (plainText) await expect(page.getByTestId('editor-content')).not.toContainText(plainText);
  });
}

test('Flutter copying image pixels and pasting with the native clipboard creates another loaded block', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Copy image', exact: true }).click();
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveText('Copied to clipboard');
  const editor = page.getByTestId('editor-content');
  const bounds = (await editor.boundingBox())!;

  await editor.click({ position: { x: 20, y: bounds.height - 200 } });
  await page.locator('[data-block-type="paragraph"]').last().click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(block(page)).toHaveCount(2);
  await expect(block(page).nth(1).locator('.image-content > img')).toBeVisible();
});

test('Flutter row-document file drop affects only its editor while the background editor stays mounted', async ({
  page,
  integrationsURL,
}) => {
  await page.goto(new URL(`${fixturePath}?two-editors`, integrationsURL).href);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
  const owner = page.getByTestId('image-editor-host');

  await owner.getByTestId('editor-content').click();
  await page.keyboard.type('/image');
  await page.getByRole('button', { name: 'Image', exact: true }).click();
  await page.keyboard.press('Escape');
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();

      data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
      return data;
    },
    [...(await readFile(asset))]
  );

  await owner.locator('.image-block').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  await expect(owner.locator('.image-content > img')).toBeVisible();
  await expect(page.getByTestId('background-editor').locator('[data-block-type="image"]')).toHaveCount(0);
  await expect(snapshot(page)).toContainText('dropped.png');
});

test('Flutter fullscreen fits the image, zooms, copies with feedback and dismisses outside', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Full screen', exact: true }).click();
  const viewer = page.getByTestId('gallery-preview');

  await expect(page.getByTestId('gallery-preview-image')).toBeVisible();
  const image = (await page.getByTestId('gallery-preview-image').boundingBox())!;

  expect(image.height).toBeLessThanOrEqual(page.viewportSize()!.height - 200);
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByTestId('gallery-preview-zoom')).not.toHaveText('100%');
  await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, 10, { steps: 10 });
  await page.mouse.up();
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await expect(page.getByTestId('gallery-preview-zoom')).toHaveText('100%');
  await viewer.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(new URL('/fixtures/ocean.png', page.url()).href);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveText('Copied to clipboard');
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => Promise.reject(new Error('Unavailable')),
    })
  );
  await viewer.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(viewer).toHaveCount(0);
});

for (const existing of [false, true]) {
  test(`Flutter file insertion preserves its paragraph target (text=${existing})`, async ({ page }) => {
    const editor = page.getByTestId('editor-content');

    await editor.click();
    if (existing) await page.keyboard.type('Keep this paragraph');
    const bytes = [...(await readFile(asset))];

    await editor.evaluate((element, bytes) => {
      const transfer = new DataTransfer();

      transfer.items.add(new File([new Uint8Array(bytes)], 'inserted.png', { type: 'image/png' }));
      element.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertFromDrop',
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        })
      );
    }, bytes);
    await expect(block(page)).toHaveCount(1);
    await expect(block(page).locator('.image-content > img')).toBeVisible();
    if (existing) await expect(editor).toContainText('Keep this paragraph');
    await page.reload();
    await expect(block(page).locator('.image-content > img')).toBeVisible();
  });
}
