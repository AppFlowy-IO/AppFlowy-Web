import { expect, test, type Page } from '@playwright/test';

import type { YDoc } from '../../../src/application/types';
import { loginAndCreateGrid } from '../../support/filter-test-helpers';
import { closeRowDetail, getVisibleDataRowIds, openRowDetailByRowId } from '../../support/row-detail-helpers';
import { dragPeekResizer, readPeekWidth } from '../../support/side-peek-helpers';
import { generateRandomEmail } from '../../support/test-config';
import { waitForDatabaseDocReady } from '../../support/yjs-inject-helpers';

async function chooseMode(page: Page, mode: 'side' | 'center') {
  await page.getByTestId('row-peek-mode-menu').click();
  await expect(page.getByTestId('row-default-peek-mode-menu')).toHaveCount(0);
  await page.getByTestId(`row-peek-mode-${mode}`).click();
  await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', mode);
}

async function storedMode(page: Page, rowId: string) {
  return page.evaluate((id) => {
    const doc = (window as Window & { __TEST_DATABASE_DOC__?: YDoc }).__TEST_DATABASE_DOC__;
    const metas = doc?.getMap('data').get('database')?.get('metas');

    return metas?.get(`row_default_peek_mode:${id}`);
  }, rowId);
}

async function storedWidth(page: Page) {
  return page.evaluate(() => new Promise<number | undefined>((resolve, reject) => {
    const request = indexedDB.open('af_database_preferences');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('layout')) {
        db.close();
        resolve(undefined);
        return;
      }

      const transaction = db.transaction('layout', 'readonly');
      const read = transaction.objectStore('layout').get('side_peek_width');

      transaction.oncomplete = () => {
        db.close();
        resolve(read.result?.value);
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error);
      };
    };
  }));
}

test('remembers the resized width across rows and reloads without saving viewport clamping', async ({ page, request }) => {
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await waitForDatabaseDocReady(page);
  const [first, second] = await getVisibleDataRowIds(page);

  await openRowDetailByRowId(page, first);
  await dragPeekResizer(page, -120);
  const savedWidth = await readPeekWidth(page);

  expect(savedWidth).toBe(680);
  await closeRowDetail(page);
  await openRowDetailByRowId(page, second);
  await expect.poll(() => readPeekWidth(page)).toBe(savedWidth);
  await chooseMode(page, 'center');
  await closeRowDetail(page);
  await page.reload();
  await waitForDatabaseDocReady(page);
  await openRowDetailByRowId(page, first);
  await expect.poll(() => readPeekWidth(page)).toBe(savedWidth);
  await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', 'side');
  expect(await storedMode(page, first)).toBeUndefined();

  await page.getByTestId('row-peek-resizer').focus();
  await page.keyboard.press('ArrowLeft');
  const keyboardWidth = savedWidth + 32;

  await expect.poll(() => readPeekWidth(page)).toBe(keyboardWidth);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(() => readPeekWidth(page)).toBeLessThan(keyboardWidth);
  // The browser preference must keep the intentional resize, not the temporary
  // width imposed by the smaller window. This context belongs only to this test.
  await expect.poll(() => storedWidth(page)).toBe(keyboardWidth);
  await closeRowDetail(page);
  await page.reload();
  await waitForDatabaseDocReady(page);
  await openRowDetailByRowId(page, second);
  await expect.poll(() => readPeekWidth(page)).toBeLessThan(keyboardWidth);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => readPeekWidth(page)).toBe(keyboardWidth);
});

test('peek choices are temporary across close, reopen, and reload while row edits persist', async ({ page, request }) => {
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await waitForDatabaseDocReady(page);
  const [first] = await getVisibleDataRowIds(page);

  await openRowDetailByRowId(page, first);
  await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', 'side');
  await page.getByTestId('row-title-input').fill('Keep edits, not peek mode');
  await chooseMode(page, 'center');
  await chooseMode(page, 'side');
  await chooseMode(page, 'center');
  expect(await storedMode(page, first)).toBeUndefined();
  await closeRowDetail(page);
  await openRowDetailByRowId(page, first);
  await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', 'side');
  await expect(page.getByTestId('row-title-input')).toHaveText('Keep edits, not peek mode');
  await chooseMode(page, 'center');
  await closeRowDetail(page);
  await page.reload();
  await waitForDatabaseDocReady(page);
  await openRowDetailByRowId(page, first);
  await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', 'side');
  await expect(page.getByTestId('row-title-input')).toHaveText('Keep edits, not peek mode');
  expect(await storedMode(page, first)).toBeUndefined();
});

test('adjacent-row shortcuts start each row in side peek', async ({ page, request }) => {
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await waitForDatabaseDocReady(page);
  const [first, second] = await getVisibleDataRowIds(page);

  await openRowDetailByRowId(page, second);
  await page.getByTestId('row-title-input').fill('Second row');
  await closeRowDetail(page);
  await openRowDetailByRowId(page, first);
  await page.getByTestId('row-title-input').fill('First row');
  await chooseMode(page, 'center');
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await expect(page.getByTestId('row-title-input')).toHaveText('Second row');
  await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', 'side');
  await chooseMode(page, 'center');
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(page.getByTestId('row-title-input')).toHaveText('First row');
  await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', 'side');
  expect(await storedMode(page, first)).toBeUndefined();
  expect(await storedMode(page, second)).toBeUndefined();
});

test('legacy saved modes are ignored and left untouched', async ({ page, request }) => {
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await waitForDatabaseDocReady(page);
  const [first] = await getVisibleDataRowIds(page);
  const gridUrl = page.url();
  const pagesBefore = page.context().pages().length;

  for (const mode of ['CenterPeek', 'FullPage', 'NewTab']) {
    // This database belongs only to this test's freshly created account.
    await page.evaluate(({ rowId, mode }) => {
      const doc = (window as Window & { __TEST_DATABASE_DOC__?: YDoc }).__TEST_DATABASE_DOC__;
      const metas = doc?.getMap('data').get('database')?.get('metas');

      if (!metas) throw new Error('Database metadata is not ready');
      metas.set(`row_default_peek_mode:${rowId}`, mode);
    }, { rowId: first, mode });
    await openRowDetailByRowId(page, first);
    await expect(page.getByTestId('row-detail')).toHaveAttribute('data-peek-mode', 'side');
    await chooseMode(page, 'center');
    await closeRowDetail(page);
    expect(await storedMode(page, first)).toBe(mode);
    await expect(page).toHaveURL(gridUrl);
    expect(page.context().pages()).toHaveLength(pagesBefore);
  }
});
