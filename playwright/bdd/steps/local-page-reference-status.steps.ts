import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { createBdd, type DataTable } from 'playwright-bdd';

import { installPageReferenceNetworkFault } from '../../support/page-reference-network-fault';

const { Given, When, Then, After } = createBdd();

// Stable IDs from the user-requested localhost fixture. This suite never seeds,
// repairs, or cleans up fixture data; a changed fixture must fail the assertions.
const workspaceId = '997c87ed-1667-4a62-8c0a-a74ee1aadb4b';
const sharedPath = `/app/${workspaceId}/ca6b24a4-3e7b-4310-984c-e8e0bc412868`;
const referenceIds = {
  restricted: '534e2829-2c89-4360-a61c-aac3e6f9d93b',
  trashed: '8e43b398-a623-4f83-95e0-a2bcfa8b593c',
  missing: '7623c910-9e53-4a64-b3ae-279829f9a04a',
} as const;
const accounts = { Nathan: 'nathan@appflowy.io', Annie: 'annie@appflowy.io' } as const;

type Viewer = keyof typeof accounts;
type Reference = keyof typeof referenceIds;
type LabelExpectation = { viewer: Viewer; reference: Reference; label: string };
type State = {
  viewers: Record<Viewer, Page>;
  memberContext: BrowserContext;
  labels: LabelExpectation[];
  failureContext?: BrowserContext;
  failurePage?: Page;
  failure?: Awaited<ReturnType<typeof installPageReferenceNetworkFault>>;
};

const states = new WeakMap<Page, State>();

function stateFor(page: Page): State {
  const state = states.get(page);

  if (!state) throw new Error('Open the local Nathan/Annie reference fixture first');
  return state;
}

function referenceElement(page: Page, reference: Reference) {
  // Scope to the actual mention, not the nearby prose describing expected labels.
  return page.getByTestId('editor-content').locator(`[data-mention-id="${referenceIds[reference]}"]`);
}

async function hoverReferencePopup(page: Page, reference: Reference, label: string) {
  await referenceElement(page, reference).getByRole('button', { name: label, exact: true }).hover();
  const popup = page.getByRole('dialog', { name: label, exact: true });

  await expect(popup).toBeVisible();
  await expectSharedPage(page);
  // Moving from the inline label into the portaled popup must keep its actions
  // reachable; a click-only popup cannot satisfy this interaction.
  await popup.hover();
  await expect(popup).toBeVisible();
  return popup;
}

async function capturePopup(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);

  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
}

async function expectSharedPage(page: Page) {
  await expect(page).toHaveURL(new URL(sharedPath, page.url()).href, { timeout: 30000 });
  await expect(page.getByTestId('current-workspace-name')).toHaveText('nathan workspace');
  await expect(page.getByTestId('page-title-input')).toHaveText('Reference states - Nathan and Annie');
  await expect(page.getByTestId('editor-content')).toBeVisible({ timeout: 30000 });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`/login?redirectTo=${encodeURIComponent(sharedPath)}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-email-input').fill(email);
  await page.getByTestId('login-password-button').click();
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('password-submit-button').click();
  await expectSharedPage(page);

  // Verify identity through the same visible account UI used in the manual run.
  await page.getByTestId('workspace-dropdown-trigger').click();
  await page.getByTestId('settings-button').click();
  const settings = page.getByRole('dialog');

  await expect(settings.getByText(email, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
}

async function expectLabels(state: State, testInfo: TestInfo, checkpoint: string) {
  for (const { viewer, reference, label } of state.labels) {
    const element = referenceElement(state.viewers[viewer], reference);

    await expect(element, `${viewer}'s ${reference} reference must exist exactly once`).toHaveCount(1);
    await expect(element).toBeVisible();
    await expect(element).toHaveText(label);
  }

  for (const viewer of Object.keys(accounts) as Viewer[]) {
    const screenshotPath = testInfo.outputPath(`${checkpoint}-${viewer}.png`);

    await state.viewers[viewer].getByRole('main').screenshot({ path: screenshotPath });
    await testInfo.attach(`${checkpoint}-${viewer}`, {
      path: screenshotPath,
      contentType: 'image/png',
    });
  }
}

Given(
  'Nathan and Annie open the existing local reference page in separate signed-in sessions',
  async ({ page, browser, baseURL }) => {
    if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
      throw new Error('The existing Ref Pages Test fixture requires a localhost BASE_URL');
    }

    const password = process.env.REF_PAGES_TEST_PASSWORD;

    if (!password) throw new Error('Set REF_PAGES_TEST_PASSWORD to the shared local test-account password');
    const memberContext = await browser.newContext({
      baseURL,
      locale: 'en-US',
      viewport: { width: 1440, height: 900 },
      storageState: { cookies: [], origins: [] },
    });
    const memberPage = await memberContext.newPage();
    const state: State = { viewers: { Nathan: page, Annie: memberPage }, memberContext, labels: [] };

    states.set(page, state);
    expect(page.context()).not.toBe(memberContext);
    await signIn(page, accounts.Nathan, password);
    await signIn(memberPage, accounts.Annie, password);
  }
);

