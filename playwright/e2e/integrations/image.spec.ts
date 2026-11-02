
import { asset, block, embed, expect, fixturePath, insert, more, snapshot, test } from '../../support/image';

test('slash picker uses Figma geometry, neutral selection and auto uploads from the file chooser', async ({
  page,
}, info) => {
  await insert(page);
  const picker = page.getByTestId('image-uploader');

  await expect(picker).toHaveCSS('width', '400px');
  await expect(page.getByTestId('file-dropzone').getByRole('button')).toHaveText('Drag & drop a file or click to Browse');
  await expect(picker.getByRole('tab')).toHaveCount(3);
  await expect(page.getByTestId('file-dropzone').getByRole('button')).toHaveCSS('height', '264px');
  await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
  await expect(block(page).locator('.image-empty')).toHaveCSS('height', '44px');
  await expect(block(page).locator('.image-block')).toHaveAttribute('data-upload-open', 'true');
  await expect(block(page).locator('.image-block')).toHaveAttribute('data-selected', 'false');
  await page.screenshot({ path: info.outputPath('image-upload.png') });
  const chooser = page.waitForEvent('filechooser');

  await page.getByTestId('file-dropzone').getByRole('button').click();
  await (await chooser).setFiles(asset);
  await expect(picker).toHaveCount(0);
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await expect(snapshot(page)).toContainText('"source":"upload"');
  await expect(snapshot(page)).toContainText('design.png');
  await (await more(page)).getByRole('button', { name: 'Replace', exact: true }).click();
  await page.getByRole('tab', { name: 'Embed Link', exact: true }).click();
  await expect(picker.getByRole('textbox')).toHaveValue('');
  await expect(picker.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(block(page).locator('.image-content > img')).toBeVisible();
});

for (const source of ['embedded', 'stored', 'uploaded', 'previewed upload'] as const) {
  test(`duplicating the ${source} image keeps both images loaded`, async ({ page }) => {
    if (source === 'stored') {
      await page.route('**/api/file_storage/**', (route) => route.fulfill({ contentType: 'image/png', path: asset }));
      const url = await page.evaluate(async () => {
        // Use the running fixture's configured origin so this takes the real
        // file-storage fetch/blob path rather than the external-image path.
        // @ts-expect-error Vite serves the app's runtime config directly.
        const { getConfigValue } = await import('/src/utils/runtime-config.ts');

        return new URL(
          '/api/file_storage/ws/v1/blob/view/ocean.png',
          getConfigValue('APPFLOWY_BASE_URL') || location.origin
        ).href;
      });

      await embed(page, url);
    } else if (source === 'embedded') {
      await embed(page);
    } else {
      await insert(page);
      const chooser = page.waitForEvent('filechooser');

      await page.getByTestId('file-dropzone').getByRole('button').click();
      await (await chooser).setFiles(asset);
      await expect(snapshot(page)).toContainText('"source":"upload"');
      await expect(block(page).locator('.image-content > img')).toBeVisible();
    }

    if (source === 'previewed upload') {
      for (let attempt = 0; attempt < 2; attempt++) {
        await (await more(page)).getByRole('button', { name: 'Full screen', exact: true }).click();
        await expect(page.getByTestId('gallery-preview-image')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('gallery-preview-zoom')).toHaveCount(0);
      }
    }

    await (await more(page)).getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(block(page)).toHaveCount(2);
    const images = block(page).locator('.image-content > img');

    for (let index = 0; index < 2; index++) {
      await images.nth(index).scrollIntoViewIfNeeded();
      await expect(images.nth(index)).toBeVisible();
      await expect
        .poll(() => images.nth(index).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
        .toBe(true);
    }

    await expect(block(page).getByRole('button', { name: 'Image load failed. Retry.', exact: true })).toHaveCount(0);
  });
}

test('caption, four-sided resize, alignment, duplicate and delete persist', async ({ page }, info) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  const caption = block(page).getByRole('textbox', { name: 'Image caption' });

  await expect(caption).toBeFocused();
  await caption.fill('Ocean waves');
  await expect(caption).toHaveCSS('text-align', 'left');
  await expect(caption).toHaveCSS('font-size', '12px');
  await expect(caption).toHaveCSS('line-height', '18px');
  await expect(caption).toHaveCSS('margin-top', '8px');
  await block(page).hover();
  await expect(block(page).getByRole('separator')).toHaveCount(4);
  const width = await block(page)
    .locator('.image-render')
    .evaluate((element) => element.clientWidth);

  await block(page).getByRole('separator', { name: 'Resize image right' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(snapshot(page)).toContainText(`"width":${width - 10}`);
  await expect(block(page).getByRole('separator', { name: 'Resize image right' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(snapshot(page)).toContainText(`"width":${width - 20}`);
  await (await more(page)).getByRole('button', { name: 'Align', exact: true }).click();
  await page.getByTestId('image-submenu').getByRole('button', { name: 'Align right', exact: true }).click();
  await expect(snapshot(page)).toContainText('"align":"right"');
  await page.mouse.move(1100, 650);
  await page.screenshot({ path: info.outputPath('image-caption.png') });
  await page.reload();
  await expect(caption).toHaveValue('Ocean waves');
  await expect(caption).not.toBeFocused();
  await expect(snapshot(page)).toContainText(`"width":${width - 20}`);
  await (await more(page)).getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(block(page)).toHaveCount(2);
  await (await more(page)).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(block(page)).toHaveCount(1);
  await expect(caption).toHaveValue('Ocean waves');
});

for (const empty of [true, false]) {
  test(`six-dot selection is blue fill without an outline (empty=${empty})`, async ({ page }, info) => {
    if (empty) {
      await insert(page);
      await page.keyboard.press('Escape');
    } else await embed(page);
    await block(page).hover();
    await page.getByTestId('drag-block').click();
    const menu = page.getByTestId('image-menu');

    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('width', '240px');
    const surface = block(page).locator('.image-selection-surface');
    const overlay = () =>
      surface.evaluate((element) => {
        const style = getComputedStyle(element, '::after');

        return {
          content: style.content,
          fill: style.backgroundColor,
          shadow: style.boxShadow,
          border: style.borderWidth,
        };
      });

    await expect.poll(async () => (await overlay()).content).not.toBe('none');
    const selectedFill = await surface.evaluate((element, empty) => {
      const probe = document.createElement('span');

      probe.style.backgroundColor = empty ? 'var(--fill-text-select)' : 'var(--fill-theme-select)';
      element.append(probe);
      const value = getComputedStyle(probe).backgroundColor;

      probe.remove();
      return value;
    }, empty);

    expect((await overlay()).fill).toBe(selectedFill);
    expect((await overlay()).shadow).toBe('none');
    expect((await overlay()).border).toBe('0px');
    await menu.getByRole('button', { name: 'Delete', exact: true }).hover();
    const danger = await page.evaluate(() => {
      const el = document.createElement('span');

      el.style.color = 'var(--text-error)';
      document.body.append(el);
      const color = getComputedStyle(el).color;

      el.remove();
      return color;
    });

    await expect(menu.getByRole('button', { name: 'Delete', exact: true })).toHaveCSS('color', danger);
    const icon = menu.getByRole('button', { name: 'Delete', exact: true }).locator('.image-block-icon');

    await expect(icon).toHaveCSS('background-color', danger);
    await page.screenshot({ path: info.outputPath(`image-selection-${empty}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect.poll(async () => (await overlay()).content).toBe('none');
  });
}

test('submenus stay alongside their parent and inside a short viewport; picker remains reachable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 800, height: 520 });
  await embed(page);
  const menu = await more(page);

  await menu.getByRole('button', { name: 'Align', exact: true }).click();
  const sub = page.getByTestId('image-submenu');

  await expect(sub).toBeVisible();
  const main = (await menu.boundingBox())!;
  const bounds = (await sub.boundingBox())!;

  expect(bounds.x >= main.x + main.width - 1 || bounds.x + bounds.width <= main.x + 1).toBe(true);
  expect(bounds.y).toBeGreaterThanOrEqual(15);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(505);
  await page.screenshot({ path: info.outputPath('image-submenu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await expect(sub).toHaveCount(0);
  await menu.getByRole('button', { name: 'Replace', exact: true }).click();
  const picker = page.getByTestId('image-uploader');

  await expect(picker).toBeVisible();
  const rect = (await picker.boundingBox())!;

  expect(rect.y).toBeGreaterThanOrEqual(15);
  expect(rect.y + rect.height).toBeLessThanOrEqual(505);
});

test('external and page links round-trip through Flutter metadata and can be removed', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Embed link', exact: true }).click();
  const link = page.getByTestId('image-link-popover');

  await link.getByRole('combobox').fill('https://example.com/design');
  await link.getByRole('combobox').press('Enter');
  await expect(block(page).getByRole('button', { name: 'Open image link' })).toBeVisible();
  await page.reload();
  await (await more(page)).getByRole('button', { name: 'Edit link', exact: true }).click();
  await expect(link.getByRole('combobox')).toHaveValue('https://example.com/design');
  await link.getByRole('combobox').fill('Design');
  await link.getByRole('option', { name: 'Design reference' }).click();
  await expect(snapshot(page)).toContainText('linked-page');
  await (await more(page)).getByRole('button', { name: 'Edit link', exact: true }).click();
  await link.getByRole('button', { name: 'Remove link' }).click();
  await expect(block(page).getByRole('button', { name: 'Open image link' })).toHaveCount(0);
});

test('clicking anywhere on a linked image opens its destination while controls still edit the image', async ({
  page,
  context,
}) => {
  const destination = new URL('/fixtures/image-link-destination', page.url()).href;

  await context.route(destination, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Image link destination</p>' })
  );
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Embed link', exact: true }).click();
  await page.getByTestId('image-link-popover').getByRole('combobox').fill(destination);
  await page.getByTestId('image-link-popover').getByRole('combobox').press('Enter');
  const surface = block(page).getByRole('button', { name: 'Open image link' });
  const image = block(page).locator('.image-content > img');
  const size = await image.boundingBox();
  const linkSize = await surface.boundingBox();

  expect(linkSize!.width).toBeCloseTo(size!.width);
  expect(linkSize!.height).toBeCloseTo(size!.height);
  let opened = 0;

  context.on('page', () => opened++);
  for (const [x, y] of [
    [0.2, 0.25],
    [0.75, 0.65],
  ]) {
    const popup = context.waitForEvent('page');

    await surface.click({ position: { x: size!.width * x, y: size!.height * y } });
    const target = await popup;

    await expect(target).toHaveURL(destination);
    await target.close();
  }

  await block(page).hover();
  const handle = block(page).getByRole('separator', { name: 'Resize image right' });
  const initialWidth = Number(await handle.getAttribute('aria-valuenow'));

  await handle.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', String(initialWidth - 10));
  await (await more(page)).getByRole('button', { name: 'Edit link', exact: true }).click();
  await page.getByTestId('image-link-popover').getByRole('combobox').fill('Design');
  await page.getByTestId('image-link-popover').getByRole('option', { name: 'Design reference' }).click();
  expect(opened).toBe(2);
  await surface.click();
  await expect(page.getByTestId('image-opened-page')).toHaveText('linked-page');
  expect(opened).toBe(2);
});

test('image link picker matches desktop recents, icons and keyboard selection', async ({ page }, info) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Embed link', exact: true }).click();
  const picker = page.getByTestId('image-link-popover');
  const input = picker.getByRole('combobox');
  const options = picker.getByRole('option');

  await expect(picker).toHaveCSS('width', '400px');
  await expect(input).toHaveCSS('width', '376px');
  await expect(input).toHaveCSS('height', '32px');
  await expect(input).toHaveAttribute('placeholder', 'Paste link or search pages');
  await expect(input).toBeFocused();
  await expect(picker.getByText('Recent pages', { exact: true })).toBeVisible();
  await expect(options).toHaveCount(5);
  await expect(page.locator('.MuiPopover-paper').filter({ has: picker })).toHaveCSS('opacity', '1');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(options.first()).toHaveCSS('height', '32px');
  await expect(picker.getByTestId('image-link-page-icon')).toHaveCount(5);
  await expect(options.nth(1).getByTestId('image-link-page-icon')).toContainText('⚡');
  const documentIcon = await options.first().locator('svg').innerHTML();

  expect(await options.nth(2).locator('svg').innerHTML()).not.toBe(documentIcon);
  await page.screenshot({ path: info.outputPath('image-link-recents.png') });

  await input.press('ArrowUp');
  await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(picker).toHaveCount(0);
  const link = await snapshot(page).evaluate((el) => JSON.parse(JSON.parse(el.textContent || '[]')[0].data.link));

  expect(link).toEqual({
    is_page_link: true,
    page_id: 'weekly',
    url: new URL('/app/00000000-0000-4000-8000-000000000001/weekly', page.url()).href,
  });
  await (await more(page)).getByRole('button', { name: 'Edit link', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(options).toHaveCount(5);
  await input.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(snapshot(page)).toContainText('weekly');
});

test('image link picker stays inside short viewports and rejects unsafe links', async ({ page }, info) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Embed link', exact: true }).click();
  const picker = page.getByTestId('image-link-popover');
  const input = picker.getByRole('combobox');

  await expect(picker.getByRole('option')).toHaveCount(5);
  await expect(page.locator('.MuiPopover-paper').filter({ has: picker })).toHaveCSS('opacity', '1');
  await page.setViewportSize({ width: 390, height: 240 });
  await expect
    .poll(async () => {
      const rect = await picker.boundingBox();

      return !!rect && rect.x >= 15 && rect.x + rect.width <= 375 && rect.y >= 15 && rect.y + rect.height <= 225;
    })
    .toBe(true);
  await input.press('ArrowUp');
  await expect(picker.getByRole('option').last()).toBeInViewport();
  await expect(input).toBeInViewport();
  await page.screenshot({ path: info.outputPath('image-link-short.png') });
  await input.fill('javascript:alert(1)');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  await expect(picker.getByRole('alert')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(block(page).getByRole('button', { name: 'Open image link' })).toHaveCount(0);
  await input.fill('example.com/photo');
  await expect(picker.getByRole('option', { name: 'example.com/photo', exact: true })).toBeVisible();
  await input.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(snapshot(page)).toContainText('https://example.com/photo');
});

test('empty image Ask AI dismisses with Escape and outside clicks but preserves drafts and model interactions', async ({
  page,
}) => {
  await page.route('**/api/ai/*/model/list', (route) =>
    route.fulfill({
      json: { code: 0, data: { models: [{ name: 'Auto', metadata: { is_default: true, desc: 'Automatic model' } }] } },
    })
  );
  await embed(page);
  const assistant = page.getByTestId('image-assistant');
  const input = assistant.getByRole('textbox', { name: 'Ask AI', exact: true });
  const star = block(page).locator('[aria-label="Image controls"]').getByRole('button', { name: 'Ask AI', exact: true });
  const open = async () => {
    await block(page).hover();
    await star.click();
    await expect(assistant).toBeVisible();
  };

  await open();
  // Escape also works when focus stays on the toolbar or a composer control.
  await star.focus();
  await page.keyboard.press('Escape');
  await expect(assistant).toHaveCount(0);
  await open();
  await input.click();
  await assistant.getByRole('button', { name: 'Web Search', exact: true }).click();
  await page.mouse.click(10, 10);
  await expect(assistant).toHaveCount(0);
  await open();
  await input.fill('   ');
  await input.press('Escape');
  await expect(assistant).toHaveCount(0);

  await open();
  await assistant.getByRole('button', { name: 'Select AI Model' }).click();
  await page.getByTestId('model-search-input').fill('Auto');
  await page.getByTestId('model-option-Auto').click();
  await expect(assistant).toBeVisible();
  await assistant.getByRole('button', { name: 'Select AI Model' }).click();
  await page.getByTestId('model-search-input').press('Escape');
  await expect(page.getByTestId('model-search-input')).toHaveCount(0);
  await expect(assistant).toBeVisible();
  await assistant.getByRole('button', { name: 'Select AI Model' }).focus();
  await page.keyboard.press('Escape');
  await expect(assistant).toHaveCount(0);

  await open();
  await input.fill('Keep this draft');
  await page.mouse.click(10, 10);
  await expect(input).toHaveValue('Keep this draft');
  await input.fill('');
  await page.mouse.click(10, 10);
  await expect(assistant).toHaveCount(0);
});

test('Ask AI uses the standard composer and waits for a prompt before requesting; read-only hides editing', async ({
  page,
}, info) => {
  const requests: { text: string }[] = [];

  await page.route('**/api/ai/*/v2/complete/stream', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { '1': 'A suggested image caption.' } });
  });
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Ask AI', exact: true }).click();
  const assistant = page.getByTestId('image-assistant');
  const input = assistant.getByRole('textbox', { name: 'Ask AI', exact: true });

  await expect(input).toBeFocused();
  await expect(assistant).toHaveCSS('border-radius', '12px');
  await expect(assistant.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('image-ask-ai.png') });
  await input.fill('Suggest a caption for my ocean photo');
  await input.press('Enter');
  await expect(assistant).toContainText('A suggested image caption.');
  expect(requests[0].text).toContain('ocean.png');
  await page.mouse.click(10, 10);
  await expect(assistant).toContainText('A suggested image caption.');
  await assistant.getByRole('button', { name: 'Insert below', exact: true }).click();
  await expect(snapshot(page)).toContainText('A suggested image caption.');
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await expect(block(page).getByRole('separator')).toHaveCount(0);
  const menu = await more(page);

  await expect(menu.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Ask AI', exact: true })).toHaveCount(0);
});

test('screenshots, focus and hover do not fetch an already loaded image again', async ({ page }) => {
  let requests = 0;

  page.on('request', (request) => {
    if (request.url().includes('/fixtures/ocean.png')) requests++;
  });
  await embed(page);
  const initial = requests;

  expect(initial).toBeGreaterThan(0);
  await page.screenshot();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await more(page);
  await page.keyboard.press('Escape');
  await page.screenshot();
  expect(requests).toBe(initial);
});

for (const quota of ['hosted', 'self-hosted']) {
  test(`upload limit preserves recovery and follows ${quota} policy`, async ({ page, integrationsURL }) => {
    await page.goto(new URL(`${fixturePath}?quota=${quota}`, integrationsURL).href);
    await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
    await insert(page);
    await page.locator('input[type=file]').setInputFiles(asset);
    await expect(block(page).getByText('This file exceeds the upload size limit.', { exact: true })).toBeVisible();
    await expect(snapshot(page)).toContainText('retry_local_url');
    await expect(page.getByRole('dialog')).toHaveCount(quota === 'hosted' ? 1 : 0);
  });
}

test('closing the editor during upload retains the recovery file and permits retry after reopening', async ({
  page,
  integrationsURL,
}) => {
  let uploads = 0;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });

  await page.route('**/fixtures/upload', async (route) => {
    uploads++;
    if (uploads === 1) await waiting;
    await route.fulfill({ json: { url: new URL('/fixtures/uploaded.png', integrationsURL).href } });
  });
  await page.goto(new URL(`${fixturePath}?controlled-upload`, integrationsURL).href);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
  await insert(page);
  await page.locator('input[type=file]').setInputFiles(asset);
  await expect.poll(() => uploads).toBe(1);
  await page.getByRole('button', { name: 'Toggle editor' }).click();
  finish();
  await expect(block(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle editor' }).click();
  await block(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => uploads).toBe(2);
  await expect(snapshot(page)).toContainText('"retry_local_url":""');
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await page.reload();
  await expect(block(page).locator('.image-content > img')).toBeVisible();
});

test('pending images cannot be duplicated until their upload completes, then both copies survive reload', async ({
  page,
  integrationsURL,
}) => {
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });

  await page.route('**/fixtures/upload', async (route) => {
    await waiting;
    await route.fulfill({ json: { url: new URL('/fixtures/uploaded.png', integrationsURL).href } });
  });
  await page.goto(new URL(`${fixturePath}?controlled-upload`, integrationsURL).href);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
  await insert(page);
  await page.locator('input[type=file]').setInputFiles(asset);
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  const menu = await more(page);
  const duplicate = menu.getByRole('button', { name: 'Duplicate', exact: true });

  await expect(duplicate).toBeDisabled();
  finish();
  await expect(duplicate).toBeEnabled();
  await duplicate.click();
  await expect(block(page)).toHaveCount(2);
  await page.reload();
  for (let index = 0; index < 2; index++) {
    const img = block(page).nth(index).locator('.image-content > img');

    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
});

test('failed uploads keep duplication disabled until retry succeeds', async ({ page, integrationsURL }) => {
  let succeed = false;

  await page.route('**/fixtures/upload', (route) =>
    route.fulfill(
      succeed
        ? { json: { url: new URL('/fixtures/uploaded.png', integrationsURL).href } }
        : { status: 500, body: 'Upload failed' }
    )
  );
  await page.goto(new URL(`${fixturePath}?controlled-upload`, integrationsURL).href);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
  await insert(page);
  await page.locator('input[type=file]').setInputFiles(asset);
  await expect(block(page).getByText('Upload failed.', { exact: true })).toBeVisible();
  await expect((await more(page)).getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  succeed = true;
  await block(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(block(page).getByText('Upload failed.', { exact: true })).toHaveCount(0);
  await expect((await more(page)).getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled();
});

test('saved and remote image captions do not steal focus', async ({ page }) => {
  await embed(page);
  const remote = page.getByRole('button', { name: 'Remote edit' });

  await remote.click();
  const caption = block(page).getByRole('textbox', { name: 'Image caption' });

  await expect(caption).toHaveValue('collaborator');
  await expect(remote).toBeFocused();
  await caption.click();
  await expect(caption).toBeFocused();
  await page.reload();
  await expect(caption).toHaveValue('collaborator');
  await expect(caption).not.toBeFocused();
});

test('image page links navigate in row document hosts without a modal callback', async ({ page, integrationsURL }) => {
  await page.goto(new URL(`${fixturePath}?navigation-only`, integrationsURL).href);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Embed link', exact: true }).click();
  await page.getByTestId('image-link-popover').getByRole('combobox').fill('Design');
  await page.getByTestId('image-link-popover').getByRole('option', { name: 'Design reference' }).click();
  await block(page).getByRole('button', { name: 'Open image link' }).click();
  await expect(page.getByTestId('image-opened-page')).toHaveText('linked-page');
});

test('multi-file uploads preserve order and a pasted image uses the same upload path', async ({ page }) => {
  await insert(page);
  const bytes = await (await import('node:fs/promises')).readFile(asset);

  await page.locator('input[type=file]').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: bytes },
    { name: 'second.png', mimeType: 'image/png', buffer: bytes },
  ]);
  await expect(block(page)).toHaveCount(2);
  await expect(block(page).locator('.image-content > img')).toHaveCount(2);
  await expect(snapshot(page)).toContainText('second.png');
  const data = JSON.parse((await snapshot(page).textContent())!);

  expect(
    data
      .filter((item: { type: string }) => item.type === 'image')
      .map((item: { data: { name: string } }) => item.data.name)
  ).toEqual(['first.png', 'second.png']);
  await page.getByRole('button', { name: 'Paste image', exact: true }).click();
  await expect(block(page)).toHaveCount(3);
  await expect(snapshot(page)).toContainText('pasted.png');
  await expect(block(page).locator('.image-content > img')).toHaveCount(3);
});

test('Turn into Page preserves the complete image and undo restores it', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  await block(page).getByRole('textbox', { name: 'Image caption' }).fill('Keep my caption');
  await (await more(page)).getByRole('button', { name: 'Turn into', exact: true }).click();
  await expect(page.getByTestId('image-submenu').getByRole('button')).toHaveText(['Page']);
  await page.getByTestId('image-submenu').getByRole('button', { name: 'Page', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(page.getByTestId('image-created-page')).toContainText('Keep my caption');
  await expect(page.getByTestId('image-created-page')).toContainText('ocean.png');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(block(page).getByRole('textbox', { name: 'Image caption' })).toHaveValue('Keep my caption');
});

test('copied image block links paste as filename mentions with the standard truncation and navigation', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const filename = 'Mountain sunrise photograph with distant peaks and a winding river from our summer expedition.png';

  await insert(page);
  await page.locator('input[type=file]').setInputFiles({
    name: filename,
    mimeType: 'image/png',
    buffer: await (await import('node:fs/promises')).readFile(asset),
  });
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  const menu = await more(page);

  await expect(menu.getByRole('button', { name: 'Copy link to original', exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Copy link to block', exact: true }).click();
  const editor = page.getByTestId('editor-content');
  const bounds = (await editor.boundingBox())!;

  await editor.click({ position: { x: 20, y: bounds.height - 200 } });
  await editor.locator('[data-block-type="paragraph"]').last().click();
  await page.keyboard.press('ControlOrMeta+v');
  const mention = editor.locator('.mention-inline');
  const label = mention.locator('.mention-content');

  await expect(label).toHaveText(filename);
  await expect(mention).toHaveCSS('text-decoration-line', 'underline');
  await expect(label).toHaveCSS('max-width', '330px');
  await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  await expect.poll(() => label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await mention.screenshot({ path: info.outputPath('image-filename-mention.png') });
  await mention.click();
  await expect(block(page)).toHaveClass(/highlight-block/);
  await page.reload();
  await expect(label).toHaveText(filename);
});

test('Turn into offers only Page for an empty image', async ({ page }) => {
  await insert(page);
  await page.keyboard.press('Escape');
  await block(page).hover();
  await page.getByTestId('drag-block').click();
  await page.getByTestId('image-menu').getByRole('button', { name: 'Turn into', exact: true }).click();
  await expect(page.getByTestId('image-submenu').getByRole('button')).toHaveText(['Page']);
});

test('both Align menus show direction icons and the current alignment checkmark', async ({ page }, info) => {
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Align', exact: true }).click();
  const submenu = page.getByTestId('image-submenu');

  for (const direction of ['left', 'center', 'right']) {
    const row = submenu.getByRole('button', { name: `Align ${direction}`, exact: true });

    await expect(row.locator(`.image-block-icon-align-${direction}`)).toBeVisible();
    await expect(row).toHaveAttribute('aria-pressed', String(direction === 'center'));
  }

  await expect(submenu.getByRole('button', { pressed: true }).locator('svg')).toBeVisible();
  await submenu.getByRole('button', { name: 'Align left', exact: true }).click();
  await block(page).hover();
  await block(page).getByRole('button', { name: 'Align', exact: true }).click();
  const toolbarMenu = page.getByTestId('image-align-menu');

  await expect(toolbarMenu.getByRole('button', { name: 'Align left', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  for (const direction of ['left', 'center', 'right']) {
    await expect(toolbarMenu.locator(`.image-block-icon-align-${direction}`)).toBeVisible();
  }

  await toolbarMenu.screenshot({ path: info.outputPath('image-align-options.png') });
  await toolbarMenu.getByRole('button', { name: 'Align right', exact: true }).click();
  await page.reload();
  await (await more(page)).getByRole('button', { name: 'Align', exact: true }).click();
  await expect(submenu.getByRole('button', { name: 'Align right', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

for (const action of ['Copy link to original', 'Copy link to block']) {
  test(`image ${action} copies the correct URL and shows the standard success toast`, async ({
    page,
    context,
  }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const original = new URL('/fixtures/ocean.png?download=1#photo', page.url()).href;

    await page.route('**/fixtures/ocean.png?*', (route) => route.fulfill({ contentType: 'image/png', path: asset }));
    await embed(page, original);
    const menu = await more(page);
    const originalRow = menu.getByRole('button', { name: 'Copy link to original', exact: true });
    const originalIcon = originalRow.locator('.image-block-icon-original');

    await expect(originalIcon).toHaveCSS('width', '20px');
    await expect(originalIcon).toHaveCSS('height', '20px');
    await expect(originalIcon).toHaveCSS('mask-size', '20px 20px');
    await expect(originalIcon).not.toHaveCSS('mask-image', 'none');
    await expect(
      menu.getByRole('button', { name: 'Copy link to block', exact: true }).locator('.image-block-icon-link')
    ).toBeVisible();
    await originalRow.hover();
    const textColor = await originalRow.evaluate((element) => getComputedStyle(element).color);

    await expect(originalIcon).toHaveCSS('background-color', textColor);
    await expect(page.locator('.MuiPopover-paper').filter({ has: menu })).toHaveCSS('opacity', '1');
    await menu.screenshot({ animations: 'disabled', path: info.outputPath('image-copy-link-menu.png') });
    await menu.getByRole('button', { name: action, exact: true }).click();
    const nodes: { type: string; blockId: string }[] = JSON.parse((await snapshot(page).textContent())!);
    const image = nodes.find((node) => node.type === 'image');

    expect(image).toBeDefined();
    const blockLink = new URL(page.url());

    blockLink.searchParams.set('blockId', image!.blockId);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(action === 'Copy link to original' ? original : blockLink.href);
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveText('Copied to clipboard');
    await expect(menu).toHaveCount(0);
  });

  test(`image ${action} does not report success when the clipboard rejects the write`, async ({ page }) => {
    await embed(page);
    await page.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: () => Promise.reject(new Error('Clipboard unavailable')),
      })
    );
    await (await more(page)).getByRole('button', { name: action, exact: true }).click();
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    await expect(page.getByTestId('image-menu')).toHaveCount(0);
  });
}

test('copy image writes pixels, download uses the filename, and fullscreen closes with Escape', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await embed(page);
  await (await more(page)).getByRole('button', { name: 'Copy image', exact: true }).click();
  const toast = page.locator('[data-sonner-toast][data-type="success"]');

  await expect(toast).toHaveText('Copied to clipboard');
  await expect
    .poll(async () => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types)))
    .toContain('image/png');
  const downloaded = page.waitForEvent('download');

  await (await more(page)).getByRole('button', { name: 'Download', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('ocean.png');
  await (await more(page)).getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByTestId('gallery-preview-zoom')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gallery-preview-zoom')).toHaveCount(0);
});

test('toolbar copy shows the AppFlowy success toast only after the clipboard write succeeds', async ({ page }, info) => {
  await embed(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: () =>
        new Promise<void>((resolve, reject) => {
          document.addEventListener(
            'test-copy-result',
            (event) => {
              if ((event as CustomEvent).detail) resolve();
              else reject(new Error('Clipboard unavailable'));
            },
            { once: true }
          );
        }),
    });
  });
  const copy = block(page)
    .locator('[aria-label="Image controls"]')
    .getByRole('button', { name: 'Copy image', exact: true });

  await block(page).hover();
  await copy.click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('test-copy-result', { detail: false })));
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  await block(page).hover();
  await copy.click();
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('test-copy-result', { detail: true })));
  const toast = page.locator('[data-sonner-toast][data-type="success"]');

  await expect(toast).toHaveText('Copied to clipboard');
  await expect(toast.locator('svg')).toBeVisible();
  await expect(toast).toHaveAttribute('data-mounted', 'true');
  await expect(toast).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-x-position', 'center');
  await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'bottom');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('image-copy-toast.png') });
});

test('Unsplash embeds the chosen image and unsafe source URLs remain disabled', async ({
  page,
  context,
  integrationsURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = new URL('/fixtures/unsplash.png', integrationsURL).href;

  await page.route('https://api.unsplash.com/photos?*', (route) =>
    route.fulfill({
      headers: { 'x-total': '1', 'x-per-page': '18', 'access-control-expose-headers': 'x-total,x-per-page' },
      json: [
        {
          id: 'ocean',
          alt_description: 'Ocean sample',
          urls: { thumb: source, full: source },
          user: { name: 'Photographer', links: { html: 'https://example.com' } },
        },
      ],
    })
  );
  await insert(page);
  await page.getByRole('tab', { name: 'Embed Link', exact: true }).click();
  await page.getByTestId('image-uploader').getByRole('textbox').fill('javascript:alert(1)');
  await expect(page.getByRole('button', { name: 'Embed', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Unsplash', exact: true }).click();
  await page.getByRole('img', { name: 'Ocean sample', exact: true }).click();
  await expect(block(page).locator('.image-content > img')).toBeVisible();
  await expect(snapshot(page)).toContainText('"source":"unsplash"');
  await (await more(page)).getByRole('button', { name: 'Copy link to original', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveText('Copied to clipboard');
});
