import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp, signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

type Person = { id: string; name: string };
type MentionState = {
  page: Page;
  context?: BrowserContext;
  reply: boolean;
  person?: Person;
  people: Person[];
  threadId?: string;
  payload?: { content: string; mentioned_user_uuids: string[] };
};
const states = new WeakMap<Page, MentionState>();

function stateFor(page: Page): MentionState {
  const state = states.get(page);

  if (!state) throw new Error('Sign in for the comment mention scenario first');
  return state;
}

function input(state: MentionState): Locator {
  return state.page.getByTestId(state.reply ? 'inline-comment-reply-input' : 'inline-comment-input');
}

function thread(state: MentionState): Locator {
  return state.threadId
    ? state.page.locator(`[id="${state.threadId}"]`)
    : state.page.getByTestId('inline-comment-thread').first();
}

async function save(state: MentionState) {
  const request = state.page.waitForRequest(
    (request) => request.method() === 'POST' && /\/inline-comment(?:\/v2)?$/.test(new URL(request.url()).pathname)
  );

  if (state.reply) await input(state).press('Enter');
  else await state.page.getByTestId('inline-comment-submit').click();
  state.payload = (await request).postDataJSON();
  await expect(input(state)).toBeHidden({ timeout: 30000 });
  await expect(thread(state)).toBeVisible({ timeout: 30000 });
  state.threadId = (await thread(state).getAttribute('id'))!;
}

Given('I am signed in for document comment mention tests', async ({ page, request }) => {
  page.setDefaultNavigationTimeout(45000);
  const email = process.env.APPFLOWY_COMMENT_TEST_EMAIL;

  if (email) {
    const password = process.env.APPFLOWY_COMMENT_TEST_PASSWORD;

    if (!password) throw new Error('APPFLOWY_COMMENT_TEST_PASSWORD is required for the configured local account');
    await signInWithPasswordViaUi(page, email, password);
    await page.getByTestId('workspace-dropdown-trigger').click();
    await expect(page.getByTestId('workspace-dropdown-content')).toContainText(email);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('current-workspace-name')).toHaveText(/nathan.*workspace/i);
  } else {
    await signInAndWaitForApp(page, request, generateRandomEmail());
  }

  const state: MentionState = { page, reply: false, people: [] };

  states.set(page, state);
});

Given('a fresh document for comment mentions is open', async ({ page, browser }) => {
  const state = stateFor(page);
  const viewId = await createDocumentPageAndNavigate(state.page, 30000);

  // Record the affected UI on task-owned data after authentication and setup.
  if (process.env.COMMENT_MENTION_VIDEO_DIR) {
    const destination = state.page.url();
    // Keep cached profiles together with their localStorage freshness stamps.
    const storageState = await state.page.context().storageState({ indexedDB: true });

    await page.close();
    state.context = await browser.newContext({
      baseURL: process.env.BASE_URL || 'http://localhost:3000',
      storageState,
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: process.env.COMMENT_MENTION_VIDEO_DIR, size: { width: 1440, height: 900 } },
    });
    await state.context.addInitScript(() => {
      (window as Window & { Cypress?: boolean }).Cypress = true;
    });
    state.page = await state.context.newPage();
    await state.page.goto(destination, { waitUntil: 'domcontentloaded' });
    await expect(state.page.getByTestId('sidebar-page-header')).toBeVisible({ timeout: 30000 });
  }

  const editor = state.page.locator(`#editor-${viewId}`);

  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click();
  await state.page.keyboard.type('Issue 665 comment mention regression.', { delay: 30 });
  await expect(editor).toContainText('Issue 665 comment mention regression.');
});

After({ tags: '@inline-comment-mentions' }, async ({ page, $testInfo }) => {
  const state = states.get(page);

  if ($testInfo.status !== $testInfo.expectedStatus) {
    console.log('Comment mention failure:', $testInfo.errors.map((error) => error.message).join('\n'));
    if (state && !state.page.isClosed())
      await state.page.screenshot({ path: $testInfo.outputPath('comment-mention-failure.png') });
  }

  if (state?.context) {
    const video = state.page.video();

    await state.context.close();
    console.log('Comment mention proof video:', await video?.path());
  }

  states.delete(page);
});

When('I open a new comment for mention testing', async ({ page }) => {
  const state = stateFor(page);

  await state.page
    .getByTestId('editor-content')
    .locator('[data-slate-string="true"]')
    .first()
    .dblclick({ position: { x: 10, y: 5 } });
  await state.page.getByTestId('inline-comment-toolbar-action').click();
  await expect(input(state)).toBeVisible();
});

Given('a plain comment for mention testing exists', async ({ page }) => {
  const state = stateFor(page);

  await state.page
    .getByTestId('editor-content')
    .locator('[data-slate-string="true"]')
    .first()
    .dblclick({ position: { x: 10, y: 5 } });
  await state.page.getByTestId('inline-comment-toolbar-action').click();
  await input(state).fill('Comment mention cancellation regression');
  await save(state);
});

When('I open the comment reply for mention testing', async ({ page }) => {
  const state = stateFor(page);

  await thread(state).hover();
  await thread(state).getByTestId('inline-comment-reply-button').click();
  state.reply = true;
  await expect(input(state)).toBeVisible();
});

