import { expect, Page } from '@playwright/test';

import { completeDriveAuthorization, mockDriveAuthorization, startDriveAuthorization } from '../../support/drive-authorization';
import { googlePickerFrame, mockGooglePicker, pickDriveFile } from '../../support/google-picker';
import { fixtureHTML, test } from '../../support/integrations-server';

const fixturePath = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const url = 'https://docs.google.com/document/d/example-document/edit';
const block = (page: Page) => page.locator('[data-block-type="google_drive"]');

async function insert(page: Page) {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/google');
  await page.getByRole('button', { name: 'Google Drive Embed', exact: true }).click();
  await expect(page.getByTestId('google-drive-picker')).toBeVisible();
  await expect(page.getByTestId('google-drive-picker').locator('..')).toHaveCSS('opacity', '1');
}

async function embed(page: Page, link = url) {
  await insert(page);
  await page.getByPlaceholder('Paste a link...').fill(link);
  await page.getByRole('button', { name: 'Embed', exact: true }).click();
}

async function more(page: Page) {
  await block(page).first().hover();
  await block(page).first().getByRole('button', { name: 'Google Drive options' }).click();
  const menu = page.getByTestId('google-drive-menu');

  await expect(menu.locator('..')).toHaveCSS('opacity', '1');
  await expect(menu.locator('..')).toHaveCSS('transform', 'none');
  return menu;
}

