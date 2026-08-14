import { expect, Locator, Page, test } from '@playwright/test';

import {
  createNamedGridPage,
  databaseBlocks,
  duplicateCurrentPageViaHeader,
  editFirstGridCell,
  firstGridCellText,
  insertInlineGridViaSlash,
  insertLinkedGridViaSlash,
  insertPageReferenceViaSlash,
  openCopiedPage,
  renameCurrentPage,
} from '../../support/duplicate-test-helpers';
import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { addFieldWithType, clickFieldHeaderById } from '../../support/field-type-helpers';
import { closeRowDetailWithEscape, getVisibleDataRowIds, openRowDetailByRowId } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, DatabaseViewSelectors, FieldType, PropertyMenuSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const TEMPLATE_MENU = 'database-template-menu';
const TEMPLATE_EDITOR = 'database-template-editor';

async function openTemplateMenu(page: Page): Promise<Locator> {
  await page.getByTestId('database-template-menu-trigger').click();
  const menu = page.getByTestId(TEMPLATE_MENU);

  await expect(menu).toBeVisible();
  return menu;
}

async function closeTemplateEditor(page: Page): Promise<void> {
  const editor = page.getByTestId(TEMPLATE_EDITOR);

  if (!(await editor.isVisible().catch(() => false))) return;
  await page.getByRole('dialog', { name: 'Edit database template' }).press('Escape');
  await expect(editor).toBeHidden({ timeout: 15000 });
}

async function createTemplate(page: Page, name: string): Promise<Locator> {
  const menu = await openTemplateMenu(page);

  await menu.getByTestId('database-template-create').click();
  const editor = page.getByTestId(TEMPLATE_EDITOR);

  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.getByTestId('row-title-input').fill(name);
  await expect(editor.getByTestId('row-title-input')).toHaveValue(name);
  return editor;
}

async function openTemplateActions(page: Page, name: string): Promise<void> {
  await openTemplateMenu(page);
  await page.getByLabel(`Actions for ${name}`).click();
}

async function editTemplate(page: Page, name: string): Promise<Locator> {
  await openTemplateActions(page, name);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const editor = page.getByTestId(TEMPLATE_EDITOR);

  await expect(editor).toBeVisible({ timeout: 30000 });
  return editor;
}

async function selectTemplate(page: Page, name: string): Promise<void> {
  const menu = await openTemplateMenu(page);

  await menu.getByText(name, { exact: true }).click();
  await expect(menu).toBeHidden();
}

async function createRowAndGetId(page: Page, create: () => Promise<void>): Promise<string> {
  const before = await getVisibleDataRowIds(page);

  await create();
  let createdId = '';

  await expect
    .poll(
      async () => {
        const after = await getVisibleDataRowIds(page);

        createdId = after.find((rowId) => !before.includes(rowId)) ?? '';
        return createdId;
      },
      { timeout: 30000, message: 'Expected one newly visible database row' }
    )
    .not.toBe('');

  if (
    await page
      .locator('.MuiDialog-paper')
      .last()
      .isVisible()
      .catch(() => false)
  ) {
    await closeRowDetailWithEscape(page);
  }

  return createdId;
}

async function openRowWithDatabaseBlock(page: Page, rowId: string): Promise<{ editor: Locator; block: Locator }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await openRowDetailByRowId(page, rowId);
    const modal = page.locator('.MuiDialog-paper').last();
    const editor = modal.getByTestId('editor-content').first();
    const block = databaseBlocks(editor).first();

    if (await block.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(block.locator('[data-testid^="grid-cell-"]').first()).toBeVisible({ timeout: 30000 });
      await expect(block.locator('[data-testid^="primary-cell-loading-"]')).toHaveCount(0, { timeout: 30000 });
      return { editor, block };
    }

    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(2500);
  }

  throw new Error(`Template-created row ${rowId} never loaded its embedded database`);
}