When('I type {string} in the comment mention input', async ({ page }, text: string) => {
  await input(stateFor(page)).pressSequentially(text, { delay: 60 });
});

Then('the comment person suggestions are visible', async ({ page }) => {
  const state = stateFor(page);

  await expect(state.page.getByRole('listbox')).toBeVisible();
  await expect(state.page.getByRole('option').first()).toBeVisible();
  if (process.env.COMMENT_MENTION_VIDEO_DIR) await state.page.waitForTimeout(800);
});

When('I select a comment person with the keyboard', async ({ page }) => {
  const state = stateFor(page);
  const email = state.reply ? process.env.APPFLOWY_COMMENT_REPLY_PERSON : process.env.APPFLOWY_COMMENT_TEST_PERSON;

  if (email) await input(state).pressSequentially(email.split('@')[0], { delay: 30 });
  const option = state.page.getByRole('option').first();

  await expect(option).toBeVisible();
  if (email) await expect(option).toContainText(email);
  state.person = {
    id: (await option.getAttribute('data-person-id'))!,
    name: (await option.getAttribute('data-person-name'))!,
  };
  await input(state).press('ArrowDown');
  await input(state).press('ArrowUp');
  await input(state).press('Enter');
});

When('I select a comment person with the mouse', async ({ page }) => {
  const state = stateFor(page);
  const email = state.reply ? process.env.APPFLOWY_COMMENT_REPLY_PERSON : process.env.APPFLOWY_COMMENT_TEST_PERSON;

  if (email) await input(state).pressSequentially(email.split('@')[0], { delay: 30 });
  const option = state.page.getByRole('option').first();

  await expect(option).toBeVisible();
  if (email) await expect(option).toContainText(email);
  state.person = {
    id: (await option.getAttribute('data-person-id'))!,
    name: (await option.getAttribute('data-person-name'))!,
  };
  await option.click();
});

Then('the selected person is shown as a readable comment draft', async ({ page }) => {
  const state = stateFor(page);

  await expect(input(state)).toHaveValue(`@${state.person!.name} `);
  await expect(input(state)).toBeFocused();
  await expect(input(state)).toHaveAttribute('aria-expanded', 'false');
  if (process.env.COMMENT_MENTION_VIDEO_DIR) await state.page.waitForTimeout(800);
});

When('I save the comment mention', async ({ page }) => save(stateFor(page)));

Then('the selected comment person identity is saved', async ({ page }) => {
  const state = stateFor(page);
  const person = state.person!;

  expect(state.payload?.content).toBe(`@[${person.name}](${person.id})`);
  expect(state.payload?.mentioned_user_uuids).toEqual([person.id]);
  await expect(thread(state).locator(`[data-mention-id="${person.id}"]`).last()).toHaveText(`@${person.name}`);
  state.people.push(person);
  if (process.env.COMMENT_MENTION_VIDEO_DIR) await state.page.waitForTimeout(800);
});

When('I refresh the document with comment mentions', async ({ page }) => {
  const state = stateFor(page);

  await state.page.reload();
  await state.page.getByTestId('inline-comment-toggle').click();
  await expect(thread(state)).toBeVisible({ timeout: 30000 });
  const toggle = thread(state).getByTestId('inline-comment-replies-toggle');

  await toggle.click();
});

Then('both comment person mentions remain visible', async ({ page }) => {
  const state = stateFor(page);

  for (const person of state.people) {
    await expect(thread(state).locator(`[data-mention-id="${person.id}"]`).first()).toHaveText(`@${person.name}`);
  }

  await expect(thread(state).locator('[data-mention-id]')).toHaveCount(2);
  if (process.env.COMMENT_MENTION_VIDEO_DIR) {
    await state.page.screenshot({ path: `${process.env.COMMENT_MENTION_VIDEO_DIR}/after-persistence.png` });
    await state.page.waitForTimeout(1000);
  }
});

Then('the comment person suggestions show no results', async ({ page }) => {
  const state = stateFor(page);

  await expect(state.page.getByRole('listbox')).toBeVisible();
  await expect(state.page.getByRole('option')).toHaveCount(0);
  await expect(state.page.getByRole('status')).toContainText(/no result/i);
});

When('I press Escape in the comment mention input', async ({ page }) => input(stateFor(page)).press('Escape'));
Then('the comment mention draft is still open', async ({ page }) => {
  const state = stateFor(page);

  await expect(input(state)).toHaveValue('@no-person-matches-665');
  await expect(input(state)).toBeFocused();
  await expect(state.page.getByRole('listbox')).toBeHidden();
});
Then('the comment mention draft is closed', async ({ page }) => expect(input(stateFor(page))).toBeHidden());

When("I edit the selected comment person's name", async ({ page }) => {
  const state = stateFor(page);

  await input(state).press('Backspace');
  await input(state).press('Backspace');
  await input(state).press('Escape');
});

Then('the edited comment is saved without a person mention', async ({ page }) => {
  const state = stateFor(page);

  expect(state.payload?.content).toBe(`@${state.person!.name.slice(0, -1)}`);
  expect(state.payload?.mentioned_user_uuids).toEqual([]);
  await expect(thread(state).locator('[data-mention-id]')).toHaveCount(0);
});
