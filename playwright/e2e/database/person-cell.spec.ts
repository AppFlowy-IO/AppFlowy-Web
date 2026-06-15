/**
 * Person Cell E2E Tests
 *
 * Tests basic Person cell interactions:
 * - Creating a Person column
 * - Opening the Person cell menu
 * - Converting Person to RichText and back
 *
 * Migrated from: cypress/e2e/database/person-cell.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  PropertyMenuSelectors,
  GridFieldSelectors,
  PersonSelectors,
  FieldType,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView, waitForGridReady, addPropertyColumn } from '../../support/database-ui-helpers';

test.describe('Person Cell', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should create Person column, open menu, and convert to RichText and back', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a grid database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
    await waitForGridReady(page);

    // When: adding a new Person column
    await addPropertyColumn(page, FieldType.Person);

    // Then: person cells should exist in the DOM (empty cells have zero height)
    await expect(PersonSelectors.allPersonCells(page).first()).toBeAttached({ timeout: 10000 });

    // When: clicking on a Person cell
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="person-cell-"]');
      if (el) (el as HTMLElement).click();
    });
    await page.waitForTimeout(1000);

    // Then: the person cell menu should open with a notify assignee toggle
    await expect(PersonSelectors.personCellMenu(page)).toBeVisible({ timeout: 5000 });
    await expect(PersonSelectors.notifyAssigneeToggle(page)).toBeVisible();

    // When: toggling the notify assignee switch
    await PersonSelectors.notifyAssigneeToggle(page).click({ force: true });
    await page.waitForTimeout(500);

    // And: closing the menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // When: converting the Person column to RichText
    await GridFieldSelectors.allFieldHeaders(page).last().click({ force: true });
    await page.waitForTimeout(1000);

    const editPropertyCount = await PropertyMenuSelectors.editPropertyMenuItem(page).count();
    if (editPropertyCount > 0) {
      await PropertyMenuSelectors.editPropertyMenuItem(page).click();
      await page.waitForTimeout(1000);
    }

    await expect(PropertyMenuSelectors.propertyTypeTrigger(page)).toBeVisible({ timeout: 5000 });
    await PropertyMenuSelectors.propertyTypeTrigger(page).click({ force: true });
    await page.waitForTimeout(500);
    await PropertyMenuSelectors.propertyTypeOption(page, FieldType.RichText).click({ force: true });
    await page.waitForTimeout(2000);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Then: person cells should no longer exist (converted to text)
    await expect(PersonSelectors.allPersonCells(page)).toHaveCount(0);

    // When: converting back to Person
    await GridFieldSelectors.allFieldHeaders(page).last().click({ force: true });
    await page.waitForTimeout(1000);

    const editPropertyCount2 = await PropertyMenuSelectors.editPropertyMenuItem(page).count();
    if (editPropertyCount2 > 0) {
      await PropertyMenuSelectors.editPropertyMenuItem(page).click();
      await page.waitForTimeout(1000);
    }

    await expect(PropertyMenuSelectors.propertyTypeTrigger(page)).toBeVisible({ timeout: 5000 });
    await PropertyMenuSelectors.propertyTypeTrigger(page).click({ force: true });
    await page.waitForTimeout(500);
    await PropertyMenuSelectors.propertyTypeOption(page, FieldType.Person).click({ force: true });
    await page.waitForTimeout(2000);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Then: person cells should exist again
    await expect(PersonSelectors.allPersonCells(page).first()).toBeAttached({ timeout: 10000 });
  });
});