async function addDatabaseView(page: Page, block: Locator, layout: 'Board' | 'Calendar' | 'Chart' = 'Board') {
  const tabs = block.locator('[data-testid^="view-tab-"]');
  const initialCount = await tabs.count();
  const addViewButton = block.getByTestId('add-view-button');
  const menu = page.locator('[data-slot="dropdown-menu-content"]:visible').last();

  await expect(addViewButton).toBeVisible({ timeout: 30000 });
  await addViewButton.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt++) {
    await addViewButton.click();
    if (
      await menu.waitFor({ state: 'visible', timeout: 3000 }).then(
        () => true,
        () => false
      )
    )
      break;
  }

  await expect(menu).toBeVisible({ timeout: 10000 });
  await menu
    .getByRole('menuitem')
    .filter({ hasText: new RegExp(`^\\s*${layout}\\s*$`) })
    .click({ force: true });
  await expect(tabs).toHaveCount(initialCount + 1, { timeout: 30000 });
  await tabs.first().click({ force: true });
  await expect(block.locator('[data-testid^="grid-cell-"]').first()).toBeVisible({ timeout: 30000 });
}

async function addRootDatabaseView(page: Page, layout: 'Board' | 'Calendar' | 'Chart'): Promise<string> {
  const tabs = DatabaseViewSelectors.viewTab(page);
  const previousIds = new Set(
    (await tabs.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))).filter(
      (id): id is string => Boolean(id)
    )
  );

  await DatabaseViewSelectors.addViewButton(page).scrollIntoViewIfNeeded();
  await DatabaseViewSelectors.addViewButton(page).click();
  const menu = page.locator('[data-slot="dropdown-menu-content"]:visible').last();

  await expect(menu).toBeVisible({ timeout: 10000 });
  await menu.getByRole('menuitem', { name: layout, exact: true }).click();
  let addedTestId = '';

  await expect
    .poll(
      async () => {
        const currentIds = await tabs.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-testid')).filter(Boolean)
        );

        addedTestId = currentIds.find((id) => !previousIds.has(id as string)) ?? '';
        return addedTestId;
      },
      { timeout: 30000, message: `Expected a new ${layout} database view tab` }
    )
    .not.toBe('');

  await expect(page.getByTestId(addedTestId)).toHaveAttribute('data-state', 'active', { timeout: 30000 });
  return addedTestId;
}

async function switchDatabaseView(page: Page, tabTestId: string): Promise<void> {
  const tab = page.getByTestId(tabTestId);

  await tab.click({ force: true });
  await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 30000 });
}

async function createDefaultTemplateRowFromView(
  page: Page,
  gridTabTestId: string,
  sourceTabTestId: string
): Promise<string> {
  await switchDatabaseView(page, gridTabTestId);
  await waitForGridReady(page);
  const before = await getVisibleDataRowIds(page);

  await switchDatabaseView(page, sourceTabTestId);
  const newButton = page.getByTestId('database-new-row-button');

  await expect(newButton).toBeVisible({ timeout: 30000 });
  await newButton.click();
  const rowDialog = page.locator('.MuiDialog-paper').last();

  await expect(rowDialog).toBeVisible({ timeout: 60000 });
  await closeRowDetailWithEscape(page);
  await switchDatabaseView(page, gridTabTestId);
  await waitForGridReady(page);
  let createdId = '';

  await expect
    .poll(
      async () => {
        createdId = (await getVisibleDataRowIds(page)).find((rowId) => !before.includes(rowId)) ?? '';
        return createdId;
      },
      { timeout: 30000, message: `Expected a templated row created from ${sourceTabTestId}` }
    )
    .not.toBe('');
  await expect(page.getByTestId(`row-document-icon-${createdId}`).first()).toBeVisible({ timeout: 30000 });

  return createdId;
}

async function expectDatabaseBlockViews(block: Locator, expectedCount: number): Promise<void> {
  await expect(block.locator('[data-testid^="view-tab-"]')).toHaveCount(expectedCount, { timeout: 30000 });
}

