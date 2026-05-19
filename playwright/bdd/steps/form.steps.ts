import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  FormFieldType,
  FormFieldTypeName,
  addFormQuestion,
  closeFormPreview,
  openFormPreview,
  signInAndAddFormViewViaTabBar,
} from '../../support/form-test-helpers';
import { FormSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, Before } = createBdd();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1280, height: 720 });
});

// ── Setup ────────────────────────────────────────────────────────────

Given('a Grid with a Form tab is open', async ({ page, request }) => {
  await signInAndAddFormViewViaTabBar(page, request, generateRandomEmail());
});

// ── Toolbar / banner assertions ─────────────────────────────────────

Then('the form preview button is visible', async ({ page }) => {
  await expect(FormSelectors.previewButton(page)).toBeVisible();
});

Then('the form share button is visible', async ({ page }) => {
  await expect(FormSelectors.shareButton(page)).toBeVisible();
});

Then(
  'the form access banner shows the workspace tier',
  async ({ page }) => {
    const banner = FormSelectors.accessBanner(page);

    await expect(banner).toBeVisible();
    // `data-tier` is exposed on the banner so the at-rest tier can be
    // asserted without depending on copy. A freshly-created form has
    // no share token minted yet — `useFormShare.info` is null — so the
    // banner defaults to `workspace` (mirror of the desktop's
    // FormAccessBanner default behaviour).
    await expect(banner).toHaveAttribute('data-tier', 'workspace');
  },
);

// ── Question authoring ──────────────────────────────────────────────

When(
  'I add a {string} question',
  async ({ page }, typeName: string) => {
    if (!(typeName in FormFieldType)) {
      throw new Error(
        `Unknown form question type ${typeName}; valid: ${Object.keys(
          FormFieldType,
        ).join(', ')}`,
      );
    }

    await addFormQuestion(page, typeName as FormFieldTypeName);
  },
);

Then(
  'the form has {int} question card(s)',
  async ({ page }, count: number) => {
    await expect(FormSelectors.questionCards(page)).toHaveCount(count, {
      timeout: 10000,
    });
  },
);

// ── Preview ─────────────────────────────────────────────────────────

When('I open the form preview', async ({ page }) => {
  await openFormPreview(page);
});

When('I close the form preview', async ({ page }) => {
  await closeFormPreview(page);
});

Then('the form preview dialog is visible', async ({ page }) => {
  await expect(FormSelectors.previewDialog(page)).toBeVisible();
});

Then('the form preview dialog is hidden', async ({ page }) => {
  await expect(FormSelectors.previewDialog(page)).toBeHidden();
});
