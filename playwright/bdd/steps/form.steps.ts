import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { Page } from '@playwright/test';

import {
  FormFieldType,
  FormFieldTypeName,
  addFormQuestion,
  addFormViewToTabBarRaw,
  closeFormPreview,
  openFormPreview,
  openSharePopover,
  openSharePageInNewTab,
  readShareUrl,
  selectShareTier,
  signInAddProAndOpenForm,
  signInAndAddFormViewViaTabBar,
  toggleQuestionMenuItem,
  waitForGridRowCount,
} from '../../support/form-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import {
  DatabaseViewSelectors,
  FormSelectors,
  PublicFormSelectors,
} from '../../support/selectors';
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

// ── Question 3-dot menu / per-card state ────────────────────────────

When(
  'I toggle {string} on question {int}',
  async ({ page }, label: string, oneBasedIndex: number) => {
    await toggleQuestionMenuItem(page, oneBasedIndex - 1, label);
  },
);

Then(
  'question {int} is marked required',
  async ({ page }, oneBasedIndex: number) => {
    await expect(
      FormSelectors.questionCardAt(page, oneBasedIndex - 1),
    ).toHaveAttribute('data-required', 'true');
  },
);

Then(
  'question {int} shows the description input',
  async ({ page }, oneBasedIndex: number) => {
    await expect(
      FormSelectors.questionCardAt(page, oneBasedIndex - 1),
    ).toHaveAttribute('data-description-visible', 'true');
  },
);

Then(
  'question {int} uses the long answer body',
  async ({ page }, oneBasedIndex: number) => {
    await expect(
      FormSelectors.questionCardAt(page, oneBasedIndex - 1),
    ).toHaveAttribute('data-long-answer', 'true');
  },
);

// ── Tab-bar auto-create modal (raw variant — no auto-dismiss) ───────

Given('a Grid is open as a starter database', async ({ page, request }) => {
  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
    verify: async (p) => {
      await expect(p.locator('[class*="appflowy-database"]')).toBeVisible({
        timeout: 15000,
      });
      await expect(DatabaseViewSelectors.viewTab(p).first()).toBeVisible({
        timeout: 10000,
      });
    },
  });
});

When(
  'I add a Form view via the tab bar without dismissing modals',
  async ({ page }) => {
    await addFormViewToTabBarRaw(page);
  },
);

Then(
  'the auto-create form questions dialog is visible',
  async ({ page }) => {
    await expect(FormSelectors.autoCreateDialog(page)).toBeVisible({
      timeout: 5000,
    });
  },
);

Then(
  'the auto-create form questions dialog is hidden',
  async ({ page }) => {
    await expect(FormSelectors.autoCreateDialog(page)).toBeHidden({
      timeout: 5000,
    });
  },
);

When(
  'I click start from scratch in the auto-create form questions dialog',
  async ({ page }) => {
    await FormSelectors.autoCreateStartFromScratch(page).click();
  },
);

// ── Share popover ───────────────────────────────────────────────────

Given(
  'a Grid with a Form tab is open on a Pro workspace',
  async ({ page, request }) => {
    await signInAddProAndOpenForm(page, request, generateRandomEmail());
  },
);

When('I open the share popover', async ({ page }) => {
  await openSharePopover(page);
});

Then('the share popover shows the upgrade prompt', async ({ page }) => {
  await expect(FormSelectors.popoverUpgradePrompt(page)).toBeVisible({
    timeout: 10000,
  });
  await expect(FormSelectors.popoverUpgradeCta(page)).toBeVisible();
});

Then(
  'the share popover does not show the loading skeleton',
  async ({ page }) => {
    // Loading skeleton is mutually exclusive with the upgrade prompt;
    // assert non-existence to catch regressions where the skeleton
    // stays mounted forever (image #41).
    await expect(FormSelectors.popoverLoading(page)).toBeHidden();
  },
);

Then('the share popover shows the share controls', async ({ page }) => {
  // The share rows render the "Who can fill out" submenu trigger when
  // `info` is non-null. Anchor on that since it's stable across tiers.
  await expect(
    page.getByRole('button', { name: /Who can fill out/i }),
  ).toBeVisible({ timeout: 15000 });
});

