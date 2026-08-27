import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  createNamedGridDatabase,
  createOneWayRelationField,
  createRollupCountFieldDirect,
} from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

interface RowTemplateFixture {
  relationFieldId: string;
  rollupFieldId: string;
  rollupFieldName: string;
  relationFieldName: string;
}

const fixtures = new WeakMap<Page, RowTemplateFixture>();

function fixture(page: Page): RowTemplateFixture {
  const value = fixtures.get(page);

  if (!value) throw new Error('Row template fixture was not prepared for this page.');

  return value;
}

function templateEditor(page: Page) {
  return page.getByTestId('database-template-editor');
}

Given('the RowTemplate test app is initialized', async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ height: 900, width: 1440 });
});

When('the RowTemplate user signs in anonymously', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail());
});

Then('the RowTemplate user sees the home page with get started page', async ({ page }) => {
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
  await expect(page.locator('[data-testid="inline-add-page"], [data-testid="new-page-button"]').first()).toBeVisible({
    timeout: 20_000,
  });
});

When('the user prepares relation and rollup grids for row templates', async ({ page }) => {
  const target = await createNamedGridDatabase(page, 'Template Relation Projects', ['Alpha', 'Beta']);
  const source = await createNamedGridDatabase(page, 'Template Relation Tasks', ['Task seed']);

  expect(source.databaseId).not.toBe(target.databaseId);

  const relationFieldName = 'Linked Project';
  const rollupFieldName = 'Project Count';
  const relationFieldId = await createOneWayRelationField(page, {
    fieldName: relationFieldName,
    relatedDatabaseId: target.databaseId,
  });
  const rollupFieldId = await createRollupCountFieldDirect(page, {
    fieldName: rollupFieldName,
    relationFieldId,
  });

  fixtures.set(page, { relationFieldId, relationFieldName, rollupFieldId, rollupFieldName });
});

When(
  'the user creates a row template named {string} with a relation default to {string}',
  async ({ page }, templateName: string, targetRowName: string) => {
    const { relationFieldName } = fixture(page);

    await page.getByTestId('database-template-menu-trigger').click();
    await expect(page.getByTestId('database-template-menu')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('database-template-create').click();

    const editor = templateEditor(page);

    await expect(editor).toBeVisible({ timeout: 20_000 });

    const title = editor.getByTestId('row-title-input');

    await expect(title).toBeVisible({ timeout: 10_000 });
    await title.fill(templateName);

    // An empty relation property renders its "Add <field>" placeholder;
    // clicking the property opens the real relation picker.
    await editor.getByText(`Add ${relationFieldName}`, { exact: true }).click();

    const unlinkedLabel = page.getByText('Link another row', { exact: true });

    await expect(unlinkedLabel).toBeVisible({ timeout: 15_000 });
    await page
      .getByText(targetRowName, { exact: true })
      .last()
      .click();
  }
);

Then('the template editor shows {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
});

Then('the template editor lists the read-only rollup property', async ({ page }) => {
  const { rollupFieldName } = fixture(page);
  const editor = templateEditor(page);

  await expect(editor.getByText(rollupFieldName, { exact: true })).toBeVisible({ timeout: 10_000 });
  // Rollups are computed, so the template editor must not offer an editable
  // "Add <field>" affordance for them.
  await expect(editor.getByText(`Add ${rollupFieldName}`, { exact: true })).toHaveCount(0);
});

When('the user closes the row template editor dialog', async ({ page }) => {
  // MUI only handles Escape while focus is inside the dialog's focus trap;
  // closing the relation popover can drop focus back to <body>. Re-enter the
  // dialog through its inert banner before sending Escape.
  await page.getByTestId('database-template-editor-banner').click();
  await page.keyboard.press('Escape');
  await expect(templateEditor(page)).toHaveCount(0, { timeout: 15_000 });
});

When('the user creates a row from the row template named {string}', async ({ page }, templateName: string) => {
  await page.getByTestId('database-template-menu-trigger').click();
  const list = page.getByTestId('database-template-list');

  await expect(list).toBeVisible({ timeout: 10_000 });
  await list.getByText(templateName, { exact: true }).click();

  // Creating from a template opens the new row's detail modal.
  await expect(RowDetailSelectors.modal(page).last()).toBeVisible({ timeout: 20_000 });
  await closeRowDetailWithEscape(page);
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15_000 });
});

Then(
  'the newest grid row links {string} with rollup count {string}',
  async ({ page }, targetRowName: string, rollupCount: string) => {
    const { relationFieldId, rollupFieldId } = fixture(page);
    const relationCell = page.locator(`[data-testid^="grid-cell-"][data-testid$="-${relationFieldId}"]`).last();

    await expect(relationCell).toContainText(targetRowName, { timeout: 20_000 });

    const rollupCell = page.locator(`[data-testid^="rollup-cell-"][data-testid$="-${rollupFieldId}"]`).last();

    await expect(rollupCell).toHaveText(rollupCount, { timeout: 20_000 });
  }
);
