import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, Page } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

const fixturePath = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const assets = path.resolve('playwright/fixtures/pdfs');
const block = (page: Page) => page.locator('[data-block-type="pdf"]');

async function embed(page: Page, url: string) {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/pdf');
  await page.getByRole('button', { name: 'PDF Embed', exact: true }).click();
  await page.getByRole('tab', { name: /embed/i }).click();
  await page.getByPlaceholder('Paste a link...').fill(url);
  await page.getByRole('button', { name: 'Embed', exact: true }).click();
}

async function more(page: Page) {
  await block(page).first().hover();
  await block(page).first().getByRole('button', { name: 'More', exact: true }).click();
  return page.getByTestId('pdf-menu');
}

test.beforeEach(async ({ page, integrationsURL }) => {
  await page.route('**/api/ai/*/model/list', (route) => route.fulfill({ json: { code: 0, data: { models: [] } } }));
  await page.route('**/fixtures/*.pdf', (route) =>
    route.fulfill({
      contentType: 'application/pdf',
      path: path.join(assets, route.request().url().includes('password') ? 'sample_with_password.pdf' : 'sample.pdf'),
    })
  );
  await page.route(`**${fixturePath}*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('pdf') })
  );
  await page.goto(new URL(fixturePath, integrationsURL).href);
  await expect(page.getByTestId('pdf-document-snapshot')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
});

test('slash insertion embeds and renders all pages; fullscreen zoom, close, and persistence', async ({ page }, info) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await expect(block(page).locator('.textLayer').first()).not.toBeEmpty();
  await page.screenshot({ path: info.outputPath('pdf-inline.png') });
  await block(page).hover();
  await block(page).getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByRole('dialog').locator('canvas').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Zoom level' }).selectOption('1.5');
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('1.5');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(block(page).locator('canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('file selection automatically uploads and replaces PDF; captions, alignment, resize, duplicate and delete', async ({ page }, info) => {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/pdf');
  await page.getByTestId('slash-menu-pdf').click();
  const picker = page.waitForEvent('filechooser');

  await page.getByTestId('file-dropzone').getByRole('button').click();
  await (await picker).setFiles(path.join(assets, 'sample.pdf'));
  await expect(page.getByTestId('pdf-uploader')).toHaveCount(0);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  await block(page).getByRole('textbox', { name: 'PDF caption' }).fill('Research notes');
  await (await more(page)).getByRole('button', { name: 'Align', exact: true }).click();
  await page.getByRole('button', { name: 'Align right', exact: true }).click();
  await block(page).getByRole('button', { name: 'Resize PDF width', exact: true }).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('pdf-document-snapshot')).toContainText('"widthFactor":0.7');
  await expect(page.getByTestId('pdf-document-snapshot')).toContainText('"align":"right"');
  await page.screenshot({ path: info.outputPath('pdf-caption-resize.png') });
  await (await more(page)).getByRole('button', { name: 'Replace', exact: true }).click();
  const replacementPicker = page.waitForEvent('filechooser');

  await page.getByTestId('file-dropzone').getByRole('button').click();
  await (await replacementPicker).setFiles({
    name: 'replacement.pdf',
    mimeType: 'application/pdf',
    buffer: await (await import('node:fs/promises')).readFile(path.join(assets, 'sample.pdf')),
  });
  await expect(page.getByTestId('pdf-uploader')).toHaveCount(0);
  await expect(page.getByTestId('pdf-document-snapshot')).toContainText('replacement.pdf');
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await (await more(page)).getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(block(page)).toHaveCount(2);
  await (await more(page)).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(block(page)).toHaveCount(1);
  await expect(block(page).getByRole('textbox', { name: 'PDF caption' })).toHaveValue('Research notes');
});

test('pasting a copied PDF block link uses its filename with standard mention truncation', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const filename = 'Annual research report with detailed findings and recommendations for the next planning cycle.pdf';

  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/pdf');
  await page.getByTestId('slash-menu-pdf').click();
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: await (await import('node:fs/promises')).readFile(path.join(assets, 'sample.pdf')),
  });
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await (await more(page)).getByRole('button', { name: 'Copy link to block', exact: true }).click();
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
  await mention.screenshot({ path: info.outputPath('pdf-filename-mention.png') });
  await mention.click();
  await expect(block(page)).toHaveClass(/highlight-block/);
  await page.reload();
  await expect(label).toHaveText(filename);
});

for (const storage of ['cloud', 'network']) {
  test(`Open in browser previews a ${storage} PDF in a new tab even with attachment headers`, async ({ page, context, integrationsURL }) => {
    const source = new URL(storage === 'cloud' ? '/api/file_storage/workspace/v1/blob/view/report' : '/fixtures/attachment.pdf', integrationsURL).href;
    const downloads: string[] = [];

    await context.route(source, (route) => route.fulfill({
      contentType: 'application/pdf',
      headers: { 'Content-Disposition': 'attachment; filename="Report.pdf"' },
      path: path.join(assets, 'sample.pdf'),
    }));
    const seed = { type: 'pdf', data: { url: source, url_type: storage, name: 'Report.pdf' }, children: [{ type: 'text', children: [{ text: '' }] }] };

    await page.evaluate(() => localStorage.removeItem('pdf-fixture'));
    await page.goto(new URL(`${fixturePath}?seed=${encodeURIComponent(JSON.stringify(seed))}`, integrationsURL).href);
    await expect(block(page).locator('canvas').first()).toBeVisible();
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    const opened = page.waitForEvent('popup');

    await (await more(page)).getByRole('button', { name: 'Open in browser', exact: true }).click();
    const preview = await opened;

    preview.on('download', (download) => downloads.push(download.suggestedFilename()));
    await expect(preview).toHaveURL(/\/app\/pdf-preview\?/);
    await expect(preview.getByRole('heading', { name: 'Report.pdf', exact: true })).toBeVisible();
    await expect(preview.locator('canvas').first()).toBeVisible();
    await expect(preview.locator('.textLayer').first()).toContainText('Sample PDF');
    expect(await preview.evaluate(() => window.opener === null)).toBe(true);
    await preview.reload();
    await expect(preview.locator('canvas').first()).toBeVisible();
    expect(downloads).toEqual([]);
    await preview.close();
  });
}

test('the browser PDF preview supports password unlocking', async ({ page, context }) => {
  const source = new URL('/fixtures/password-tab.pdf', page.url()).href;

  await context.route(source, (route) => route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'sample_with_password.pdf') }));
  await embed(page, source);
  await expect(page.getByText(/This file is protected/)).toBeVisible();
  const opened = page.waitForEvent('popup');

  await (await more(page)).getByRole('button', { name: 'Open in browser', exact: true }).click();
  const preview = await opened;

  await expect(preview.getByText(/This file is protected/)).toBeVisible();
  await preview.getByLabel('PDF password').fill('wrong');
  await preview.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(preview.getByRole('alert')).toHaveText('Incorrect password');
  await preview.getByLabel('PDF password').fill('123');
  await preview.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(preview.locator('canvas').first()).toBeVisible();
  await preview.close();
});

test('PDF caption focuses, grows with multiple lines, and safely dismisses an empty caption', async ({ page }) => {
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  const caption = block(page).getByRole('textbox', { name: 'PDF caption' });

  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  await expect(caption).toBeFocused();
  await caption.fill('Research notes');
  await caption.press('End');
  await caption.press('Enter');
  await page.keyboard.type('Second line');
  await expect(caption).toHaveValue('Research notes\nSecond line');
  await expect.poll(async () => (await caption.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(36);

  // Reopening focuses the existing caption without clearing its contents.
  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  await expect(caption).toBeFocused();
  await expect(caption).toHaveValue('Research notes\nSecond line');
  await caption.press('Escape');
  await expect(caption).not.toBeFocused();

  await caption.fill('Notes');
  await caption.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
  await caption.press('Backspace');
  await expect(caption).toHaveValue('Notes');
  await caption.press('End');
  await caption.press('Backspace');
  await expect(caption).toHaveValue('Note');
  await caption.fill('');
  await caption.press('Backspace');
  await expect(caption).toHaveCount(0);
  await expect(block(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(caption).toHaveValue('');

  await (await more(page)).getByRole('button', { name: 'Add caption', exact: true }).click();
  await expect(caption).toBeFocused();
  await caption.fill('Research notes\nSecond line');
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await expect(caption).not.toBeEditable();
  await page.reload();
  await expect(caption).toHaveValue('Research notes\nSecond line');
});

test('protected PDF handles wrong and correct passwords without persisting a password', async ({ page }, info) => {
  await embed(page, new URL('/fixtures/sample_with_password.pdf', page.url()).href);
  await expect(page.getByText(/This file is protected/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('pdf-locked.png') });
  await page.getByRole('textbox', { name: 'PDF password' }).fill('wrong-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('Incorrect password')).toBeVisible();
  await expect(page.getByLabel('PDF password')).toHaveValue('wrong-password');
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeDisabled();
  await page.getByLabel('PDF password').fill('123');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('pdf-document-snapshot')).not.toContainText('wrong-password');
  await page.reload();
  await expect(page.getByText(/This file is protected/)).toBeVisible();
});

test('non-PDF link becomes a preview; invalid links stay in the uploader', async ({ page }) => {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/pdf');
  await page.getByTestId('slash-menu-pdf').click();
  await page.getByRole('tab', { name: /embed/i }).click();
  await page.getByPlaceholder('Paste a link...').fill('not a url');
  await expect(page.getByRole('button', { name: 'Embed', exact: true })).toBeDisabled();
  await page.getByPlaceholder('Paste a link...').fill('www.gemini.google.com');
  await page.getByRole('button', { name: 'Embed', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(page.locator('[data-block-type="link_preview"]')).toHaveCount(1);
});

test('read-only keeps viewing and fullscreen, hides editing controls', async ({ page }) => {
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await block(page).hover();
  await expect(block(page).getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: 'Resize PDF width' })).toHaveCount(0);
  await block(page).getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByRole('dialog').locator('canvas').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('render failure offers retry and does not leave a stuck loading indicator', async ({ page }) => {
  let broken = true;

  await page.route('**/fixtures/broken.pdf', (route) =>
    broken
      ? route.fulfill({ contentType: 'application/pdf', body: 'not a PDF' })
      : route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'sample.pdf') })
  );
  await embed(page, new URL('/fixtures/broken.pdf', page.url()).href);
  await expect(block(page).getByRole('alert')).toContainText('Oops! Something went wrong.');
  broken = false;
  await block(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(block(page).locator('canvas').first()).toBeVisible();
});

test('external PDF links without CORS use the public PDF fallback and preserve their original URL', async ({ page }) => {
  const original = 'https://pdf.example.test/Community_Careers_Guide.pdf';
  let directRequests = 0;
  let proxyRequests = 0;

  await page.route(original, (route) => {
    directRequests++;
    return route.abort('failed');
  });
  await page.route('**/api/pdf-proxy?*', (route) => {
    proxyRequests++;
    expect(new URL(route.request().url()).searchParams.get('url')).toBe(original);
    return route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'sample.pdf') });
  });
  await embed(page, original);
  await expect(block(page).locator('.pdf-viewer')).toHaveAttribute('data-pdf-ready', 'true');
  await expect(block(page).locator('.textLayer').first()).not.toBeEmpty();
  await expect(page.getByTestId('pdf-document-snapshot')).toContainText(original);
  expect(directRequests).toBe(1);
  expect(proxyRequests).toBe(1);
});

test('scrolls through every page and supports download', async ({ page }) => {
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  const scroller = block(page).getByTestId('pdf-pages');

  await scroller.hover();
  await page.mouse.wheel(0, 8000);
  await expect(block(page).locator('[data-page-number="3"] canvas')).toBeVisible();
  await block(page).hover();
  const downloadPromise = page.waitForEvent('download');

  await block(page).getByRole('button', { name: 'Download', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('sample.pdf');
});

test('PDF visibility changes, permission rechecks and screenshots preserve the preview without reloading', async ({ page }, info) => {
  let downloads = 0;

  await page.route('**/fixtures/sample.pdf', (route) => {
    downloads++;
    return route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'sample.pdf') });
  });
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  const viewer = block(page).locator('.pdf-viewer');
  const canvas = await block(page).locator('canvas').first().elementHandle();

  await expect(viewer).toHaveAttribute('data-pdf-ready', 'true');
  await expect(block(page).locator('.textLayer').first()).not.toBeEmpty();
  await block(page).getByTestId('pdf-pages').evaluate((element) => { element.scrollTop = 120; });
  const scrollTop = await block(page).getByTestId('pdf-pages').evaluate((element) => element.scrollTop);
  const originalDownloads = downloads;

  for (const hidden of [true, false, true, false]) {
    await page.evaluate(async (hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(hidden ? 'blur' : 'focus'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, hidden);
    await expect(viewer).toHaveAttribute('data-pdf-ready', 'true');
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    expect(await block(page).getByTestId('pdf-pages').evaluate((element) => element.scrollTop)).toBe(scrollTop);

    if (!hidden) {
      // A background permission check removes edit capabilities until it resolves.
      await page.getByRole('checkbox', { name: 'Read only' }).check();
      expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
      await page.getByRole('checkbox', { name: 'Read only' }).uncheck();
      expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
      expect(await block(page).getByTestId('pdf-pages').evaluate((element) => element.scrollTop)).toBe(scrollTop);
    }
  }

  await page.screenshot({ path: info.outputPath('pdf-after-visibility-changes.png') });
  expect(downloads).toBe(originalDownloads);
});

test('PDF Ask AI matches the desktop composer, selects models and web search, stops and retries', async ({ page }, info) => {
  await page.route('**/api/ai/*/model/list', (route) => route.fulfill({ json: {
    code: 0, data: { models: [{ name: 'Auto' }, { name: 'PDF model' }] },
  } }));
  const requests: { model: string; text: string; webSearch: boolean }[] = [];
  let release!: () => void;
  const firstResponse = new Promise<void>((resolve) => { release = resolve; });

  await page.route('**/api/ai/*/v2/complete/stream', async (route) => {
    const body = route.request().postDataJSON();

    requests.push({ model: route.request().headers()['ai-model'], text: body.text, webSearch: body.metadata.web_search_enabled });
    const first = requests.length === 1;

    if (first) await firstResponse;
    await route.fulfill({ json: { '1': first ? 'Discarded response' : 'A useful PDF answer.' } });
  });
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await (await more(page)).getByRole('button', { name: 'Ask AI', exact: true }).click();
  await page.getByTestId('pdf-submenu').getByRole('button', { name: 'Ask AI', exact: true }).click();
  const assistant = page.getByTestId('pdf-assistant');
  const input = assistant.getByRole('textbox', { name: 'Ask AI', exact: true });
  const send = assistant.getByRole('button', { name: 'Send', exact: true });

  await expect(send).toBeDisabled();
  await expect(send).toHaveCSS('width', '32px');
  await expect(send.locator('svg')).toHaveCSS('height', '24px');
  await expect(assistant).toHaveCSS('border-radius', '12px');
  await expect(assistant).toHaveCSS('height', '78px');
  await expect(assistant.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
  const webSearch = assistant.getByRole('button', { name: 'Web Search', exact: true });

  await expect(webSearch).toHaveAttribute('aria-pressed', 'true');
  await expect(webSearch).toHaveCSS('width', '28px');
  await expect(webSearch.locator('svg')).toHaveCSS('width', '16px');
  await page.mouse.move(1100, 650);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('pdf-ai-empty-composer.png') });
  await webSearch.click();
  await expect(webSearch).toHaveAttribute('aria-pressed', 'false');
  await assistant.getByTestId('model-selector-button').click();
  await page.getByTestId('model-option-PDF model').click();
  expect(requests).toHaveLength(0);
  await input.fill('Summarize');
  await input.press('Shift+Enter');
  await input.press('p');
  await expect(input).toHaveValue('Summarize\np');
  await page.screenshot({ path: info.outputPath('pdf-ai-composer.png') });
  await input.press('Enter');
  try {
    const stop = assistant.getByRole('button', { name: 'Stop', exact: true });

    await expect(stop).toBeFocused();
    await expect(stop.locator('svg')).toHaveCSS('width', '24px');
    await expect(assistant.getByRole('textbox')).toHaveCount(0);
    await expect(assistant.getByRole('button', { name: 'Insert below', exact: true })).toHaveCount(0);
    await expect(assistant.locator('.math-equation-ai-dots > span')).toHaveCount(3);
    await page.screenshot({ path: info.outputPath('pdf-ai-loading.png') });
    await stop.click();
    await expect(input).toBeFocused();
    await expect(assistant.getByRole('button', { name: 'Insert below', exact: true })).toBeDisabled();
  } finally {
    release();
  }

  await assistant.getByTestId('model-selector-button').click();
  await page.getByTestId('model-option-Auto').click();
  await webSearch.click();
  expect(requests).toHaveLength(1);
  await assistant.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(assistant).toContainText('A useful PDF answer.');
  await expect(assistant).not.toContainText('Discarded response');
  expect(requests.map((request) => request.model)).toEqual(['PDF model', 'Auto']);
  expect(requests.map((request) => request.webSearch)).toEqual([false, true]);
  expect(requests[1].text).toBe(requests[0].text);
  expect(requests[0].text).toContain('Sample PDF');
  await expect(assistant.getByRole('button', { name: 'Insert below', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('pdf-ai-answer.png') });
  await input.press('Escape');
  await expect(assistant).toHaveCount(0);
});

test('AI summary extracts all pages, retries, inserts below, and respects read-only', async ({ page }) => {
  const requests: { text: string }[] = [];

  await page.route('**/api/ai/*/v2/complete/stream', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { '1': 'A concise summary of this PDF.' } });
  });
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await block(page).hover();
  await block(page).getByRole('button', { name: 'Ask AI', exact: true }).click();
  await page.getByRole('button', { name: 'Summarize PDF', exact: true }).click();
  const assistant = page.getByTestId('pdf-assistant');

  await expect(assistant).toContainText('A concise summary of this PDF.');
  expect(requests[0].text).toContain('Sample PDF');
  // The last page is initially virtualized out of the DOM but must be included.
  expect(requests[0].text.split('\n\n')).toHaveLength(4);
  expect(
    requests[0].text
      .split('\n\n')
      .slice(1)
      .every((text) => text.length > 100)
  ).toBe(true);
  await assistant.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await assistant.getByRole('button', { name: 'Insert below', exact: true }).click();
  await expect(assistant).toHaveCount(0);
  await expect(page.getByTestId('pdf-document-snapshot')).toContainText('A concise summary of this PDF.');
  await expect(block(page)).toHaveCount(1);
  await page.getByLabel('Read only', { exact: true }).check();
  await expect(block(page).getByRole('button', { name: 'Ask AI', exact: true })).toHaveCount(0);
});

test('Flutter string URL types, saved sizing, and device-local files remain compatible', async ({
  page,
  integrationsURL,
}) => {
  const seed = {
    type: 'pdf',
    data: {
      url: new URL('/fixtures/sample.pdf', integrationsURL).href,
      url_type: 'cloud',
      widthFactor: 0.5,
      heightFactor: 0.5,
      align: 'right',
      caption: 'From Flutter',
    },
    children: [{ type: 'text', children: [{ text: '' }] }],
  };

  await page.goto(new URL(`${fixturePath}?seed=${encodeURIComponent(JSON.stringify(seed))}`, integrationsURL).href);
  // This scenario uses a fresh saved document instead of the empty initial fixture.
  await page.evaluate(() => localStorage.removeItem('pdf-fixture'));
  await page.reload();
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await expect(block(page).getByLabel('PDF caption')).toHaveValue('From Flutter');
  const height = await block(page)
    .locator('.pdf-pages')
    .evaluate((element) => element.getBoundingClientRect().height);

  expect(height).toBeCloseTo(198, 0);
  seed.data.url = '/Users/another-user/private.pdf';
  seed.data.url_type = 'local';
  await page.evaluate(() => localStorage.removeItem('pdf-fixture'));
  await page.goto(new URL(`${fixturePath}?seed=${encodeURIComponent(JSON.stringify(seed))}`, integrationsURL).href);
  await expect(block(page).getByRole('status')).toContainText('stored on another device');
  await expect(block(page).locator('canvas')).toHaveCount(0);
});

test('resize handles persist changes, can be undone, and work at a mobile viewport', async ({ page }) => {
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await block(page).hover();
  const handle = block(page).getByRole('button', { name: 'Resize PDF height', exact: true });
  const bounds = await handle.boundingBox();

  await page.mouse.move(bounds!.x + 4, bounds!.y + 4);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 4, bounds!.y + 84, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('pdf-document-snapshot')).toContainText('"heightFactor":1.2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('pdf-document-snapshot')).not.toContainText('"heightFactor":1.2');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await expect
    .poll(() =>
      block(page)
        .locator('.pdf-viewer')
        .evaluate((element) => element.getBoundingClientRect().right <= innerWidth)
    )
    .toBe(true);
});

test('PDF annotation links are clickable and unsafe schemes are excluded', async ({ page }) => {
  await page.route('**/fixtures/links.pdf', (route) =>
    route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'links.pdf') })
  );
  await embed(page, new URL('/fixtures/links.pdf', page.url()).href);
  const link = block(page).getByRole('link', { name: 'https://appflowy.com/' });

  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(block(page).locator('.pdf-page a')).toHaveCount(1);
});

test('quick alignment and six-dot menu can move the PDF into a child page', async ({ page }) => {
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await block(page).hover();
  await block(page).getByRole('button', { name: 'Align', exact: true }).click();
  await page.getByRole('button', { name: 'Align left', exact: true }).click();
  await expect(page.getByTestId('pdf-document-snapshot')).toContainText('"align":"left"');
  await block(page).hover({ position: { x: 12, y: 12 } });
  await page.getByTestId('drag-block').click();
  await page.getByTestId('pdf-menu').getByRole('button', { name: 'Turn into', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(page.getByTestId('pdf-created-page')).toContainText('"type":"pdf"');
  await expect(page.getByTestId('pdf-created-page')).toContainText('sample.pdf');
});

for (const height of [700, 320]) {
  test(`PDF upload picker stays inside a ${height}px viewport near the bottom`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1000, height });
    await page.evaluate(() => localStorage.removeItem('pdf-fixture'));
    const url = new URL(fixturePath, page.url());

    url.searchParams.set('seed', JSON.stringify({ type: 'pdf', data: {}, children: [{ type: 'text', children: [{ text: '' }] }] }));
    await page.goto(url.href);
    await expect(page.getByTestId('pdf-empty')).toBeVisible();
    // Position a real editor block near the viewport edge before the lazy picker first loads.
    await block(page).evaluate((element, height) => {
      const editor = element.closest<HTMLElement>('[data-slate-editor]')!;

      editor.style.paddingTop = `${parseFloat(getComputedStyle(editor).paddingTop) + height - 80 - element.getBoundingClientRect().top}px`;
    }, height);
    await page.getByRole('button', { name: 'Upload or embed a PDF file', exact: true }).click();
    const uploader = page.getByTestId('pdf-uploader');
    const insideViewport = async () => {
      await expect.poll(async () => uploader.evaluate((element) => {
        const rect = element.getBoundingClientRect();

        return rect.top >= 16 && rect.bottom <= innerHeight - 16 && rect.left >= 16 && rect.right <= innerWidth - 16;
      })).toBe(true);
    };

    await expect(uploader).toBeVisible();
    await insideViewport();
    if (height === 700) {
      // MUI's opening scale transition changes the bounding box after the
      // picker is visible. Wait for its placement rather than sampling mid-animation.
      await expect.poll(async () => {
        const picker = await uploader.boundingBox();
        const target = await block(page).boundingBox();

        return picker && target ? picker.y + picker.height - target.y : Infinity;
      }).toBeLessThan(0);
    }

    await page.getByRole('tab', { name: 'Embed Link', exact: true }).click();
    await insideViewport();
    await page.getByRole('tab', { name: 'Upload', exact: true }).click();
    await insideViewport();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('pdf-picker-near-bottom.png') });
    const chooser = page.waitForEvent('filechooser');

    await uploader.getByTestId('file-dropzone').getByRole('button').click();
    await (await chooser).setFiles([]);
    await page.keyboard.press('Escape');
    await expect(uploader).toHaveCount(0);
    await expect(page.getByTestId('pdf-empty')).toBeVisible();
  });
}

for (const empty of [false, true]) {
  test(`PDF six-dot menu highlights the block until dismissed (empty=${empty})`, async ({ page }, info) => {
    if (empty) {
      await page.getByTestId('editor-content').click();
      await page.keyboard.type('/pdf');
      await page.getByTestId('slash-menu-pdf').click();
      await page.keyboard.press('Escape');
    } else {
      await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
      await expect(block(page).locator('canvas').first()).toBeVisible();
    }

    const surface = block(page).locator('.pdf-selection-surface');

    await block(page).hover();
    await page.getByTestId('drag-block').click();
    const menu = page.getByTestId('pdf-menu');

    await expect(menu).toBeVisible();
    const hasHighlight = () => surface.evaluate((element) => {
      const overlay = getComputedStyle(element, '::after');

      return overlay.content !== 'none' && overlay.backgroundColor !== 'rgba(0, 0, 0, 0)' && overlay.pointerEvents === 'none';
    });

    await expect.poll(hasHighlight).toBe(true);
    expect(await surface.evaluate((element) => getComputedStyle(element, '::after').boxShadow)).toBe('none');
    if (empty) {
      expect(await surface.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).toBe('rgba(0, 181, 255, 0.2)');
    }

    await menu.getByRole('button', { name: 'Turn into', exact: true }).click();
    await expect(page.getByTestId('pdf-submenu')).toBeVisible();
    await expect.poll(hasHighlight).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeVisible();
    await expect.poll(hasHighlight).toBe(true);
    await page.screenshot({ animations: 'disabled', path: info.outputPath('pdf-six-dot-selection.png') });
    if (empty) await page.mouse.click(1100, 650);
    else await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect.poll(hasHighlight).toBe(false);
  });
}

test('matches desktop empty block and picker geometry; dismissal preserves the empty block', async ({
  page,
  integrationsURL,
}, info) => {
  await page.goto(new URL(`${fixturePath}?design`, integrationsURL).href);
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/pdf');
  await page.getByTestId('slash-menu-pdf').click();
  const uploader = page.getByTestId('pdf-uploader');

  await expect(uploader).toBeVisible();
  expect(await uploader.evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([400, 347]);
  await expect(uploader.getByRole('button', { name: /^(Upload|Cancel)$/ })).toHaveCount(0);
  await expect(uploader.getByRole('button', { name: 'Drag & drop a file or click to Upload', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Upload', exact: true }).hover();
  await expect(uploader.getByTestId('file-dropzone').getByRole('button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await uploader.screenshot({ path: info.outputPath('pdf-upload-figma.png') });
  await page.locator('input[type="file"]').setInputFiles([]);
  await expect(uploader).toBeVisible();
  await expect(page.getByTestId('pdf-document-snapshot')).not.toContainText('pending_upload_id');
  await page.keyboard.press('Escape');
  await expect(block(page).locator('canvas')).toHaveCount(0);
  const empty = page.getByTestId('pdf-empty');

  expect(await empty.evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([536, 44]);
  await empty.screenshot({ path: info.outputPath('pdf-empty-figma.png') });
  await empty.getByRole('button', { name: 'More', exact: true }).click();
  expect(await page.getByTestId('pdf-menu').evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([240, 223]);
  await page.keyboard.press('Escape');
  await empty.getByRole('button', { name: 'Upload or embed a PDF file', exact: true }).click();
  await uploader.getByRole('tab', { name: 'Upload', exact: true }).hover();
  const neutralHighlight = await empty.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    expected: getComputedStyle(element).getPropertyValue('--block-bg-hover-color-20').trim(),
    overlay: getComputedStyle(element, '::after').content,
  }));

  expect(neutralHighlight.overlay).toBe('none');
  // Resolve the semantic token through the browser so both themes use desktop's active fill.
  await expect(empty).toHaveCSS('background-color', await empty.evaluate((element, color) => {
    const probe = document.createElement('div');

    probe.style.backgroundColor = color;
    element.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;

    probe.remove();
    return resolved;
  }, neutralHighlight.expected));
  await page.screenshot({ animations: 'disabled', path: info.outputPath('pdf-upload-neutral-active.png') });
  await page.getByRole('tab', { name: 'Embed Link', exact: true }).click();
  expect(await uploader.evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([400, 211]);
  await uploader.screenshot({ path: info.outputPath('pdf-embed-figma.png') });
});

test('PDF action menus and toolbar follow Figma sizing and row order', async ({ page }, info) => {
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('canvas').first()).toBeVisible();
  await block(page).hover();
  const toolbar = block(page).locator('.pdf-toolbar');

  expect(await toolbar.evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([164, 36]);
  await toolbar.screenshot({ path: info.outputPath('pdf-toolbar-figma.png') });
  const menu = await more(page);

  expect(await menu.evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([240, 464]);
  await expect(menu.getByRole('button')).toHaveText([
    'Delete',
    'Duplicate',
    'Copy link to block',
    'Copy link to original',
    'Turn into',
    'Replace',
    'Download',
    'Full screen',
    'Open in browser',
    'Add caption',
    'Align',
    'Ask AI',
  ]);
  await menu.screenshot({ path: info.outputPath('pdf-url-menu-figma.png') });
  await menu.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await page.getByTestId('pdf-submenu').getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect(page.getByTestId('pdf-assistant').getByPlaceholder('Ask CustomerIK AI')).toBeVisible();
  await page.getByTestId('pdf-assistant').getByPlaceholder('Ask CustomerIK AI').press('Escape');
  await expect(page.getByTestId('pdf-assistant')).toHaveCount(0);
});

for (const size of [
  { width: 1600, height: 1100, side: 'right' },
  { width: 1000, height: 600, side: 'left' },
] as const) {
  test(`PDF submenus open on the ${size.side} without covering the main menu`, async ({ page }, info) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
    await expect(block(page).locator('canvas').first()).toBeVisible();
    const menu = await more(page);
    const submenu = page.getByTestId('pdf-submenu');

    for (const label of ['Turn into', 'Align', 'Ask AI']) {
      const trigger = menu.getByRole('button', { name: label, exact: true });

      await trigger.click();
      await expect(submenu).toBeVisible();
      await expect.poll(async () => {
        const main = (await menu.boundingBox())!;
        const child = (await submenu.boundingBox())!;

        return size.side === 'right'
          ? child.x - (main.x + main.width)
          : main.x - (child.x + child.width);
      }).toBeCloseTo(4, 0);
      const child = (await submenu.boundingBox())!;

      expect(child.x).toBeGreaterThanOrEqual(16);
      expect(child.y).toBeGreaterThanOrEqual(16);
      expect(child.x + child.width).toBeLessThanOrEqual(size.width - 16);
      expect(child.y + child.height).toBeLessThanOrEqual(size.height - 16);
      if (size.side === 'right') expect(child.y).toBeCloseTo((await trigger.boundingBox())!.y, 0);
      if (label === 'Ask AI') await page.screenshot({ path: info.outputPath(`pdf-submenu-${size.side}.png`) });
      await page.keyboard.press('Escape');
      await expect(submenu).toHaveCount(0);
      await expect(menu).toBeVisible();
      await expect(trigger).toBeFocused();
    }

    await menu.getByRole('button', { name: 'Align', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(submenu.getByRole('button', { name: 'Align left', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(submenu).toHaveCount(0);
    await expect(menu.getByRole('button', { name: 'Align', exact: true })).toBeFocused();
  });
}

test('empty PDF Ask AI submits through the real writer request and can be closed', async ({ page }) => {
  const prompts: string[] = [];

  await page.route('**/api/ai/*/v2/complete/stream', async (route) => {
    prompts.push(route.request().postDataJSON().text);
    await route.fulfill({ json: { '1': 'You can upload a PDF using the upload button.' } });
  });
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/pdf');
  await page.getByTestId('slash-menu-pdf').click();
  await page.keyboard.press('Escape');
  await (await more(page)).getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Summarize PDF', exact: true })).toBeDisabled();
  await page.getByTestId('pdf-submenu').getByRole('button', { name: 'Ask AI', exact: true }).click();
  const assistant = page.getByTestId('pdf-assistant');

  await assistant.getByPlaceholder('Ask CustomerIK AI').fill('How do I upload a PDF?');
  await assistant.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(assistant).toContainText('You can upload a PDF using the upload button.');
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain('How do I upload a PDF?');
  await assistant.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(assistant).toHaveCount(0);
});

for (const mode of ['cloud', 'self-hosted']) {
  test(`upload limit respects ${mode} billing policy`, async ({ page, integrationsURL }, info) => {
    await page.goto(new URL(`${fixturePath}?quota=${mode}`, integrationsURL).href);
    await page.getByTestId('editor-content').click();
    await page.keyboard.type('/pdf');
    await page.getByTestId('slash-menu-pdf').click();
    await page.locator('input[type="file"]').setInputFiles(path.join(assets, 'sample.pdf'));
    await expect(page.getByTestId('pdf-document-snapshot')).toContainText('"upload_error":true');
    if (mode === 'cloud') {
      const dialog = page.getByRole('dialog', { name: 'Upgrade to Pro' });

      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([400, 184]);
      await dialog.screenshot({ path: info.outputPath('pdf-upload-limit-figma.png') });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    } else {
      await expect(page.getByRole('dialog', { name: 'Upgrade to Pro' })).toHaveCount(0);
    }

    await expect(block(page)).toContainText('Upload failed');
  });
}

for (const trigger of ['toolbar', 'six-dot']) {
  test(`open PDF ${trigger} menu reacts when loading finishes`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    await page.route('**/fixtures/slow.pdf', async (route) => {
      await held;
      await route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'sample.pdf') });
    });
    try {
      await embed(page, new URL('/fixtures/slow.pdf', page.url()).href);
      await block(page).hover();
      if (trigger === 'toolbar') await block(page).getByRole('button', { name: 'More', exact: true }).click();
      else await page.getByTestId('drag-block').click();
      const menu = page.getByTestId('pdf-menu');

      await expect(menu.getByRole('button', { name: 'Full screen', exact: true })).toBeDisabled();
      await expect(menu.getByRole('button', { name: 'Ask AI', exact: true })).toBeDisabled();
      release();
      await expect(block(page).locator('[data-pdf-ready="true"]')).toHaveCount(1);
      await expect(menu.getByRole('button', { name: 'Full screen', exact: true })).toBeEnabled();
      await expect(menu.getByRole('button', { name: 'Ask AI', exact: true })).toBeEnabled();
      await menu.getByRole('button', { name: 'Full screen', exact: true }).click();
      await expect(page.getByRole('dialog').locator('canvas').first()).toBeVisible();
    } finally {
      release();
    }
  });
}

for (const mode of ['cloud', 'self-hosted']) {
  test(`pasted PDF quota errors respect ${mode} billing policy`, async ({ page, integrationsURL }) => {
    await page.goto(new URL(`${fixturePath}?quota=${mode}`, integrationsURL).href);
    await expect(page.getByTestId('pdf-document-snapshot')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: 'Paste PDF', exact: true }).click();
    await expect(page.getByTestId('pdf-document-snapshot')).toContainText('"upload_error":true');
    await expect(block(page)).toContainText('Upload failed');
    const dialog = page.getByRole('dialog', { name: 'Upgrade to Pro' });

    if (mode === 'cloud') await expect(dialog).toBeVisible();
    else await expect(dialog).toHaveCount(0);
  });
}

test('PDF retry preserves its local file when permissions change and can recover', async ({ page, integrationsURL }) => {
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });

  await page.route('**/fixtures/upload', async (route) => {
    requests++;
    if (requests === 1) {
      await route.fulfill({ status: 503, body: 'Unavailable' });
      return;
    }

    if (requests === 2) await held;
    await route.fulfill({ json: { url: new URL('/fixtures/sample.pdf', page.url()).href } });
  });
  try {
    await page.goto(new URL(`${fixturePath}?controlled-upload`, integrationsURL).href);
    await expect(page.getByTestId('pdf-document-snapshot')).toHaveAttribute('data-ready', 'true');
    await page.getByTestId('editor-content').click();
    await page.keyboard.type('/pdf');
    await page.getByTestId('slash-menu-pdf').click();
    await page.locator('input[type="file"]').setInputFiles(path.join(assets, 'sample.pdf'));
    await expect(block(page)).toContainText('Upload failed');
    const snapshot = page.getByTestId('pdf-document-snapshot');
    const original = JSON.parse((await snapshot.textContent())!).find((node: { type: string }) => node.type === 'pdf');

    await block(page).getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => requests).toBe(2);
    await page.getByRole('checkbox', { name: 'Read only' }).check();
    release();
    await expect(block(page).getByRole('status')).toHaveCount(0);
    const after = JSON.parse((await snapshot.textContent())!).find((node: { type: string }) => node.type === 'pdf');

    expect(after.data.url).toBe('');
    expect(after.data.pending_upload_id).toBe('');
    expect(after.data.retry_local_url).toBe(original.data.retry_local_url);
    const storedFileExists = await page.evaluate((id) => new Promise<boolean>((resolve, reject) => {
      const open = indexedDB.open('FileStorage', 1);

      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('files', 'readonly').objectStore('files').get(id);

        request.onsuccess = () => { resolve(Boolean(request.result)); db.close(); };

        request.onerror = () => { reject(request.error); db.close(); };
      };
    }), original.data.retry_local_url);

    expect(storedFileExists).toBe(true);
    await page.getByRole('checkbox', { name: 'Read only' }).uncheck();
    await block(page).getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(snapshot).toContainText('"url_type":"cloud"');
    await expect(snapshot).toContainText('"retry_local_url":""');
    await expect(block(page).getByRole('alert')).toHaveCount(0);
    expect(requests).toBe(3);
  } finally {
    release();
  }
});

test('dropping multiple PDFs uploads each once, preserves order, and ignores drops when read-only', async ({ page, integrationsURL }) => {
  let uploads = 0;

  await page.route('**/fixtures/upload', (route) => {
    uploads++;
    return route.fulfill({ json: { url: new URL(`/fixtures/upload-${uploads}.pdf`, integrationsURL).href } });
  });
  await page.goto(new URL(`${fixturePath}?controlled-upload`, integrationsURL).href);
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/pdf');
  await page.getByTestId('slash-menu-pdf').click();
  await page.keyboard.press('Escape');
  const bytes = [...await readFile(path.join(assets, 'sample.pdf'))];
  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();

    for (const name of ['First.pdf', 'Second.pdf'])
      data.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
    return data;
  }, bytes);

  try {
    await block(page).locator('.pdf-block').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(block(page)).toHaveCount(2);
    await expect(block(page).locator('[data-pdf-ready="true"]')).toHaveCount(2);
    expect(uploads).toBe(2);
    const snapshot = page.getByTestId('pdf-document-snapshot');
    const names = () => snapshot.evaluate((element) => JSON.parse(element.textContent!)
      .filter((node: { type: string }) => node.type === 'pdf')
      .map((node: { data: { name: string } }) => node.data.name));

    await expect.poll(names).toEqual(['First.pdf', 'Second.pdf']);
    await page.getByRole('checkbox', { name: 'Read only' }).check();
    const saved = await snapshot.textContent();

    await block(page).first().locator('.pdf-block').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(snapshot).toHaveText(saved!);
    expect(uploads).toBe(2);
  } finally {
    await transfer.dispose();
  }

  await page.reload();
  await expect(block(page).locator('[data-pdf-ready="true"]')).toHaveCount(2);
  expect(uploads).toBe(2);
});

test('PDF menu hover keeps icons readable and Delete uses the shared error color', async ({ page }) => {
  await embed(page, new URL('/fixtures/sample.pdf', page.url()).href);
  await expect(block(page).locator('[data-pdf-ready="true"]')).toHaveCount(1);
  const menu = await more(page);
  const colors = await menu.evaluate((element) => {
    const probe = document.createElement('span');

    element.append(probe);
    const resolve = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };

    const colors = { primary: resolve('--text-primary'), error: resolve('--text-error') };

    probe.remove();
    return colors;
  });

  for (const label of ['Duplicate', 'Copy link to block', 'Replace', 'Download', 'Open in browser', 'Delete']) {
    const row = menu.getByRole('button', { name: label, exact: true });
    const icon = row.locator('.pdf-menu-icon');
    const expected = label === 'Delete' ? colors.error : colors.primary;

    await row.hover();
    await expect(row).toHaveCSS('color', expected);
    await expect(icon).toHaveCSS('background-color', expected);
    await expect(icon).not.toHaveCSS('mask-image', 'none');
  }

  await menu.getByRole('button', { name: 'Duplicate', exact: true }).hover();
  await expect(menu.getByRole('button', { name: 'Delete', exact: true })).toHaveCSS('color', colors.primary);
  await expect(menu.getByRole('button', { name: 'Comment', exact: true })).toHaveCount(0);
});

test('replacing a loading PDF ignores the old response and keeps the replacement after reload', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const original = new URL('/fixtures/old-password.pdf', page.url()).href;
  const replacement = new URL('/fixtures/replacement.pdf', page.url()).href;
  const requested = page.waitForRequest(original);

  await page.route(original, async (route) => {
    await held;
    await route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'sample_with_password.pdf') });
  });
  try {
    await embed(page, original);
    await requested;
    const cancelled = page.waitForEvent('requestfailed', (request) => request.url() === original);

    await (await more(page)).getByRole('button', { name: 'Replace', exact: true }).click();
    await page.getByRole('tab', { name: 'Embed Link', exact: true }).click();
    await page.getByPlaceholder('Paste a link...').fill(replacement);
    await page.getByRole('button', { name: 'Embed', exact: true }).click();
    await cancelled;
    await expect(block(page).locator('[data-pdf-ready="true"]')).toHaveCount(1);
    release();
    await expect(block(page).locator('.textLayer').first()).toContainText('Sample PDF');
    await expect(block(page).getByLabel('PDF password')).toHaveCount(0);
    await expect(page.getByTestId('pdf-document-snapshot')).toContainText(replacement);
    await expect(page.getByTestId('pdf-document-snapshot')).not.toContainText(original);
    await page.reload();
    await expect(block(page).locator('[data-pdf-ready="true"]')).toHaveCount(1);
    await expect(block(page).getByLabel('PDF password')).toHaveCount(0);
  } finally {
    release();
  }
});

test('password challenges after the CORS fallback reuse the loaded file and never persist passwords', async ({ page }) => {
  const original = 'https://pdf.example.test/protected.pdf';
  let directRequests = 0;
  let proxyRequests = 0;

  await page.route(original, (route) => {
    directRequests++;
    return route.abort('failed');
  });
  await page.route('**/api/pdf-proxy?*', (route) => {
    proxyRequests++;
    expect(new URL(route.request().url()).searchParams.get('url')).toBe(original);
    return route.fulfill({ contentType: 'application/pdf', path: path.join(assets, 'sample_with_password.pdf') });
  });
  await embed(page, original);
  await block(page).getByLabel('PDF password').fill('incorrect-secret');
  await block(page).getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(block(page).getByRole('alert')).toHaveText('Incorrect password');
  await block(page).getByLabel('PDF password').fill('123');
  await block(page).getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(block(page).locator('[data-pdf-ready="true"]')).toHaveCount(1);
  expect({ directRequests, proxyRequests }).toEqual({ directRequests: 1, proxyRequests: 1 });
  const snapshot = page.getByTestId('pdf-document-snapshot');

  await expect(snapshot).toContainText(original);
  await expect(snapshot).not.toContainText('incorrect-secret');
  await expect(snapshot).not.toContainText('password');
  await page.reload();
  await expect(block(page).getByLabel('PDF password')).toHaveValue('');
  expect({ directRequests, proxyRequests }).toEqual({ directRequests: 2, proxyRequests: 2 });
});

test('invalid PDF content does not use the CORS fallback and retries only when requested', async ({ page }) => {
  const original = 'https://pdf.example.test/invalid.pdf';
  let directRequests = 0;
  let proxyRequests = 0;

  await page.route(original, (route) => {
    directRequests++;
    return route.fulfill({ contentType: 'application/pdf', body: 'This is not PDF content.' });
  });
  await page.route('**/api/pdf-proxy?*', (route) => {
    proxyRequests++;
    return route.fulfill({ status: 502, body: 'Unexpected fallback' });
  });
  await embed(page, original);
  await expect(block(page).getByRole('alert')).toContainText('Oops! Something went wrong.');
  expect({ directRequests, proxyRequests }).toEqual({ directRequests: 1, proxyRequests: 0 });
  await block(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => directRequests).toBe(2);
  await expect(block(page).getByRole('alert')).toContainText('Oops! Something went wrong.');
  expect({ directRequests, proxyRequests }).toEqual({ directRequests: 2, proxyRequests: 0 });
});
