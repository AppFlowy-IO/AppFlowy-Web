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
  openSharePageInSameContext,
  readRespondentForRowByName,
  readShareUrl,
  selectShareTier,
  signInAddProAndOpenForm,
  signInAndAddFormViewViaTabBar,
  toggleAnonymousSwitch,
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

Given(
  'a Grid with a Form tab is open on a simulated Free workspace',
  async ({ page, request }) => {
    // Intercept the form-share endpoints and return a FeatureNotAvailable
    // envelope so the FE classifier resolves to `plan_required`. The
    // cloud's `is_workspace_on_paid_plan` short-circuits to `Ok(true)`
    // for debug builds (so devs aren't blocked by the gate), which is
    // the intended dev UX but removes the natural testbed for this
    // path. The route-mock restores it for the one scenario that
    // needs to exercise the upgrade-prompt branch.
    await page.route('**/form/share', async (route) => {
      const method = route.request().method();

      if (method === 'GET' || method === 'POST' || method === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 1067,
            message: 'Form share authoring requires a Pro or Team plan',
          }),
        });
        return;
      }

      await route.fallback();
    });
    await signInAndAddFormViewViaTabBar(page, request, generateRandomEmail());
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

// Network spy for the preview-submit regression. Stores requests on the
// Page so the assertion step can read them back after the click. Each
// scenario gets a fresh array (the step initializes it). Without this,
// the preview dialog's Submit button would send a real POST to the
// public-form submit endpoint with the sentinel token "preview",
// which 404s (user-reported in Image #67).
type PreviewSubmitSpy = { calls: string[]; off: () => void };

const previewSubmitSpies = new WeakMap<object, PreviewSubmitSpy>();

When(
  'I record network calls to the public-form submit endpoint',
  async ({ page }) => {
    const calls: string[] = [];
    const listener = (request: import('@playwright/test').Request): void => {
      // The public submit endpoint is `/api/.../public-form/{token}/submit`.
      // Anchor on the path tail so dev/prod hosts don't matter.
      if (
        request.method() === 'POST' &&
        /\/public-form\/[^/]+\/submit(\?|$)/.test(request.url())
      ) {
        calls.push(request.url());
      }
    };

    page.on('request', listener);
    previewSubmitSpies.set(page, {
      calls,
      off: () => page.off('request', listener),
    });
  },
);

When('I submit the form preview', async ({ page }) => {
  const dialog = FormSelectors.previewDialog(page);

  await expect(dialog).toBeVisible({ timeout: 10000 });
  // The preview reuses `FormBody`, which renders the same
  // `public-form-submit` testid as the public route. Scope the click
  // to the dialog so we never hit a stray submit button outside it.
  await dialog.getByTestId('public-form-submit').click();
});

Then('the form preview confirmation is visible', async ({ page }) => {
  const dialog = FormSelectors.previewDialog(page);

  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog.getByTestId('public-form-confirmation')).toBeVisible({
    timeout: 5000,
  });
});

