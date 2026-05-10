import { test, expect, type Page } from '@playwright/test';

import {
  AddPageSelectors,
  ChatSelectors,
  DatabaseGridSelectors,
  DropdownSelectors,
  EditorSelectors,
  FieldType,
  GridFieldSelectors,
  HeaderSelectors,
  PageSelectors,
  PropertyMenuSelectors,
  SidebarSelectors,
  SlashCommandSelectors,
  WorkspaceSelectors,
} from '../../support/selectors';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { expandSpace } from '../../support/page/flows';
import { mockServerInfo } from '../../support/server-info-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { loginAndCreateGrid, addNewProperty, editLastProperty, getLastFieldId } from '../../support/field-type-test-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import {
  AIMeetingSelectors,
  areTestUtilitiesAvailable,
  injectAIMeetingBlock,
} from '../../support/ai-meeting-helpers';

async function openFirstPageAddMenu(page: Page) {
  await expandSpace(page);
  const firstPage = PageSelectors.items(page).first();

  await expect(firstPage).toBeVisible({ timeout: 30000 });
  await firstPage.hover({ force: true });
  await page.waitForTimeout(500);

  const inlineAddButton = firstPage.getByTestId('inline-add-page').first();

  await expect(inlineAddButton).toBeVisible({ timeout: 10000 });
  await inlineAddButton.click({ force: true });
  await expect(DropdownSelectors.content(page)).toBeVisible({ timeout: 10000 });
}