Then('the existing reference elements show these labels', async ({ page, $testInfo }, table: DataTable) => {
  const state = stateFor(page);

  state.labels = table.hashes().map(({ viewer, reference, label }) => {
    if (!(viewer in accounts) || !(reference in referenceIds) || !label) {
      throw new Error(`Unknown reference expectation: ${viewer}, ${reference}, ${label}`);
    }

    return { viewer: viewer as Viewer, reference: reference as Reference, label };
  });
  expect(state.labels).toHaveLength(6);
  await expectLabels(state, $testInfo, 'initial');
});

When('both viewers reload the existing reference page', async ({ page }) => {
  for (const viewerPage of Object.values(stateFor(page).viewers)) {
    await viewerPage.reload({ waitUntil: 'domcontentloaded' });
    await expectSharedPage(viewerPage);
  }
});

Then('the same reference labels are still visible', async ({ page, $testInfo }) => {
  await expectLabels(stateFor(page), $testInfo, 'after-reload');
});

When('Nathan and Annie click their restricted page references', async ({ page }) => {
  const { viewers } = stateFor(page);

  await referenceElement(viewers.Annie, 'restricted').click();
  await referenceElement(viewers.Nathan, 'restricted').click();
});

Then('Nathan opens the restricted target while Annie stays on the shared reference page', async ({ page, $testInfo }) => {
  const { viewers } = stateFor(page);

  await expect(viewers.Nathan).toHaveURL(new URL(`/app/${workspaceId}/${referenceIds.restricted}`, page.url()).href);
  await expect(viewers.Nathan.getByTestId('page-title-input')).toHaveText('Restricted ref target');
  await expect(viewers.Nathan.getByTestId('editor-content')).toContainText('Test-only target. Nathan owns this page.');
  await expectSharedPage(viewers.Annie);
  await expect(referenceElement(viewers.Annie, 'restricted')).toHaveText('No access');
  const screenshotPath = $testInfo.outputPath('Nathan-opened-restricted-target.png');

  await viewers.Nathan.getByRole('main').screenshot({ path: screenshotPath });
  await $testInfo.attach('Nathan-opened-restricted-target', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});

After({ tags: '@local-ref-pages' }, async ({ page }) => {
  const state = states.get(page);

  await state?.memberContext.close();
  await state?.failureContext?.close();
  states.delete(page);
});

Then('both viewers can inspect the existing missing reference by hovering', async ({ page, $testInfo }) => {
  for (const [viewer, viewerPage] of Object.entries(stateFor(page).viewers)) {
    const details = await hoverReferencePopup(viewerPage, 'missing', 'Page not found');

    await expect(details).toContainText('Ask the page owner for an updated link.');
    await expect(details.getByRole('button', { name: 'Open Trash', exact: true })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await capturePopup(viewerPage, $testInfo, `${viewer}-Page-not-found-popup`);
    await viewerPage.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
  }
});

Then('Annie can inspect No access by hovering and by keyboard', async ({ page, $testInfo }) => {
  const memberPage = stateFor(page).viewers.Annie;
  const details = await hoverReferencePopup(memberPage, 'restricted', 'No access');

  await expect(details).toContainText('Ask the page owner to share it with you.');
  await expect(details.getByRole('button', { name: 'Open Trash', exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await capturePopup(memberPage, $testInfo, 'Annie-No-access-popup');
  await memberPage.mouse.move(0, 0);
  await expect(details).toHaveCount(0);

  const label = referenceElement(memberPage, 'restricted').getByRole('button', { name: 'No access', exact: true });

  for (const key of ['Enter', 'Space']) {
    await label.focus();
    await label.press(key);
    await expect(details).toBeVisible();
    await memberPage.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(label).toBeFocused();
  }
});

When('Nathan opens the shared page with a temporary reference request failure', async ({ page, browser, baseURL, $testInfo }) => {
  const state = stateFor(page);
  const password = process.env.REF_PAGES_TEST_PASSWORD;

  if (!password) throw new Error('Set REF_PAGES_TEST_PASSWORD');
  state.failureContext = await browser.newContext({ baseURL, locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  state.failurePage = await state.failureContext.newPage();
  state.failure = await installPageReferenceNetworkFault(state.failurePage, workspaceId, referenceIds.restricted);
  await signIn(state.failurePage, accounts.Nathan, password);
  const reference = referenceElement(state.failurePage, 'restricted');

  await expect(reference.getByRole('button', { name: 'Couldn’t load page', exact: true })).toBeVisible();
  await expect(reference.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await expect(referenceElement(state.failurePage, 'missing')).toHaveText('Page not found');
  expect(state.failure.blockedReads).toBeGreaterThan(0);
  const popup = await hoverReferencePopup(state.failurePage, 'restricted', 'Couldn’t load page');

  await expect(popup).toContainText('Check your connection and try again.');
  await expect(popup.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await expect(popup.getByRole('button', { name: 'Open Trash', exact: true })).toHaveCount(0);
  const screenshotPath = $testInfo.outputPath('Nathan-temporary-reference-failure.png');

  await state.failurePage.getByRole('main').screenshot({ path: screenshotPath });
  await $testInfo.attach('Nathan-temporary-reference-failure', { path: screenshotPath, contentType: 'image/png' });
});

Then('Retry remains available when the request still fails', async ({ page }) => {
  const { failurePage, failure } = stateFor(page);

  if (!failurePage || !failure) throw new Error('Open the controlled failure session first');
  const blockedBeforeRetry = failure.blockedReads;
  const response = failurePage.waitForResponse((value) =>
    new URL(value.url()).pathname === `/api/workspace/${workspaceId}/view/${referenceIds.restricted}` && value.status() === 503);

  await failurePage.getByRole('dialog', { name: 'Couldn’t load page', exact: true })
    .getByRole('button', { name: 'Retry', exact: true }).click();
  await response;
  await expect(referenceElement(failurePage, 'restricted')
    .getByRole('button', { name: 'Couldn’t load page', exact: true })).toBeVisible();
  expect(failure.blockedReads).toBeGreaterThan(blockedBeforeRetry);
  const popup = await hoverReferencePopup(failurePage, 'restricted', 'Couldn’t load page');

  await expect(popup.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
});

Then('Retry loads the real target metadata and restores navigation', async ({ page }) => {
  const { failurePage, failure } = stateFor(page);

  if (!failurePage || !failure) throw new Error('Open the controlled failure session first');
  failure.recover();
  const response = failurePage.waitForResponse((value) =>
    new URL(value.url()).pathname === `/api/workspace/${workspaceId}/view/${referenceIds.restricted}` && value.status() === 200);

  await failurePage.getByRole('dialog', { name: 'Couldn’t load page', exact: true })
    .getByRole('button', { name: 'Retry', exact: true }).click();
  await response;
  await expect(referenceElement(failurePage, 'restricted')).toHaveText('Restricted ref target');
  await expect(referenceElement(failurePage, 'restricted').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(failurePage.getByRole('dialog', { name: 'Couldn’t load page', exact: true })).toHaveCount(0);
  await referenceElement(failurePage, 'restricted').click();
  await expect(failurePage).toHaveURL(new URL(`/app/${workspaceId}/${referenceIds.restricted}`, failurePage.url()).href);
  await expect(failurePage.getByTestId('editor-content')).toContainText('Test-only target. Nathan owns this page.');
});

Then('Annie sees an explanation of the restricted reference', async ({ page }) => {
  const memberPage = stateFor(page).viewers.Annie;
  const dialog = memberPage.getByRole('dialog', { name: 'No access', exact: true });

  await expect(dialog).toContainText('Ask the page owner to share it with you.');
  await expectSharedPage(memberPage);
  await memberPage.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

When('both viewers hover over the trashed reference and open Trash from its popup', async ({ page, $testInfo }) => {
  for (const [viewer, viewerPage] of Object.entries(stateFor(page).viewers)) {
    await viewerPage.goto(sharedPath, { waitUntil: 'domcontentloaded' });
    await expectSharedPage(viewerPage);
    const details = await hoverReferencePopup(viewerPage, 'trashed', 'Page in Trash');

    await expect(details).toContainText('This page is in Trash.');
    await expect(details.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Open Trash', exact: true })).toBeEnabled();
    await capturePopup(viewerPage, $testInfo, `${viewer}-Page-in-Trash-popup`);
    await details.getByRole('button', { name: 'Open Trash', exact: true }).click();
  }
});

Then('both viewers see the recoverable target in Trash', async ({ page }) => {
  for (const viewerPage of Object.values(stateFor(page).viewers)) {
    await expect(viewerPage).toHaveURL(new URL('/app/trash', viewerPage.url()).href);
    const target = viewerPage.getByRole('checkbox').filter({ hasText: 'Trash ref target' });

    await expect(target).toHaveCount(1);
    await expect(target.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  }
});