Then('no public-form submit request was sent', async ({ page }) => {
  const spy = previewSubmitSpies.get(page);

  if (!spy) {
    throw new Error(
      'No request spy registered — call "I record network calls to the public-form submit endpoint" first.',
    );
  }
  // Give any in-flight request a beat to land before we assert
  // emptiness — the click already completed but the request handler
  // is async on Playwright's side.
  await page.waitForTimeout(500);
  const sent = spy.calls.slice();

  spy.off();
  previewSubmitSpies.delete(page);
  expect(
    sent,
    'preview-mode submit must not hit /public-form/.../submit',
  ).toEqual([]);
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

// ── Database view tab bar (order regression) ─────────────────────────

Then(
  'the database view tab bar has {int} tabs',
  async ({ page }, expected: number) => {
    // Active assertion (not just count snapshot) so the matcher waits
    // until the new tab actually mounts — the YJS folder update can
    // arrive a frame after the auto-create dialog closes.
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(expected, {
      timeout: 10000,
    });
  },
);

Then(
  'database view tab {int} is a {string} layout',
  async ({ page }, position: number, layout: string) => {
    // 1-based index from the feature file → 0-based locator nth().
    // `viewTab(page)` (no viewId) returns all `[data-testid^="view-tab-"]`
    // anchors, preserving DOM order = visual left-to-right order.
    const tab = DatabaseViewSelectors.viewTab(page).nth(position - 1);

    await expect(tab).toBeVisible({ timeout: 10000 });
    // The tab label is the layout's default name ("Grid" / "Board" /
    // "Form" / "Calendar" / "Chart"). Build a case-insensitive regex
    // anchored on the label so trailing whitespace / icons don't
    // confuse the match.
    await expect(tab).toContainText(new RegExp(layout, 'i'));
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

Then('the share popover surface is not blank', async ({ page }) => {
  // The popover's textContent must contain something human-readable.
  // Regression target: the loading skeleton (image #44) used
  // `bg-fill-content` for the pulsing bars — that token matched the
  // popover's `bg-surface-layer-03` background in dark mode, so the
  // bars rendered invisibly. The testid was present, but the user saw
  // an empty rectangle. This test catches that class of regression by
  // requiring SOME readable text in any of the three branches.
  const text = await page
    .locator('[data-slot="popover-content"]')
    .first()
    .innerText();

  expect(text.replace(/\s+/g, '').length).toBeGreaterThan(0);
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
    // `toHaveAttribute` polls the DOM directly, so it works whether
    // or not the popover is open in front of the banner. Don't dismiss
    // the popover here — downstream steps may need it open to click
    // the next toggle.
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

When(
  'I open the share URL in the same context',
  async ({ page }) => {
    // Same BrowserContext = same cookies = same GoTrue session, so
    // the cloud sees the request as the authoring user. Required for
    // Workspace-tier respondent identification — a fresh-context
    // submission would 401 against the auth_required gate.
    const state = sharedState.get(page);

    if (!state?.capturedUrl) {
      throw new Error('share URL was not captured before opening the tab');
    }

    const respondent = await openSharePageInSameContext(
      page,
      state.capturedUrl,
    );

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

Then('the public form has no question cards', async ({ page }) => {
  const respondent = getRespondent(page);
  // Body still has to be present — the schema rendered, it just has
  // an empty `questions` array. Hard-asserts on `[data-question-kind]`
  // count being zero are stronger than asserting individual kinds
  // because they catch any future question kind that lands without an
  // explicit per-kind selector.
  await expect(PublicFormSelectors.body(respondent)).toBeVisible({
    timeout: 30000,
  });
  await expect(respondent.locator('[data-question-kind]')).toHaveCount(0);
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

When('I click submit another response', async ({ page }) => {
  // The confirmation screen renders "Submit another response" when
  // `schema.allow_another_response` is true (default for our forms).
  // Anchor by visible text — there's only one such button on the
  // confirmation surface.
  const respondent = getRespondent(page);

  await respondent
    .getByRole('button', { name: /Submit another response/i })
    .click();
});

When(
  'I submit the public form {int} times with name prefix {string}',
  async ({ page }, count: number, prefix: string) => {
    // Loop: fill → submit → wait for confirmation → click submit-another
    // → fill again. On iteration N, the form body must be visible
    // (resetSubmitState ran). On the last iteration we stop at the
    // confirmation screen (no extra submit-another click) so subsequent
    // assertions can read the final state.
    const respondent = getRespondent(page);

    for (let i = 1; i <= count; i += 1) {
      const value = `${prefix}${i}`;
      const textQuestion = PublicFormSelectors.questionByKind(respondent, 'text').first();

      await expect(textQuestion).toBeVisible({ timeout: 10000 });
      await textQuestion.locator('input, textarea').first().fill(value);
      await PublicFormSelectors.submitButton(respondent).click();
      await expect(PublicFormSelectors.confirmation(respondent)).toBeVisible({
        timeout: 15000,
      });

      if (i < count) {
        await respondent
          .getByRole('button', { name: /Submit another response/i })
          .click();
        // After clicking, the form body re-mounts. Wait for the next
        // iteration's `toBeVisible` poll to settle on the input.
        await expect(PublicFormSelectors.body(respondent)).toBeVisible({
          timeout: 10000,
        });
      }
    }
  },
);

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

Then(
  'the respondent for the row with name {string} is identified',
  async ({ page }, nameSubstring: string) => {
    // Flip to the Grid tab so the submission row is in the rendered
    // DOM (it lands on the underlying database, not the Form view's
    // projection).
    await DatabaseViewSelectors.viewTab(page).first().click();
    const respondentText = await readRespondentForRowByName(
      page,
      nameSubstring,
    );

    // "Identified" = NOT the anonymous sentinel. We deliberately don't
    // pin the exact display name because the GoTrue profile that
    // signed in is whatever `generateRandomEmail()` produced for this
    // run.
    expect(respondentText).not.toMatch(/^[·\s]*Anonymous[·\s]*$/);
    expect(respondentText.replace(/\s+/g, '').length).toBeGreaterThan(0);
  },
);

Then(
  'the respondent for the row with name {string} is anonymous',
  async ({ page }, nameSubstring: string) => {
    await DatabaseViewSelectors.viewTab(page).first().click();
    const respondentText = await readRespondentForRowByName(
      page,
      nameSubstring,
    );

    // The Person cell renders `·Anonymous` for the nil-UUID sentinel
    // (bullet separator + "Anonymous" label). Strip the bullet/space
    // ornamentation to assert on the bare token.
    expect(respondentText.replace(/[·\s]/g, '')).toBe('Anonymous');
  },
);

// ── Access-level respondent landing states ─────────────────────────

Then(
  'the public form shows the login required prompt',
  async ({ page }) => {
    await expect(
      PublicFormSelectors.authRequiredPage(getRespondent(page)),
    ).toBeVisible({ timeout: 15000 });
  },
);

Then(
  'the public form shows the closed page',
  async ({ page }) => {
    await expect(
      PublicFormSelectors.closedPage(getRespondent(page)),
    ).toBeVisible({ timeout: 15000 });
  },
);

// ── Popover anonymous + submission-access ──────────────────────────

When('I toggle the Anonymous switch', async ({ page }) => {
  await toggleAnonymousSwitch(page);
});

// `toHaveAttribute` polls the DOM regardless of visibility, so the
// popover can stay open while we assert on the banner state — no
// Escape dance needed. (Earlier iteration closed the popover here,
// which broke any subsequent step that needed to click another
// popover row.)
Then(
  'the access banner reports anonymous responses as {string}',
  async ({ page }, value: string) => {
    await expect(FormSelectors.accessBanner(page)).toHaveAttribute(
      'data-anonymous',
      value,
      { timeout: 10000 },
    );
  },
);

Then(
  'the access banner reports submission access as {string}',
  async ({ page }, value: string) => {
    await expect(FormSelectors.accessBanner(page)).toHaveAttribute(
      'data-submission-access',
      value,
      { timeout: 10000 },
    );
  },
);

// ── Files question / Media upload (Phase-2) ────────────────────────

Then('the public form shows the Files question', async ({ page }) => {
  await expect(
    PublicFormSelectors.questionByKind(getRespondent(page), 'files'),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    PublicFormSelectors.mediaUploadButton(getRespondent(page)),
  ).toBeVisible();
});

When(
  'I attach the file {string} with content {string}',
  async ({ page }, name: string, content: string) => {
    // Drive `setInputFiles` on the hidden file input directly — this
    // bypasses the OS file chooser, which Playwright can't dismiss in
    // headless mode on some runners.
    const respondent = getRespondent(page);
    await PublicFormSelectors.mediaFileInput(respondent).setInputFiles({
      name,
      mimeType: inferMime(name),
      buffer: Buffer.from(content, 'utf-8'),
    });
  },
);

When(
  'I attempt to attach a {string} byte file named {string}',
  async ({ page }, sizeStr: string, name: string) => {
    const size = Number.parseInt(sizeStr, 10);
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(`Invalid file size: ${sizeStr}`);
    }
    // A buffer of zeros is fine for the size-cap path — the client
    // rejects before it hits the wire, so the actual content never
    // leaves the page.
    const respondent = getRespondent(page);
    await PublicFormSelectors.mediaFileInput(respondent).setInputFiles({
      name,
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(size),
    });
  },
);

Then(
  'the public form attachments list shows {string} as {string}',
  async ({ page }, name: string, status: string) => {
    const respondent = getRespondent(page);
    const row = PublicFormSelectors.mediaAttachmentByName(respondent, name);
    await expect(row).toBeVisible({ timeout: 30000 });
    // `uploaded` is the post-success terminal state; `uploading` is the
    // in-flight one. Polling `toHaveAttribute` waits out the PUT so we
    // don't race the presigned upload to MinIO.
    await expect(row).toHaveAttribute('data-status', status, {
      timeout: 30000,
    });
  },
);

When(
  'I remove the attachment {string}',
  async ({ page }, name: string) => {
    const respondent = getRespondent(page);
    const row = PublicFormSelectors.mediaAttachmentByName(respondent, name);
    await row.getByRole('button', { name: /Remove attachment/i }).click();
  },
);

Then('the public form attachments list is empty', async ({ page }) => {
  await expect(
    PublicFormSelectors.mediaAttachmentList(getRespondent(page)),
  ).toBeHidden({ timeout: 5000 });
});

function inferMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'txt':
      return 'text/plain';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