test.describe('Server info ai_enabled flag', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('hides AI chat creation and existing AI chat pages when ai_enabled is false', async ({
    page,
    request,
  }) => {
    const serverInfo = await mockServerInfo(page, { ai_enabled: true });
    const testEmail = generateRandomEmail();
    let aiChatViewId = '';

    await test.step('Given a signed-in user with AI enabled', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeAttached({ timeout: 30000 });
    });

    await test.step('And an AI chat page exists', async () => {
      await openFirstPageAddMenu(page);
      await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible({ timeout: 10000 });
      await AddPageSelectors.addAIChatButton(page).click();
      await expect(ChatSelectors.aiChatContainer(page)).toBeVisible({ timeout: 30000 });

      aiChatViewId = new URL(page.url()).pathname.split('/').filter(Boolean).pop() || '';
      expect(aiChatViewId).not.toBe('');
    });

    await test.step('When the server info response disables AI and the app reloads', async () => {
      serverInfo.setServerInfo({ ai_enabled: false });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    });

    await test.step('Then the existing AI chat page is hidden', async () => {
      await expect(ChatSelectors.aiChatContainer(page)).toHaveCount(0);
      await expect(page.getByTestId(`page-${aiChatViewId}`)).toHaveCount(0);
    });

    await test.step('And the Add Page menu no longer offers AI Chat', async () => {
      await openFirstPageAddMenu(page);
      await expect(AddPageSelectors.addAIChatButton(page)).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    await test.step('And AI chat page actions are not available', async () => {
      await expect(HeaderSelectors.moreActionsButton(page)).toHaveCount(0);
      await expect(page.getByText('Add messages to page')).toHaveCount(0);
    });

    await test.step('And the workspace menu no longer offers AI Max', async () => {
      await WorkspaceSelectors.dropdownTrigger(page).click({ force: true });
      await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('upgrade-ai-max-button')).toHaveCount(0);
    });
  });

  test('hides document AI popup, slash menu, and AI meeting regenerate controls when ai_enabled is false', async ({
    page,
    request,
  }) => {
    await mockServerInfo(page, { ai_enabled: false });
    const testEmail = generateRandomEmail();

    await test.step('Given a signed-in user editing a document with AI disabled', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
      await createDocumentPageAndNavigate(page);
      await EditorSelectors.firstEditor(page).click({ force: true });
      await page.waitForTimeout(500);
    });

    await test.step('When text is selected in the document', async () => {
      await page.keyboard.type('Text that should not show AI actions');
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await expect(EditorSelectors.selectionToolbar(page)).toBeVisible({ timeout: 10000 });
    });

    await test.step('Then the selected-text AI popup controls are hidden', async () => {
      await expect(EditorSelectors.boldButton(page)).toBeVisible();
      await expect(page.getByTestId('toolbar-improve-writing-button')).toHaveCount(0);
      await expect(page.getByTestId('toolbar-ask-ai-button')).toHaveCount(0);
    });

    await test.step('When the slash menu is opened', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('/');
      await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible({ timeout: 10000 });
    });

    await test.step('Then AI slash commands are hidden', async () => {
      await expect(page.getByTestId('slash-menu-text')).toBeVisible();
      await expect(page.getByTestId('slash-menu-askAIAnything')).toHaveCount(0);
      await expect(page.getByTestId('slash-menu-continueWriting')).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    await test.step('And AI meeting regenerate controls are hidden', async () => {
      const available = await areTestUtilitiesAvailable(page);

      if (!available) {
        test.skip(true, 'Editor Yjs test utilities are not available in this build');
        return;
      }

      await injectAIMeetingBlock(page, {
        title: 'AI disabled meeting',
        summary: 'Existing summary content.',
        notes: 'Notes for regeneration.',
        speakers: [{ id: 'alice', name: 'Alice', timestamp: 0, content: 'Transcript content.' }],
      });
      await expect(AIMeetingSelectors.block(page)).toBeVisible({ timeout: 15000 });
      await expect(AIMeetingSelectors.regenerateButton(page)).toHaveCount(0);
    });
  });

  test('hides database AI field types and existing AI columns when ai_enabled is false', async ({
    page,
    request,
  }) => {
    const serverInfo = await mockServerInfo(page, { ai_enabled: true });
    const testEmail = generateRandomEmail();
    let aiSummaryFieldId = '';
    let aiTranslateFieldId = '';

    await test.step('Given a grid database with existing AI Summary and AI Translate fields', async () => {
      await loginAndCreateGrid(page, request, testEmail);
      await DatabaseGridSelectors.firstCell(page).click({ force: true });
      await page.keyboard.type('content to summarize');
      await page.keyboard.press('Enter');
      await addNewProperty(page, FieldType.Summary);
      aiSummaryFieldId = await getLastFieldId(page);
      expect(aiSummaryFieldId).not.toBe('');

      const lastFieldIdBeforeAdd = await getLastFieldId(page);

      await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="grid-new-property-button"]');

        if (el) (el as HTMLElement).click();
      });
      await expect.poll(async () => getLastFieldId(page), { timeout: 10000 }).not.toBe(lastFieldIdBeforeAdd);
      await page.keyboard.press('Escape');
      await editLastProperty(page, FieldType.Translate);
      aiTranslateFieldId = await getLastFieldId(page);
      expect(aiTranslateFieldId).not.toBe('');

      const aiCell = DatabaseGridSelectors.dataRowCellsForField(page, aiSummaryFieldId).first();

      await aiCell.scrollIntoViewIfNeeded();
      await aiCell.hover();
      await expect(page.locator(`[data-testid^="ai-generate-button-"][data-testid$="-${aiSummaryFieldId}"]`).first())
        .toBeVisible({ timeout: 10000 });
    });

    await test.step('When the server info response disables AI and the grid reloads', async () => {
      serverInfo.setServerInfo({ ai_enabled: false });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGridReady(page);
    });

    await test.step('Then AI field types are hidden from the property type menu', async () => {
      await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="grid-new-property-button"]');

        if (el) (el as HTMLElement).click();
      });
      await page.waitForTimeout(1200);

      const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).first();

      await expect(trigger).toBeVisible({ timeout: 10000 });
      await trigger.hover();
      await page.waitForTimeout(600);

      await expect(PropertyMenuSelectors.propertyTypeOption(page, FieldType.Summary)).toHaveCount(0);
      await expect(PropertyMenuSelectors.propertyTypeOption(page, FieldType.Translate)).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    await test.step('And existing AI columns are hidden from the grid', async () => {
      await expect(GridFieldSelectors.fieldHeader(page, aiSummaryFieldId)).toHaveCount(0);
      await expect(GridFieldSelectors.fieldHeader(page, aiTranslateFieldId)).toHaveCount(0);
      await expect(DatabaseGridSelectors.dataRowCellsForField(page, aiSummaryFieldId)).toHaveCount(0);
      await expect(DatabaseGridSelectors.dataRowCellsForField(page, aiTranslateFieldId)).toHaveCount(0);
      await expect(page.locator(`[data-testid^="ai-generate-button-"][data-testid$="-${aiSummaryFieldId}"]`)).toHaveCount(0);
      await expect(page.locator(`[data-testid^="ai-generate-button-"][data-testid$="-${aiTranslateFieldId}"]`)).toHaveCount(0);
    });
  });
});