Then('the share URL is non-empty', async ({ page }) => {
  const url = await readShareUrl(page);

  expect(url.length).toBeGreaterThan(0);
});

When(
  'I switch the share tier to {string}',
  async ({ page }, tier: string) => {
    if (tier !== 'workspace' && tier !== 'public' && tier !== 'closed') {
      throw new Error(`Unknown tier ${tier}`);
    }

    await selectShareTier(page, tier as 'workspace' | 'public' | 'closed');
  },
);

Then(
  'the access banner reflects the {string} tier',
  async ({ page }, tier: string) => {
    // Dismiss the popover by clicking the form body so the banner is
    // visible (popover surface anchors at the toolbar; banner sits in
    // the form body).
    await page.keyboard.press('Escape');
    await expect(FormSelectors.accessBanner(page)).toHaveAttribute(
      'data-tier',
      tier,
      { timeout: 10000 },
    );
  },
);

// ── Share-link submission ──────────────────────────────────────────
//
// The respondent tab lives in a separate Playwright `Page` opened on
// the authoring page's `BrowserContext`. We stash both on the world's
// `page` reference via module-scope state — `playwright-bdd` rebuilds
// the context per scenario so this Map never accumulates across runs.

const sharedState = new WeakMap<
  Page,
  { authoringPage: Page; respondentPage?: Page; capturedUrl?: string }
>();

When('I copy the share URL from the popover', async ({ page }) => {
  const url = await readShareUrl(page);

  sharedState.set(page, { authoringPage: page, capturedUrl: url });
});

When(
  'I open the share URL in a fresh anonymous tab',
  async ({ page }) => {
    const state = sharedState.get(page);

    if (!state?.capturedUrl) {
      throw new Error('share URL was not captured before opening the tab');
    }

    const respondent = await openSharePageInNewTab(page, state.capturedUrl);

    sharedState.set(page, { ...state, respondentPage: respondent });
  },
);

function getRespondent(page: Page): Page {
  const r = sharedState.get(page)?.respondentPage;

  if (!r) {
    throw new Error(
      'respondent tab not opened — call `I open the share URL in a fresh anonymous tab` first',
    );
  }
  return r;
}

Then('the public form body is visible', async ({ page }) => {
  await expect(PublicFormSelectors.body(getRespondent(page))).toBeVisible({
    timeout: 30000,
  });
});

When(
  'I fill the first text input with {string}',
  async ({ page }, value: string) => {
    const respondent = getRespondent(page);
    // First text question = first input under any text-kind FormQuestion.
    // Anchor by the kind attribute on the question container so we don't
    // accidentally hit a Number / URL input.
    const textQuestion = PublicFormSelectors.questionByKind(respondent, 'text')
      .first();

    await expect(textQuestion).toBeVisible({ timeout: 10000 });
    await textQuestion.locator('input, textarea').first().fill(value);
  },
);

When('I submit the public form', async ({ page }) => {
  const respondent = getRespondent(page);

  await PublicFormSelectors.submitButton(respondent).click();
});

Then('the public form confirmation page is visible', async ({ page }) => {
  await expect(
    PublicFormSelectors.confirmation(getRespondent(page)),
  ).toBeVisible({ timeout: 15000 });
});

When('I switch back to the authoring tab', async ({ page }) => {
  // The authoring tab is `page` itself — Playwright doesn't auto-focus
  // a new tab the way a browser would, but the WebSocket on `page` is
  // still subscribed. Bring `page` to the front so any focus-gated
  // YJS handlers fire.
  await page.bringToFront();
});

Then(
  'the source grid has at least {int} rows',
  async ({ page }, expected: number) => {
    // Flip to the Grid tab (index 0). Then poll for the new row.
    await DatabaseViewSelectors.viewTab(page).first().click();
    const count = await waitForGridRowCount(page, expected);

    expect(count).toBeGreaterThanOrEqual(expected);
  },
);