test.beforeEach(async ({ page, integrationsURL }) => {
  await mockGooglePicker(page);
  await page.route('**/api/ai/*/model/list', (route) => route.fulfill({ json: { code: 0, data: { models: [] } } }));
  await page.route('**/api/link-preview?*', (route) =>
    route.fulfill({ status: 502, json: { error: 'No public metadata' } })
  );
  await page.route('**/api/server-info', (route) =>
    route.fulfill({ json: { code: 0, data: { connections: ['google-drive'] } } })
  );
  await page.route('**/api/integrations/connections?*', (route) =>
    route.fulfill({ json: { code: 0, data: { connections: [] } } })
  );
  await page.route('https://docs.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="background:#f0f7ff;font:28px sans-serif"><h1>Test Google document</h1><p>Editable Google preview</p></body></html>',
    })
  );
  await page.route(`**${fixturePath}*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('google-drive') })
  );
  await page.goto(new URL(fixturePath, integrationsURL).href);
  await expect(page.getByTestId('drive-document-snapshot')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
});

test('empty picker matches geometry and switches to the connect-account state', async ({ page }, info) => {
  await insert(page);
  await expect(page.getByPlaceholder('Paste a link...')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Embed', exact: true })).toBeDisabled();
  await expect(page.getByTestId('google-drive-picker')).toHaveCSS('width', '400px');
  await expect(block(page).locator('.google-drive-block')).toHaveAttribute('data-selected', 'false');
  const placeholder = block(page).locator('[data-media-placeholder="true"]');

  await expect(placeholder).toHaveClass(/drive-empty/);
  await expect(placeholder).toHaveCSS('height', '44px');
  await expect(placeholder).toHaveCSS('padding', '8px 12px');
  await page.screenshot({ path: info.outputPath('drive-link-picker.png') });
  await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Account' })).toBeEnabled();
  await expect(page.getByText('Find and embed your Google Drive files.')).toBeVisible();
  await page.screenshot({ path: info.outputPath('drive-connect-picker.png') });
});

test('public embed keeps its iframe on focus, screenshots, hover and captions; explicit Reload refreshes', async ({
  page,
}, info) => {
  let loads = 0;

  page.on('request', (request) => {
    if (request.url().startsWith('https://docs.google.com/')) loads++;
  });
  await embed(page);
  await expect(block(page).locator('iframe')).toBeVisible();
  await expect(block(page).locator('[data-media-placeholder="true"]')).toHaveCount(0);
  await expect(block(page).locator('.drive-card')).toHaveCSS('height', '400px');
  const initial = loads;

  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await block(page).hover();
  await page.screenshot({ path: info.outputPath('drive-preview.png') });
  await (await more(page)).getByRole('menuitem', { name: 'Add caption' }).click();
  const caption = page.getByRole('textbox', { name: 'Google Drive caption' });

  await expect(caption).toBeFocused();
  await caption.fill('Left aligned caption');
  await expect(caption).toHaveCSS('text-align', 'left');
  expect(loads).toBe(initial);
  await (await more(page)).getByRole('menuitem', { name: 'Reload', exact: true }).click();
  await expect.poll(() => loads).toBe(initial + 1);
  await page.reload();
  await expect(caption).toHaveValue('Left aligned caption');
  await expect(caption).not.toBeFocused();
});

test('menu selection, hover, alignment icons and submenu collision placement', async ({ page }, info) => {
  await embed(page);
  await page.setViewportSize({ width: 900, height: 650 });
  const menu = await more(page);

  await expect(block(page).locator('.google-drive-block')).toHaveAttribute('data-selected', 'true');
  const selected = await block(page)
    .locator('.drive-card')
    .evaluate((element) => ({
      fill: getComputedStyle(element, '::after').backgroundColor,
      outline: getComputedStyle(element).outlineStyle,
    }));

  expect(selected.fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(selected.outline).toBe('none');
  await menu.getByRole('menuitem', { name: 'Delete', exact: true }).hover();
  const colors = await menu.getByRole('menuitem', { name: 'Delete', exact: true }).evaluate((element) => ({
    text: getComputedStyle(element).color,
    icon: getComputedStyle(element.querySelector('.drive-menu-icon')!).backgroundColor,
  }));

  expect(colors.icon).toBe(colors.text);
  const [red, green, blue] = colors.text.match(/\d+/g)!.map(Number);

  expect(red).toBeGreaterThan(green);
  expect(red).toBeGreaterThan(blue);
  const duplicate = menu.getByRole('menuitem', { name: 'Duplicate', exact: true });

  await duplicate.hover();
  const normal = await duplicate.evaluate((element) => ({
    text: getComputedStyle(element).color,
    icon: getComputedStyle(element.querySelector('.drive-menu-icon')!).backgroundColor,
  }));

  expect(normal.icon).toBe(normal.text);
  if (info.project.name === 'drive-dark') expect(normal.icon).not.toBe('rgb(0, 0, 0)');
  await menu.getByRole('menuitem', { name: 'Align', exact: true }).click();
  const sub = page.getByTestId('google-drive-submenu');

  await expect(sub.locator('[data-drive-icon^="align-"]')).toHaveCount(3);
  const bounds = await sub.boundingBox();

  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(650);
  await page.screenshot({ path: info.outputPath('drive-menu-align.png') });
  await menu.getByRole('menuitem', { name: 'Align', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(sub.getByRole('menuitem', { name: 'Left', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(sub.getByRole('menuitem', { name: 'Center', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(sub.getByRole('menuitem', { name: 'Right', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(sub).toBeHidden();
  await expect(menu.getByRole('menuitem', { name: 'Align', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('drive-document-snapshot')).toContainText('"align":"right"');
});

test('duplicate preserves metadata, turn into Page preserves content and undo restores the block', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(block(page)).toHaveCount(2);
  await expect(block(page).locator('iframe')).toHaveCount(2);
  await (await more(page)).getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await expect(page.getByTestId('google-drive-submenu').getByRole('menuitem')).toHaveCount(1);
  await page.getByTestId('google-drive-submenu').getByRole('menuitem', { name: 'Page', exact: true }).click();
  await expect(page.getByTestId('drive-created-page')).toContainText(url);
  await expect(block(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(block(page)).toHaveCount(2);
});

test('replacement opens an empty focused link; invalid provider becomes a bookmark', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('menuitem', { name: 'Replace' }).click();
  await expect(page.getByPlaceholder('Paste a link...')).toHaveValue('');
  await expect(page.getByPlaceholder('Paste a link...')).toBeFocused();
  await page.getByPlaceholder('Paste a link...').fill('https://example.com');
  await page.getByRole('button', { name: 'Embed', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(page.locator('[data-block-type="link_preview"]')).toBeVisible();
  await expect(page.getByText('Unable to embed URL, saved as a bookmark.')).toBeVisible();
});

test('Ask AI opens the standard composer and empty Escape or outside click dismiss it', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  const ai = page.getByTestId('google-drive-assistant');

  await expect(ai).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ai).toBeHidden();
  await (await more(page)).getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  await expect(ai).toBeVisible();
  await page.getByRole('button', { name: 'Remote edit' }).click();
  await expect(ai).toBeHidden();
});

const accounts = [
  { id: 'personal', provider: 'google-drive', status: 'active', account_identifier: 'personal@example.com' },
  { id: 'work', provider: 'google-drive', status: 'active', account_identifier: 'work@example.com' },
];
const privateFile = {
  id: 'private-file',
  name: 'Private roadmap',
  mimeType: 'application/vnd.google-apps.document',
  size: '2632',
  modifiedTime: '2026-11-01T00:00:00Z',
};

async function connected(page: Page, requests: Record<string, unknown>[] = []) {
  await page.route('**/api/integrations/connections?*', (route) =>
    route.fulfill({ json: { code: 0, data: { connections: accounts } } })
  );
  await page.route('**/api/integrations/connections/*/token?*', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: { access_token: `test-token-${new URL(route.request().url()).pathname.split('/').at(-2)}` },
      },
    })
  );
  await page.route('**/api/integrations/proxy', (route) => {
    const body = route.request().postDataJSON();

    requests.push(body);
    const data = body.endpoint.endsWith('/files')
      ? { files: [privateFile], ...(body.params.pageToken ? {} : { nextPageToken: 'next' }) }
      : privateFile;

    return route.fulfill({ json: { code: 0, data: { data } } });
  });
}

async function choosePrivate(page: Page) {
  const metadata = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/integrations/proxy') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.endpoint === `/drive/v3/files/${privateFile.id}`
  );

  await insert(page);
  await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
  await page.getByRole('button', { name: 'Choose from work@example.com' }).click();
  await pickDriveFile(page);
  // Picker metadata can render the footer before the authenticated preview loads.
  await metadata;
  await expect(block(page).locator('.drive-footer')).toContainText('Private roadmap');
}

test('Flutter parity: blank input keeps an empty block and cannot erase an existing embed', async ({ page }) => {
  await insert(page);
  const input = page.getByPlaceholder('Paste a link...');

  await input.fill('   ');
  await expect(page.getByRole('button', { name: 'Embed', exact: true })).toBeDisabled();
  await input.press('Enter');
  await expect(block(page).locator('.drive-empty')).toBeVisible();
  await expect(block(page).locator('iframe')).toHaveCount(0);
  await input.fill(url);
  await input.press('Enter');
  await expect(block(page).locator('iframe')).toBeVisible();
  await (await more(page)).getByRole('menuitem', { name: 'Replace' }).click();
  await input.fill('   ');
  await input.press('Enter');
  await expect(page.getByTestId('google-drive-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(block(page).locator('iframe')).toHaveAttribute('src', url.replace('/edit', '/preview'));
  await page.getByRole('button', { name: 'Clear Drive source' }).click();
  await expect(block(page).locator('.drive-empty')).toBeVisible();
  await expect(block(page).locator('iframe')).toHaveCount(0);
  await page.reload();
  await expect(block(page).locator('.drive-empty')).toBeVisible();
});

test('Flutter parity: ordinary account refresh updates the chooser without opening Google Picker', async ({ page }) => {
  let providers: string[] = [];
  let available = false;

  await connected(page);
  await page.route('**/api/server-info', (route) => route.fulfill({ json: { code: 0, data: { connections: providers } } }));
  await page.route('**/api/integrations/connections?*', (route) =>
    route.fulfill({ json: { code: 0, data: { connections: available ? accounts : [] } } })
  );
  await insert(page);
  await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Account' })).toBeDisabled();
  await expect(page.getByText(/Unavailable connections: Google Drive/)).toBeVisible();
  available = true;
  providers = ['google-drive'];
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose from work@example.com' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add another account' })).toBeEnabled();
  await expect(page.getByTestId('google-drive-browser').getByRole('status')).toHaveCount(0);
  await expect(page.locator('.picker-dialog')).toHaveCount(0);
  // An ordinary refresh must not select the first account implicitly.
  await page.getByRole('button', { name: 'Choose from work@example.com' }).click();
  await expect(googlePickerFrame(page).getByRole('textbox')).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __googlePickerConfig: { token: string } }).__googlePickerConfig.token)).toBe('test-token-work');
});

for (const existing of [false, true]) {
  test(`Flutter parity: ${existing ? 'additional' : 'first'} OAuth account waits for confirmation then opens its own picker`, async ({ page }) => {
    await connected(page);
    const auth = await mockDriveAuthorization(page, existing ? accounts : []);
    let release!: () => void;
    const confirmation = new Promise<void>((resolve) => { release = resolve; });

    await page.route('**/api/integrations/connections/callback', async (route) => {
      await confirmation;
      await route.fallback();
    }, { times: 1 });
    await insert(page);
    await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
    const popup = await startDriveAuthorization(page, existing ? 'Add another account' : 'Connect Google Account');

    await completeDriveAuthorization(popup);
    await expect(page.getByText('Finishing connection…')).toBeVisible();
    await expect(page.locator('.picker-dialog')).toHaveCount(0);
    release();
    await expect(googlePickerFrame(page).getByRole('textbox')).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __googlePickerConfig: { token: string } }).__googlePickerConfig.token)).toBe('test-token-new-drive');
    expect(auth.starts).toBe(1);
    expect(auth.confirmations).toBe(1);
    await googlePickerFrame(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose from new@example.com' })).toBeFocused();
    await expect(page.getByTestId('google-drive-browser').getByRole('status')).toHaveCount(0);
    if (existing) await expect(page.getByRole('button', { name: 'Choose from work@example.com' })).toBeVisible();
    await page.getByRole('button', { name: 'Choose from new@example.com' }).click();
    await pickDriveFile(page);
    await expect(page.getByTestId('drive-document-snapshot')).toContainText('new@example.com');
    await expect(page.getByTestId('drive-document-snapshot')).not.toContainText('test-token');
    await page.reload();
    await expect(block(page).locator('.drive-footer')).toContainText('Private roadmap');
  });
}

for (const stage of ['authorization', 'confirmation']) {
  test(`Flutter parity: stalled ${stage} times out, preserves existing accounts and permits retry`, async ({ page }) => {
    await connected(page);
    const auth = await mockDriveAuthorization(page, accounts);

    if (stage === 'authorization') await page.clock.install();
    else {
      // Leave the request unanswered to exercise the real XMLHttpRequest timeout.
      await page.route('**/api/integrations/connections/callback', () => {
        // Intentionally leave this request pending until the browser transport times out.
      }, { times: 1 });
    }

    await insert(page);
    await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
    const popup = await startDriveAuthorization(page, 'Add another account');

    if (stage === 'authorization') await page.clock.fastForward('02:01');
    else await completeDriveAuthorization(popup);
    const error = page.getByTestId('google-drive-browser').getByRole('alert');

    await expect(error).toContainText(/timed out/i, { timeout: 55_000 });
    expect(popup.isClosed()).toBe(true);
    await expect(page.getByRole('button', { name: 'Choose from work@example.com' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add another account' })).toBeEnabled();
    await expect(page.locator('.picker-dialog')).toHaveCount(0);
    expect(auth.confirmations).toBe(0);
    await completeDriveAuthorization(await startDriveAuthorization(page, 'Add another account'));
    await expect(googlePickerFrame(page).getByRole('textbox')).toBeFocused();
    expect(auth.confirmations).toBe(1);
    expect(auth.starts).toBe(2);
  });
}

for (const status of [403, 404, 500]) {
  test(`Flutter parity: Drive ${status} has safe recovery guidance without server diagnostics`, async ({ page }) => {
    await connected(page);
    await choosePrivate(page);
    await page.route('**/api/integrations/proxy', (route) =>
      route.fulfill({ status, json: { code: status, message: 'SQLSTATE 42P01: relation af_user does not exist' } })
    );
    await (await more(page)).getByRole('menuitem', { name: 'Reload', exact: true }).click();
    if (status === 500) {
      await expect(block(page).getByRole('alert')).toContainText('Please check the file link or try again later.');
      await expect(block(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    } else {
      await expect(block(page).getByRole('button', { name: 'Connect to Google Drive' })).toBeVisible();
      await expect(block(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    }

    await expect(page.locator('body')).not.toContainText('SQLSTATE');
    await expect(page.locator('body')).not.toContainText('af_user');
    await connected(page);
    if (status === 500) await block(page).getByRole('button', { name: 'Try again' }).click();
    else {
      await block(page).getByRole('button', { name: 'Connect to Google Drive' }).click();
      await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
      await page.getByRole('button', { name: 'Choose from work@example.com' }).click();
      await pickDriveFile(page);
    }

    await expect(block(page).locator('iframe')).toBeVisible();
    await expect(block(page).locator('.drive-footer')).toContainText('Private roadmap');
  });
}

test('Flutter account chooser opens Google Picker for the selected account and persists file metadata', async ({
  page,
}, info) => {
  const requests: Record<string, unknown>[] = [];

  await connected(page, requests);
  await insert(page);
  await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
  await expect(page.getByRole('button', { name: 'Choose from personal@example.com' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('drive-accounts.png') });
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Choose from work@example.com' }).click();
  const search = googlePickerFrame(page).getByRole('textbox', { name: 'Search Google Drive' });

  await expect(search).toBeFocused();
  await search.fill("O'Brien");
  await expect(search).toHaveValue("O'Brien");
  const config = await page.evaluate(() => (window as unknown as { __googlePickerConfig: { token: string } }).__googlePickerConfig);

  expect(config).toMatchObject({
    token: 'test-token-work',
    appId: '994557425188',
    feature: 'supportDrives',
    origin: new URL(page.url()).origin,
    view: { folders: true, selectFolders: false },
  });
  await expect(page.locator('.picker-dialog')).toHaveCSS('z-index', '1601');
  await pickDriveFile(page);
  await expect(block(page).locator('.drive-footer')).toContainText('2.57 KB');
  await expect(page.getByTestId('drive-document-snapshot')).toContainText('work@example.com');
  await expect(page.getByTestId('drive-document-snapshot')).not.toContainText('test-token');
  expect(requests.every((body) => body.connection_id === 'work')).toBe(true);
  expect(requests.some((body) => body.endpoint === '/drive/v3/files/private-file')).toBe(true);
  await page.reload();
  await expect(block(page).locator('.drive-footer')).toContainText('Private roadmap');
});

test('Google Picker cancel returns to accounts, reopens for another account and retries token failures', async ({
  page,
}) => {
  await connected(page);
  let fail = true;

  await page.route('**/api/integrations/connections/work/token?*', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { code: 503, message: 'test failure' } }
        : { json: { code: 0, data: { access_token: 'test-token-work' } } }
    )
  );
  await insert(page);
  await page.getByRole('tab', { name: 'Browse Google Drive' }).click();
  await page.getByRole('button', { name: 'Choose from work@example.com' }).click();
  await expect(page.getByTestId('google-drive-native-picker').getByRole('alert')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await googlePickerFrame(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.picker-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose from work@example.com' })).toBeFocused();
  await expect(block(page).locator('.drive-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Choose from personal@example.com' }).click();
  await expect(googlePickerFrame(page).getByRole('textbox')).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __googlePickerConfig: { token: string } }).__googlePickerConfig.token)).toBe('test-token-personal');
  await googlePickerFrame(page).getByRole('textbox').press('Escape');
  await expect(page.locator('.picker-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose from personal@example.com' })).toBeFocused();
});

test('missing account reconnects, provider failures retry, and private previews do not refetch on focus', async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];

  await connected(page, requests);
  await choosePrivate(page);
  const initial = requests.length;

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await (await more(page)).getByRole('menuitem', { name: 'Add caption' }).click();
  await page.getByRole('textbox', { name: 'Google Drive caption' }).fill('Private caption');
  expect(requests.length).toBe(initial);
  await page.route('**/api/integrations/proxy', (route) =>
    route.fulfill({ status: 503, json: { code: 503, message: 'unavailable' } })
  );
  await (await more(page)).getByRole('menuitem', { name: 'Reload', exact: true }).click();
  await expect(block(page).getByRole('alert')).toBeVisible();
  await connected(page, requests);
  await block(page).getByRole('button', { name: 'Try again' }).click();
  await expect(block(page).locator('.drive-footer')).toContainText('Private roadmap');
  await page.route('**/api/integrations/connections?*', (route) =>
    route.fulfill({ json: { code: 0, data: { connections: [] } } })
  );
  await page.reload();
  await expect(block(page).getByRole('button', { name: 'Connect to Google Drive' })).toBeVisible();
});

test('six-dot selection is a blue fill for empty blocks; the picker stays neutral and within a short viewport', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await insert(page);
  await page.keyboard.press('Escape');
  await block(page).hover();
  await page.getByTestId('drag-block').click();
  await expect(page.getByTestId('google-drive-menu')).toBeVisible();
  await expect(block(page).locator('.google-drive-block')).toHaveAttribute('data-selected', 'true');
  const surface = block(page).locator('.drive-empty');

  expect(await surface.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)'
  );
  await page.keyboard.press('Escape');
  await surface.click();
  const picker = page.getByTestId('google-drive-picker');

  await expect(picker).toBeVisible();
  await expect(block(page).locator('.google-drive-block')).toHaveAttribute('data-selected', 'false');
  const bounds = await picker.boundingBox();

  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await page.screenshot({ path: info.outputPath('drive-small-viewport.png') });
});

test('all four resize handles persist; readonly disables editing and resizing', async ({ page }) => {
  await embed(page);
  for (const side of ['Left', 'Right', 'Top', 'Bottom']) {
    const handle = block(page).getByRole('button', { name: `Resize ${side.toLowerCase()}`, exact: true });

    await block(page).hover();
    await handle.focus();
    await handle.press(side === 'Left' || side === 'Right' ? 'ArrowLeft' : 'ArrowDown');
  }

  await expect(page.getByTestId('drive-document-snapshot')).toContainText('width_factor');
  await expect(page.getByTestId('drive-document-snapshot')).toContainText('height_factor');
  const width = await block(page)
    .locator('.drive-card')
    .evaluate((element) => element.clientWidth);

  await page.reload();
  await expect
    .poll(() =>
      block(page)
        .locator('.drive-card')
        .evaluate((element) => element.clientWidth)
    )
    .toBe(width);
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await expect(block(page).locator('.drive-resize')).toHaveCount(0);
  await more(page);
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
});

test('replacing a Drive source cancels an active pointer resize without overwriting its saved size', async ({ page }) => {
  await embed(page);
  const card = block(page).locator('.drive-card');
  const originalWidth = (await card.boundingBox())!.width;

  await block(page).hover();
  const handle = await block(page).getByRole('button', { name: 'Resize right', exact: true }).boundingBox();
  const x = handle!.x + handle!.width / 2;
  const y = handle!.y + handle!.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 3 });
  await expect.poll(async () => (await card.boundingBox())!.width).toBeLessThan(originalWidth - 90);
  // A document update arrives while the pointer remains captured by the old source.
  await page.getByRole('button', { name: 'Remote replace', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(card.locator('iframe')).toHaveAttribute('src', /replacement-document/);
  await expect.poll(async () => (await card.boundingBox())!.width).toBe(originalWidth);
  await page.mouse.up();
  await page.reload();
  await expect(card.locator('iframe')).toHaveAttribute('src', /replacement-document/);
  await expect.poll(async () => (await card.boundingBox())!.width).toBe(originalWidth);
  await expect(card.locator('iframe')).toHaveCSS('pointer-events', 'auto');
  // A completed gesture still persists and returns input to the viewer.
  await block(page).hover();
  const nextHandle = await block(page).getByRole('button', { name: 'Resize right', exact: true }).boundingBox();
  const nextX = nextHandle!.x + nextHandle!.width / 2;
  const nextY = nextHandle!.y + nextHandle!.height / 2;

  await page.mouse.move(nextX, nextY);
  await page.mouse.down();
  await page.mouse.move(nextX - 100, nextY, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())!.width).toBeLessThan(originalWidth - 90);
  const savedWidth = (await card.boundingBox())!.width;

  await expect(card.locator('iframe')).toHaveCSS('pointer-events', 'auto');
  await page.reload();
  await expect.poll(async () => (await card.boundingBox())!.width).toBe(savedWidth);
});

test('copy actions show the standard toast only after success and Open in browser opens a new tab', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await embed(page);
  for (const name of ['Copy link to block', 'Copy link to original']) {
    await (await more(page)).getByRole('menuitem', { name, exact: true }).click();
    await expect(page.getByText('Copied to clipboard', { exact: true }).last()).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    expect(name.endsWith('original') ? copied === url : copied.includes('blockId=')).toBe(true);
  }

  const popup = page.waitForEvent('popup');

  await (await more(page)).getByRole('menuitem', { name: 'Open in browser', exact: true }).click();
  const opened = await popup;

  await expect(opened).toHaveURL(url);
  await opened.close();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => Promise.reject(new Error('Denied')),
    });
  });
  await (await more(page)).getByRole('menuitem', { name: 'Copy link to original', exact: true }).click();
  await expect(page.getByText('Unable to copy. Please try again.')).toBeVisible();
});

test('Ask AI retains a draft on Escape and outside click', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  const ai = page.getByTestId('google-drive-assistant');

  await ai.getByRole('textbox').fill('Explain this');
  await page.keyboard.press('Escape');
  await expect(ai).toBeVisible();
  await page.getByRole('button', { name: 'Remote edit' }).click();
  await expect(ai.getByRole('textbox')).toHaveValue('Explain this');
});

test('public titles and pasted mentions retain the shared filename truncation style', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const name = 'Annual roadmap with detailed findings and recommendations for the next planning cycle';

  await page.route('**/api/link-preview?*', (route) => route.fulfill({ json: { title: name, description: 'Roadmap' } }));
  await embed(page);
  await expect(block(page).locator('.drive-footer')).toContainText(name);
  await (await more(page)).getByRole('menuitem', { name: 'Copy link to block', exact: true }).click();
  const editor = page.getByTestId('editor-content');
  const bounds = (await editor.boundingBox())!;

  await editor.click({ position: { x: 20, y: bounds.height - 200 } });
  await editor.locator('[data-block-type="paragraph"]').last().click();
  await page.keyboard.press('ControlOrMeta+v');
  const label = editor.locator('.mention-inline .mention-content');

  await expect(label).toHaveText(name);
  await expect(label).toHaveCSS('max-width', '330px');
  await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  await label.screenshot({ path: info.outputPath('drive-name-mention.png') });
  await page.reload();
  await expect(label).toHaveText(name);
});

test('fullscreen uses the existing preview and Escape returns to the document', async ({ page }) => {
  let loads = 0;

  page.on('request', (request) => {
    if (request.url().startsWith('https://docs.google.com/')) loads++;
  });
  await embed(page);
  await expect(block(page).locator('iframe')).toBeVisible();
  const initial = loads;

  await (await more(page)).getByRole('menuitem', { name: 'Full screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press('Escape');
  // Headless Chrome does not process the native OS fullscreen shortcut.
  if (await page.evaluate(() => !!document.fullscreenElement)) await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(loads).toBe(initial);
});

// Real browser wheel/keyboard input must reach the preview, not the editor.
// Google responses are test-owned; the iframe still has a separate origin.
test('public Drive PDF viewer accepts wheel, keyboard and page controls without reloading', async ({ page }) => {
  let viewerLoads = 0;

  await page.route('https://drive.google.com/file/d/scrollable-pdf/preview', (route) => {
    viewerLoads++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
      <button id="next" style="position:fixed;top:8px;left:8px" onclick="document.getElementById('page-2').scrollIntoView()">Next page</button>
      <div style="height:1200px;background:#d1efe7">PDF page 1</div>
      <div id="page-2" style="height:1200px;background:#ddeaff">PDF page 2</div>
      </body></html>`,
    });
  });
  await embed(page, 'https://drive.google.com/file/d/scrollable-pdf/view');
  const viewer = block(page).locator('iframe');

  await expect(viewer).toBeVisible();
  const content = page.frameLocator('iframe[src*="scrollable-pdf/preview"]');

  await expect(content.getByRole('button', { name: 'Next page' })).toBeVisible();
  const frame = await (await viewer.elementHandle())!.contentFrame();
  const outerScroll = await page.evaluate(() => window.scrollY);

  await viewer.hover();
  await page.mouse.wheel(0, 350);
  await expect.poll(() => frame!.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(outerScroll);
  await content.getByRole('button', { name: 'Next page' }).click();
  await expect.poll(() => frame!.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(1200);
  const scroll = await frame!.evaluate(() => window.scrollY);

  await page.keyboard.press('PageDown');
  await expect.poll(() => frame!.evaluate(() => window.scrollY)).toBeGreaterThan(scroll);
  expect(viewerLoads).toBe(1);
});