async function addTemplateEmoji(page: Page, editor: Locator): Promise<string> {
  await editor.getByTestId('row-title-input').hover();
  const addIcon = editor.getByTestId('add-icon-button');

  await expect(addIcon).toBeVisible();
  await addIcon.click();
  await page.getByTestId('icon-popover-tab-emoji').click();
  const emojiButton = page.locator('.emoji-picker button.text-xl').first();

  await expect(emojiButton).toBeVisible({ timeout: 15000 });
  const emoji = (await emojiButton.textContent())?.trim() ?? '';

  expect(emoji).not.toBe('');
  await emojiButton.click();
  await expect(editor.getByText(emoji, { exact: true }).first()).toBeVisible();
  return emoji;
}

async function addTemplateCover(editor: Locator): Promise<void> {
  await editor.getByTestId('row-title-input').hover();
  const addCover = editor.getByRole('button', { name: 'Add Cover', exact: true });

  await expect(addCover).toBeVisible();
  await addCover.click();
  await expect(editor.locator('.row-header-cover img')).toBeVisible({ timeout: 15000 });
}

async function setDefaultTemplate(page: Page, name: string): Promise<void> {
  await openTemplateActions(page, name);
  await page.getByRole('menuitem', { name: 'Set as default', exact: true }).click();
}

async function expectRowCover(page: Page, rowId: string): Promise<void> {
  await openRowDetailByRowId(page, rowId);
  const rowDialog = page.locator('.MuiDialog-paper').last();

  await expect(rowDialog.locator('.row-header-cover img')).toBeVisible({ timeout: 15000 });
  await closeRowDetailWithEscape(page);
}