test('connected Drive image preview scrolls at full width, including read-only and fullscreen', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];

  await connected(page, requests);
  const thumbnailLink = 'https://test.googleusercontent.com/drive-tall-preview';
  let imageLoads = 0;

  await page.route('**/api/integrations/proxy', (route) => {
    const body = route.request().postDataJSON();

    requests.push(body);
    return route.fulfill({
      json: { code: 0, data: { data: { ...privateFile, mimeType: 'image/jpeg', thumbnailLink } } },
    });
  });
  await page.route(thumbnailLink, (route) => {
    imageLoads++;
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="2400"><rect width="600" height="1200" fill="#d1efe7"/><rect y="1200" width="600" height="1200" fill="#ddeaff"/></svg>`,
    });
  });
  await choosePrivate(page);
  const image = block(page).getByRole('img', { name: privateFile.name, exact: true });

  await expect(image).toBeVisible();
  const preview = block(page).getByRole('region', { name: privateFile.name, exact: true });

  await expect
    .poll(() => preview.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(100);
  await image.hover({ position: { x: 100, y: 100 } });
  // Hover may scroll the target into view; measure only the wheel's effect.
  const outerScroll = await page.evaluate(() => window.scrollY);

  await page.mouse.wheel(0, 350);
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(outerScroll);
  const before = await preview.evaluate((element) => element.scrollTop);

  await preview.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
  const initialRequests = requests.length;

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await expect(image).toBeVisible();
  await preview.hover();
  const readOnlyScroll = await preview.evaluate((element) => element.scrollTop);

  await page.mouse.wheel(0, 250);
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(readOnlyScroll);
  await block(page).getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await preview.hover();
  const fullscreenScroll = await preview.evaluate((element) => element.scrollTop);

  await page.mouse.wheel(0, 250);
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(fullscreenScroll);
  await page.evaluate(() => document.exitFullscreen());
  expect(imageLoads).toBe(1);
  expect(requests.length).toBe(initialRequests);

  // The dialog fallback must scroll too, and Escape must still close it when
  // keyboard focus is inside the newly focusable preview.
  await page.evaluate(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error('Fullscreen unavailable'));
  });
  await block(page).getByRole('button', { name: 'Full screen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const dialogPreview = dialog.getByRole('region', { name: privateFile.name, exact: true });

  await expect(dialogPreview).toBeVisible();
  await dialogPreview.hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => dialogPreview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await dialogPreview.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

for (const [format, mimeType, viewerUrl] of [
  ['PDF', 'application/pdf', 'https://drive.google.com/file/d/private-file/preview'],
  ['document', 'application/vnd.google-apps.document', 'https://docs.google.com/document/d/private-file/preview'],
]) {
  test(`connected Drive ${format} shows later pages even when Google supplies a first-page thumbnail`, async ({
    page,
  }) => {
    const requests: Record<string, unknown>[] = [];

    await connected(page, requests);
    const thumbnailLink = 'https://test.googleusercontent.com/first-page-only';
    let thumbnailLoads = 0;
    let viewerLoads = 0;

    await page.route('**/api/integrations/proxy', (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { code: 0, data: { data: { ...privateFile, mimeType, thumbnailLink } } } });
    });
    await page.route(thumbnailLink, (route) => {
      thumbnailLoads++;
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#d1efe7"/><text x="40" y="80">Only the first page</text></svg>',
      });
    });
    // The provider viewer is isolated at its real origin. These are distinct
    // pages in a document, not one long image posing as a multi-page preview.
    await page.route(viewerUrl, (route) => {
      viewerLoads++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body style="margin:0">
        <nav style="position:fixed;top:0;background:white"><output id="current" aria-label="Current page">1</output> / 3
        <button onclick="document.getElementById('page-3').scrollIntoView()">Last page</button></nav>
        <section id="page-1" style="height:1200px;background:#d1efe7">Document page 1</section>
        <section id="page-2" style="height:1200px;background:#ddeaff">Document page 2</section>
        <section id="page-3" style="height:1200px;background:#ffe0b2">Document page 3</section>
        <script>addEventListener('scroll', () => { document.getElementById('current').textContent = String(Math.floor(scrollY / 1200) + 1); });</script>
        </body></html>`,
      });
    });
    await choosePrivate(page);
    const viewer = block(page).locator('iframe');

    await expect(viewer).toHaveAttribute('src', viewerUrl);
    const contents = page.frameLocator(`iframe[src="${viewerUrl}"]`);

    await expect(contents.getByLabel('Current page')).toHaveText('1');
    const outerScroll = await page.evaluate(() => window.scrollY);

    await viewer.hover();
    await page.mouse.wheel(0, 1250);
    await expect(contents.getByLabel('Current page')).toHaveText('2');
    expect(await page.evaluate(() => window.scrollY)).toBe(outerScroll);
    await contents.getByRole('button', { name: 'Last page' }).click();
    await expect(contents.getByLabel('Current page')).toHaveText('3');
    const initialRequests = requests.length;

    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(contents.getByLabel('Current page')).toHaveText('3');
    await block(page).hover();
    await block(page).getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(contents.getByLabel('Current page')).toHaveText('3');
    await viewer.hover();
    await page.mouse.wheel(0, -1100);
    await expect(contents.getByLabel('Current page')).toHaveText('2');
    await page.evaluate(() => document.exitFullscreen());
    expect(viewerLoads).toBe(1);
    expect(thumbnailLoads).toBe(0);
    expect(requests.length).toBe(initialRequests);
  });
}

test('Drive caption preserves each typed character and caret when editing in the middle', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('menuitem', { name: 'Add caption' }).click();
  const caption = page.getByRole('textbox', { name: 'Google Drive caption' });

  await expect(caption).toBeFocused();
  const text = 'My Google Drive caption';

  for (let index = 0; index < text.length; index++) {
    await caption.press(text[index] === ' ' ? 'Space' : text[index]);
    await expect(caption).toHaveValue(text.slice(0, index + 1));
  }

  await caption.press('Home');
  await caption.press('ArrowRight');
  await caption.press('ArrowRight');
  await caption.pressSequentially(' edited', { delay: 40 });
  await expect(caption).toHaveValue('My edited Google Drive caption');
  await expect.poll(() => caption.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(9);
  await caption.press('Backspace');
  await expect(caption).toHaveValue('My edite Google Drive caption');
  await caption.press('Delete');
  await expect(caption).toHaveValue('My editeGoogle Drive caption');
  await expect(page.getByTestId('drive-document-snapshot')).toContainText('My editeGoogle Drive caption');
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await expect(caption).toHaveAttribute('readonly', '');
  await expect(caption).toHaveValue('My editeGoogle Drive caption');
  await page.reload();
  await expect(caption).toHaveValue('My editeGoogle Drive caption');

  // The draft must still follow document changes, including undo and redo.
  await page.getByRole('button', { name: 'Remote edit' }).click();
  await expect(caption).toHaveValue('collaborator');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(caption).toHaveValue('My editeGoogle Drive caption');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(caption).toHaveValue('collaborator');
  await caption.focus();
  await caption.press('End');
  await caption.pressSequentially(' updated caption');
  await expect(caption).toHaveValue('collaborator updated caption');
  await expect(page.getByTestId('drive-document-snapshot')).toContainText('collaborator updated caption');
});

test('Drive caption retains composed text and multiline edits', async ({ page }) => {
  await embed(page);
  await (await more(page)).getByRole('menuitem', { name: 'Add caption' }).click();
  const caption = page.getByRole('textbox', { name: 'Google Drive caption' });
  const input = await page.context().newCDPSession(page);

  await expect(caption).toBeFocused();
  await caption.pressSequentially('My caption');
  await caption.press('Home');
  await caption.press('ArrowRight');
  await caption.press('ArrowRight');
  await caption.press('ArrowRight');
  await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
  await expect(caption).toHaveValue('My nicaption');
  await input.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
  await input.send('Input.insertText', { text: '你好' });
  await expect(caption).toHaveValue('My 你好caption');
  await expect.poll(() => caption.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(5);
  await caption.press('Enter');
  await caption.pressSequentially('second line ');
  await expect(caption).toHaveValue('My 你好\nsecond line caption');
  await input.detach();
  await page.reload();
  await expect(caption).toHaveValue('My 你好\nsecond line caption');
});