test.describe('Database row templates (Desktop parity)', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      (window as Window & { Cypress?: boolean }).Cypress = true;
    });
  });

  test('CRUD, direct/default creation, reload, and database duplication preserve templates', async ({
    page,
    request,
  }) => {
    test.setTimeout(300000);
    const email = generateRandomEmail();
    const databaseName = `Template CRUD ${Date.now()}`;
    const originalName = 'Bug report';
    const renamed = 'Issue template';

    await signInAndCreateDatabaseView(page, request, email, 'Grid', {
      createWaitMs: 6000,
      verify: waitForGridReady,
    });
    await renameCurrentPage(page, databaseName);

    const initialMenu = await openTemplateMenu(page);

    await expect(initialMenu.getByText('No templates yet')).toBeVisible();
    const splitButtonBox = await page.getByTestId('database-template-split-button').boundingBox();
    const initialMenuSize = await initialMenu.evaluate((element) => {
      const style = getComputedStyle(element);

      return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
    });
    const headerStyle = await initialMenu.getByText('Templates for Grid').evaluate((element) => {
      const style = getComputedStyle(element);

      return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
    });
    const emptyLineHeight = await initialMenu
      .getByText('No templates yet')
      .evaluate((element) => getComputedStyle(element).lineHeight);
    const footerLineHeight = await initialMenu
      .getByText('New template', { exact: true })
      .evaluate((element) => getComputedStyle(element).lineHeight);

    expect(splitButtonBox?.height).toBe(28);
    expect(initialMenuSize.width).toBe(300);
    expect(initialMenuSize.height).toBeGreaterThanOrEqual(126);
    expect(initialMenuSize.height).toBeLessThanOrEqual(130);
    expect(headerStyle).toEqual({ fontSize: '12px', fontWeight: '500', lineHeight: '14px' });
    expect(emptyLineHeight).toBe('16px');
    expect(footerLineHeight).toBe('16px');
    await page.keyboard.press('Escape');

    const editor = await createTemplate(page, originalName);

    await expect(editor.getByTestId('database-template-editor-banner')).toHaveText("You're editing a template in Grid");
    await expect(editor.locator('.row-properties')).toBeVisible();
    await expect(editor.getByText('New property', { exact: true })).toHaveCount(0);
    const editorBox = await editor.boundingBox();
    const titleStyle = await editor.getByTestId('row-title-input').evaluate((element) => {
      const style = getComputedStyle(element);

      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    });

    expect(editorBox?.width).toBeGreaterThanOrEqual(1000);
    expect(editorBox?.width).toBeLessThanOrEqual(1010);
    expect(editorBox?.height).toBeGreaterThanOrEqual(625);
    expect(editorBox?.height).toBeLessThanOrEqual(635);
    expect(titleStyle.fontSize).toBe('28px');
    expect(['400', 'normal']).toContain(titleStyle.fontWeight);
    await closeTemplateEditor(page);

    const reopened = await editTemplate(page, originalName);

    await reopened.getByTestId('row-title-input').fill(renamed);
    await closeTemplateEditor(page);

    await openTemplateActions(page, renamed);
    await page.getByRole('menuitem', { name: 'Set as default', exact: true }).click();

    const directRowId = await createRowAndGetId(page, () => selectTemplate(page, renamed));

    await expect(DatabaseGridSelectors.rowById(page, directRowId)).toContainText(renamed);

    const defaultRowId = await createRowAndGetId(page, async () => {
      await page.getByTestId('database-new-row-button').click();
    });

    await expect(DatabaseGridSelectors.rowById(page, defaultRowId)).toContainText(renamed);

    await openTemplateActions(page, renamed);
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    const duplicateMenu = await openTemplateMenu(page);

    await expect(duplicateMenu.getByText(`${renamed} (Copy)`, { exact: true })).toBeVisible();
    await duplicateMenu.getByRole('button', { name: `Reorder ${renamed} (Copy)` }).press('ArrowUp');
    const reorderedMenu = page.getByTestId(TEMPLATE_MENU);
    const originalBox = await reorderedMenu.getByText(renamed, { exact: true }).boundingBox();
    const copyBox = await reorderedMenu.getByText(`${renamed} (Copy)`, { exact: true }).boundingBox();

    expect(copyBox?.y).toBeLessThan(originalBox?.y ?? Number.POSITIVE_INFINITY);
    await page.keyboard.press('Escape');

    await openTemplateActions(page, `${renamed} (Copy)`);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(page.getByTestId('database-template-delete-dialog')).toBeVisible();
    await page.getByTestId('database-template-delete-confirm').click();
    const afterDeleteMenu = await openTemplateMenu(page);

    await expect(afterDeleteMenu.getByText(`${renamed} (Copy)`, { exact: true })).toHaveCount(0);
    await expect(afterDeleteMenu.getByText('Default', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGridReady(page);
    const persistedMenu = await openTemplateMenu(page);

    await expect(persistedMenu.getByText(renamed, { exact: true })).toBeVisible();
    await expect(persistedMenu.getByText('Default', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    const nestedEditor = await editTemplate(page, renamed);
    const nestedDocumentEditor = nestedEditor.getByTestId('editor-content').first();
    const nestedDocumentId = (await nestedDocumentEditor.getAttribute('id'))?.replace('editor-', '');

    expect(nestedDocumentId).toBeTruthy();
    await insertInlineGridViaSlash(page, nestedDocumentId as string);
    const nestedBlock = databaseBlocks(nestedDocumentEditor).first();

    await addDatabaseView(page, nestedBlock, 'Board');
    await addDatabaseView(page, nestedBlock, 'Calendar');
    await addDatabaseView(page, nestedBlock, 'Chart');
    await expectDatabaseBlockViews(nestedBlock, 4);
    await closeTemplateEditor(page);
    await page.waitForTimeout(3000);

    const copiesBefore = await page
      .locator('[data-testid="page-name"]:visible')
      .filter({ hasText: new RegExp(`${databaseName} \\(Copy\\)$`) })
      .count();

    await duplicateCurrentPageViaHeader(page);
    await openCopiedPage(page, databaseName, copiesBefore);
    await waitForGridReady(page);
    const copiedMenu = await openTemplateMenu(page);

    await expect(copiedMenu.getByText(renamed, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const copiedRowId = await createRowAndGetId(page, () => selectTemplate(page, renamed));
    const copiedRow = await openRowWithDatabaseBlock(page, copiedRowId);

    await expectDatabaseBlockViews(copiedRow.block, 4);
    await closeRowDetailWithEscape(page);
  });

  test('template properties persist values and follow field additions and deletions', async ({ page, request }) => {
    test.setTimeout(240000);
    const templateName = 'Property defaults';

    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
      createWaitMs: 6000,
      verify: waitForGridReady,
    });
    const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
    let editor = await createTemplate(page, templateName);
    const templateCheckbox = editor.locator(`[data-testid^="checkbox-cell-"][data-testid$="-${checkboxFieldId}"]`);

    await expect(templateCheckbox).toBeVisible({ timeout: 15000 });
    await templateCheckbox.click({ force: true });
    await expect(templateCheckbox.getByTestId('checkbox-checked-icon')).toBeVisible();
    await page.waitForTimeout(500);
    await closeTemplateEditor(page);

    editor = await editTemplate(page, templateName);
    await expect(
      editor
        .locator(`[data-testid^="checkbox-cell-"][data-testid$="-${checkboxFieldId}"]`)
        .getByTestId('checkbox-checked-icon')
    ).toBeVisible();
    await closeTemplateEditor(page);

    const addedFieldId = await addFieldWithType(page, FieldType.Number);
    const addedFieldHeader = page.getByTestId(`grid-field-header-${addedFieldId}`).last();
    const addedFieldName = (await addedFieldHeader.innerText()).trim();

    expect(addedFieldName).not.toBe('');
    editor = await editTemplate(page, templateName);
    await expect(editor.getByText(addedFieldName, { exact: true })).toBeVisible({ timeout: 15000 });
    await closeTemplateEditor(page);

    await clickFieldHeaderById(page, addedFieldId);
    await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });
    const propertyMenu = page.locator('[data-slot="dropdown-menu-content"]:visible').last();

    await propertyMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click({ force: true });
    const deleteDialog = page.getByRole('dialog').last();

    await expect(deleteDialog).toBeVisible({ timeout: 10000 });
    await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByTestId(`grid-field-header-${addedFieldId}`)).toHaveCount(0, { timeout: 15000 });

    const rowId = await createRowAndGetId(page, () => selectTemplate(page, templateName));
    const rowCheckbox = DatabaseGridSelectors.cellByIds(page, rowId, checkboxFieldId);

    await expect(rowCheckbox.getByTestId('checkbox-checked-icon')).toBeVisible({ timeout: 15000 });
    editor = await editTemplate(page, templateName);
    await expect(editor.getByText(addedFieldName, { exact: true })).toHaveCount(0);
    await expect(
      editor
        .locator(`[data-testid^="checkbox-cell-"][data-testid$="-${checkboxFieldId}"]`)
        .getByTestId('checkbox-checked-icon')
    ).toBeVisible();
  });

  test('the default template applies from the top-right New button in every supported database view', async ({
    page,
    request,
  }) => {
    test.setTimeout(360000);
    const templateName = 'Multi-view default template';

    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
      createWaitMs: 6000,
      verify: waitForGridReady,
    });
    const gridTab = DatabaseViewSelectors.activeViewTab(page);
    const gridTabTestId = await gridTab.getAttribute('data-testid');

    expect(gridTabTestId).toBeTruthy();
    const editor = await createTemplate(page, templateName);
    const documentEditor = editor.getByTestId('editor-content').first();

    await expect(documentEditor).toBeVisible({ timeout: 30000 });
    await documentEditor.click();
    await page.keyboard.type('Template content for every supported view');
    await closeTemplateEditor(page);
    await setDefaultTemplate(page, templateName);

    const boardTabTestId = await addRootDatabaseView(page, 'Board');

    await switchDatabaseView(page, gridTabTestId as string);
    const calendarTabTestId = await addRootDatabaseView(page, 'Calendar');

    await switchDatabaseView(page, gridTabTestId as string);
    const chartTabTestId = await addRootDatabaseView(page, 'Chart');

    const createdRows: string[] = [];

    for (const tabTestId of [gridTabTestId as string, boardTabTestId, calendarTabTestId, chartTabTestId]) {
      createdRows.push(await createDefaultTemplateRowFromView(page, gridTabTestId as string, tabTestId));
    }

    expect(new Set(createdRows).size).toBe(4);
  });

  test('default templates preserve icon-only, icon-and-cover, and cover-only row metadata after reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(300000);

    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
      createWaitMs: 6000,
      verify: waitForGridReady,
    });

    const iconOnlyName = 'Template icon only';
    const iconOnlyEditor = await createTemplate(page, iconOnlyName);
    const iconOnlyEmoji = await addTemplateEmoji(page, iconOnlyEditor);

    await closeTemplateEditor(page);
    await setDefaultTemplate(page, iconOnlyName);
    const iconOnlyRowId = await createRowAndGetId(page, async () => {
      await page.getByTestId('database-new-row-button').click();
    });
    const iconOnlyRow = DatabaseGridSelectors.rowById(page, iconOnlyRowId);

    await expect(iconOnlyRow.locator('.custom-icon')).toContainText(iconOnlyEmoji);
    await expect(page.getByTestId(`row-document-icon-${iconOnlyRowId}`)).toHaveCount(0);

    const iconCoverName = 'Template icon cover';
    const iconCoverEditor = await createTemplate(page, iconCoverName);
    const iconCoverEmoji = await addTemplateEmoji(page, iconCoverEditor);

    await addTemplateCover(iconCoverEditor);
    await closeTemplateEditor(page);
    await setDefaultTemplate(page, iconCoverName);
    const iconCoverRowId = await createRowAndGetId(page, async () => {
      await page.getByTestId('database-new-row-button').click();
    });
    const iconCoverRow = DatabaseGridSelectors.rowById(page, iconCoverRowId);

    await expect(iconCoverRow.locator('.custom-icon')).toContainText(iconCoverEmoji);
    await expect(page.getByTestId(`row-document-icon-${iconCoverRowId}`)).toHaveCount(0);
    await expectRowCover(page, iconCoverRowId);

    const coverOnlyName = 'Template cover only';
    const coverOnlyEditor = await createTemplate(page, coverOnlyName);

    await addTemplateCover(coverOnlyEditor);
    await closeTemplateEditor(page);
    await setDefaultTemplate(page, coverOnlyName);
    const coverOnlyRowId = await createRowAndGetId(page, async () => {
      await page.getByTestId('database-new-row-button').click();
    });
    const coverOnlyRow = DatabaseGridSelectors.rowById(page, coverOnlyRowId);

    await expect(coverOnlyRow.locator('.custom-icon')).toHaveCount(0);
    await expect(page.getByTestId(`row-document-icon-${coverOnlyRowId}`)).toHaveCount(0);
    await expectRowCover(page, coverOnlyRowId);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGridReady(page);
    await expect(DatabaseGridSelectors.rowById(page, iconOnlyRowId).locator('.custom-icon')).toContainText(
      iconOnlyEmoji
    );
    await expect(DatabaseGridSelectors.rowById(page, iconCoverRowId).locator('.custom-icon')).toContainText(
      iconCoverEmoji
    );
    await expect(DatabaseGridSelectors.rowById(page, coverOnlyRowId).locator('.custom-icon')).toHaveCount(0);
    for (const rowId of [iconOnlyRowId, iconCoverRowId, coverOnlyRowId]) {
      await expect(page.getByTestId(`row-document-icon-${rowId}`)).toHaveCount(0);
    }
  });

  test('inline databases are restored off-outline and deep-copied independently', async ({ page, request }) => {
    test.setTimeout(360000);
    const name = 'Template with inline database';
    const copyName = `${name} (Copy)`;
    const referenceName = `Template reference ${Date.now()}`;
    const targetName = `Inline template target ${Date.now()}`;

    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
      createWaitMs: 6000,
      verify: waitForGridReady,
    });
    await renameCurrentPage(page, referenceName);
    await createNamedGridPage(page, targetName);
    const editor = await createTemplate(page, name);
    const documentEditor = editor.getByTestId('editor-content').first();

    await expect(documentEditor).toBeVisible({ timeout: 30000 });
    const documentId = (await documentEditor.getAttribute('id'))?.replace('editor-', '');

    expect(documentId).toBeTruthy();
    await documentEditor.click();
    await page.keyboard.type('Template document body');
    await page.keyboard.press('Enter');
    await insertInlineGridViaSlash(page, documentId as string);
    const templateBlock = databaseBlocks(documentEditor).first();

    await addDatabaseView(page, templateBlock, 'Board');
    await expectDatabaseBlockViews(templateBlock, 2);
    await insertPageReferenceViaSlash(page, documentId as string, referenceName, 1);
    await closeTemplateEditor(page);
    await page.waitForTimeout(3000);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGridReady(page);
    await expect(
      page.locator('[data-testid="page-name"]:visible').filter({ hasText: new RegExp(`^${name}$`) })
    ).toHaveCount(0);

    for (let attempt = 0; attempt < 2; attempt++) {
      const reopened = await editTemplate(page, name);
      const reopenedDocument = reopened.getByTestId('editor-content').first();
      const reopenedBlock = databaseBlocks(reopenedDocument).first();

      await expect(databaseBlocks(reopenedDocument)).toHaveCount(1, { timeout: 30000 });
      await expectDatabaseBlockViews(reopenedBlock, 2);
      await expect(reopenedDocument).toContainText('Template document body');
      await expect(reopenedDocument).toContainText(referenceName);
      await closeTemplateEditor(page);
    }

    await openTemplateActions(page, name);
    await page.getByRole('menuitem', { name: 'Set as default', exact: true }).click();
    const defaultRowIds: string[] = [];

    for (let index = 0; index < 2; index++) {
      defaultRowIds.push(
        await createRowAndGetId(page, async () => {
          await page.getByTestId('database-new-row-button').click();
        })
      );
    }

    for (const rowId of defaultRowIds) {
      await expect(page.getByTestId(`row-document-icon-${rowId}`).first()).toBeVisible({ timeout: 30000 });
    }

    const directRowId = await createRowAndGetId(page, () => selectTemplate(page, name));

    await expect(page.getByTestId(`row-document-icon-${directRowId}`).first()).toBeVisible({ timeout: 30000 });
    const direct = await openRowWithDatabaseBlock(page, directRowId);

    await expectDatabaseBlockViews(direct.block, 2);
    await expect(direct.editor).toContainText('Template document body');
    await expect(direct.editor).toContainText(referenceName);
    await closeRowDetailWithEscape(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGridReady(page);
    for (const rowId of [...defaultRowIds, directRowId]) {
      await expect(page.getByTestId(`row-document-icon-${rowId}`).first()).toBeVisible({ timeout: 30000 });
    }

    await openTemplateActions(page, name);
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    const duplicatedMenu = await openTemplateMenu(page);

    await expect(duplicatedMenu.getByText(copyName, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const copiedRowIds: string[] = [];

    for (let index = 0; index < 3; index++) {
      copiedRowIds.push(await createRowAndGetId(page, () => selectTemplate(page, copyName)));
    }

    for (const rowId of copiedRowIds) {
      await expect(page.getByTestId(`row-document-icon-${rowId}`).first()).toBeVisible({ timeout: 30000 });
    }

    const first = await openRowWithDatabaseBlock(page, copiedRowIds[0]);

    await expectDatabaseBlockViews(first.block, 2);
    await expect(first.editor).toContainText('Template document body');
    await expect(first.editor).toContainText(referenceName);
    await editFirstGridCell(page, first.block, 'only the first copy');
    await closeRowDetailWithEscape(page);

    const second = await openRowWithDatabaseBlock(page, copiedRowIds[1]);

    await expectDatabaseBlockViews(second.block, 2);
    await expect(second.editor).toContainText('Template document body');
    await expect(second.editor).toContainText(referenceName);
    expect(await firstGridCellText(second.block)).not.toBe('only the first copy');
    await closeRowDetailWithEscape(page);

    const third = await openRowWithDatabaseBlock(page, copiedRowIds[2]);

    await expectDatabaseBlockViews(third.block, 2);
    await expect(third.editor).toContainText(referenceName);
    expect(await firstGridCellText(third.block)).not.toBe('only the first copy');
    await closeRowDetailWithEscape(page);

    await openTemplateActions(page, copyName);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByTestId('database-template-delete-confirm').click();
    const surviving = await openRowWithDatabaseBlock(page, copiedRowIds[0]);

    await expect(surviving.block).toBeVisible();
    await expectDatabaseBlockViews(surviving.block, 2);
    await expect(surviving.editor).toContainText(referenceName);
  });

  test('linked databases stay shared after the source template is deleted', async ({ page, request }) => {
    test.setTimeout(360000);
    const sourceName = `Template Linked Source ${Date.now()}`;
    const targetName = `Template Linked Target ${Date.now()}`;
    const templateName = 'Template with linked database';
    const copyName = `${templateName} (Copy)`;

    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
      createWaitMs: 6000,
      verify: waitForGridReady,
    });
    await createNamedGridPage(page, sourceName);
    await createNamedGridPage(page, targetName);

    const editor = await createTemplate(page, templateName);
    const documentEditor = editor.getByTestId('editor-content').first();

    await expect(documentEditor).toBeVisible({ timeout: 30000 });
    const documentId = (await documentEditor.getAttribute('id'))?.replace('editor-', '');

    expect(documentId).toBeTruthy();
    await insertLinkedGridViaSlash(page, documentId as string, sourceName);
    const templateBlock = databaseBlocks(documentEditor).first();

    await addDatabaseView(page, templateBlock, 'Board');
    await expectDatabaseBlockViews(templateBlock, 2);
    await insertPageReferenceViaSlash(page, documentId as string, sourceName, 1);
    await closeTemplateEditor(page);

    await openTemplateActions(page, templateName);
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    const duplicatedMenu = await openTemplateMenu(page);

    await expect(duplicatedMenu.getByText(copyName, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const rowIds: string[] = [];

    for (let index = 0; index < 3; index++) {
      rowIds.push(await createRowAndGetId(page, () => selectTemplate(page, copyName)));
    }

    const first = await openRowWithDatabaseBlock(page, rowIds[0]);

    await expectDatabaseBlockViews(first.block, 2);
    await expect(first.editor).toContainText(sourceName);
    await editFirstGridCell(page, first.block, 'shared linked value');
    await closeRowDetailWithEscape(page);

    const second = await openRowWithDatabaseBlock(page, rowIds[1]);

    await expectDatabaseBlockViews(second.block, 2);
    await expect(second.editor).toContainText(sourceName);
    await expect.poll(() => firstGridCellText(second.block), { timeout: 30000 }).toBe('shared linked value');
    await closeRowDetailWithEscape(page);

    const third = await openRowWithDatabaseBlock(page, rowIds[2]);

    await expectDatabaseBlockViews(third.block, 2);
    await expect(third.editor).toContainText(sourceName);
    await expect.poll(() => firstGridCellText(third.block), { timeout: 30000 }).toBe('shared linked value');
    await closeRowDetailWithEscape(page);

    await openTemplateActions(page, copyName);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByTestId('database-template-delete-confirm').click();
    const surviving = await openRowWithDatabaseBlock(page, rowIds[1]);

    await expectDatabaseBlockViews(surviving.block, 2);
    await expect(surviving.editor).toContainText(sourceName);
    await expect.poll(() => firstGridCellText(surviving.block), { timeout: 30000 }).toBe('shared linked value');
  });
});
