import { APIRequestContext, expect, Page, Request } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { renameCurrentPage } from '../../support/duplicate-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { AuthTestUtils } from '../../support/auth-utils';
import { BlockSelectors, DatabaseGridSelectors, EditorSelectors, SidebarSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';
import { grantWorkspaceProSubscription } from '../../support/subscription-test-helpers';

const { Given, When, Then, Before } = createBdd();

const OWNER_EMAIL = 'fixture-mention-web-owner@appflowy.io';
const MEMBER_EMAIL = 'fixture-mention-web-member@appflowy.io';
const MEMBER_DISPLAY_NAME = 'Mention Web Fixture Member';
const FEATURE_PASSWORDLESS_TOKEN_TIMEOUT_MS = 30000;
const MENTION_API_POLL_TIMEOUT_MS = 90000;
const MENTION_API_POLL_INTERVAL_MS = 2000;

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  tokenData: AuthTokenData;
};

type AuthTokenData = {
  access_token?: string;
  refresh_token?: string;
  user?: { id?: string };
  [key: string]: unknown;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type UserWorkspaceInfoPayload = {
  user_profile: { uuid: string };
  visiting_workspace: { workspace_id: string };
  workspaces: { workspace_id: string }[];
};

type MentionSearchItem = {
  kind: string;
  title: string;
  object_id?: string;
  database_row_id?: string;
};

type DatabaseIdentity = {
  databaseId: string;
  databaseViewId: string;
};

type DatabaseRowListItem = {
  id: string;
};

type MentionSearchSection = {
  kind: string;
  items: MentionSearchItem[];
};

type MentionSearchResponse = {
  sections: MentionSearchSection[];
};

type RecordedMentionRequest = {
  body: { query?: string; include?: string[] } | null;
  headers: Record<string, string>;
  status: number;
};

type MentionFixtureState = {
  /** Mention searches that got a response, in the order their responses finished. */
  mentionRequests?: RecordedMentionRequest[];
  /** Why mention searches failed without a response: aborts, and rejected CORS preflights. */
  failedMentionRequests?: string[];
  /** The panel session that the typed mention requests were sent in. */
  mentionStreamSession?: string;
  ownerEmail: string;
  memberEmail: string;
  memberName: string;
  runId: string;
  workspaceId?: string;
  ownerToken?: string;
  memberToken?: string;
  memberUuid?: string;
  databaseId?: string;
  databaseViewId?: string;
  databaseName?: string;
  rowId?: string;
  rowKeyword?: string;
  rowSearchRequestBody?: unknown;
  /** The pages a stubbed bare `@` answer lists, the first one the page the user types (MEN-WEB-08). */
  recentPages?: { id: string; title: string }[];
  /** Typed mention searches that got their answer after being held. */
  heldTypedSearchesAnswered?: number;
  /** A page this tab created and renamed a moment ago, which no mention answer lists yet (MEN-WEB-09). */
  freshPage?: { id: string; title: string };
  /** The typed query whose stubbed answer lists the member, five pages and a database (MEN-WEB-12). */
  sectionsQuery?: string;
  /** The title of the database in that answer. */
  sectionsDatabaseTitle?: string;
};

/** When the first keystroke of a query came, and when an option showed a title (MEN-WEB-09). */
type MentionShownProbe = {
  keyAt?: number;
  shownAt?: number;
};

/** When the first keystroke after the probe was installed came, and when the list narrowed. */
type MentionNarrowProbe = {
  keyAt?: number;
  narrowedAt?: number;
};

// The switches MentionPanel reads when it opens (src/.../mention-panel/mentionTypeaheadFlag.ts).
const MENTION_TYPEAHEAD_V2_OVERRIDE_KEY = '__mention_typeahead_v2';
const MENTION_SECTIONS_V2_OVERRIDE_KEY = '__mention_sections_v2';

const stateByPage = new WeakMap<Page, MentionFixtureState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {
    ownerEmail: OWNER_EMAIL,
    memberEmail: MEMBER_EMAIL,
    memberName: MEMBER_DISPLAY_NAME,
    runId: uuidv4().slice(0, 8),
  });
});

Given('the mention search fixture owner is signed in', async ({ page, request }) => {
  const state = getState(page);
  const ownerSession = await signInFixtureAccount(request, state.ownerEmail);

  state.ownerToken = ownerSession.accessToken;
  await signBrowserInWithSession(page, ownerSession);

  const workspaceInfo = await getUserWorkspaceInfo(request, state.ownerToken);

  state.workspaceId = workspaceInfo.visiting_workspace.workspace_id;
});

Given('the mention search fixture member can be mentioned', async ({ page, request }) => {
  const state = getState(page);

  await ensureMemberJoinedOwnerWorkspace(request, state);
  await waitForMentionApiItem(
    request,
    requireOwnerToken(state),
    requireWorkspaceId(state),
    {
      query: state.memberName,
      limit: 8,
      include: ['person'],
    },
    (item) => item.object_id === state.memberUuid && item.title === state.memberName
  );
});

Given('a blank mention search document page is open', async ({ page }) => {
  await createDocumentPageAndNavigate(page);
  await focusEditor(page);
});

Given('mention search requests are recorded', async ({ page }) => {
  const state = getState(page);
  const answered: RecordedMentionRequest[] = [];
  const failed: string[] = [];

  state.mentionRequests = answered;
  state.failedMentionRequests = failed;
  // Only requests that got a response count. One whose CORS preflight was rejected was never sent,
  // and the page sends it again without the stream headers.
  page.on('requestfinished', async (request) => {
    if (!isMentionSearchRequest(request)) return;

    const status = await request.response().then(
      (response) => response?.status() ?? 0,
      () => 0
    );

    answered.push({
      body: request.postDataJSON() as RecordedMentionRequest['body'],
      headers: request.headers(),
      status,
    });
  });
  page.on('requestfailed', (request) => {
    if (isMentionSearchRequest(request)) failed.push(request.failure()?.errorText ?? 'unknown error');
  });
});

Given('database-row mention search retries later for {string}', async ({ page }, query: string) => {
  await page.route('**/mentions/search{,?**}', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      query?: string;
      include?: string[];
    } | null;
    const isDatabaseRowOnlyRequest =
      body?.query === query &&
      Array.isArray(body.include) &&
      body.include.length === 1 &&
      body.include[0] === 'database_row';

    if (!isDatabaseRowOnlyRequest) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: -5,
        message: 'retry later',
      }),
    });
  });
});

Given('mention search answers the empty query with two recent fixture pages', async ({ page }) => {
  const state = getState(page);
  const recentPages = [`Keep narrow ${state.runId}`, `Budget ${state.runId}`].map((title) => ({ id: uuidv4(), title }));

  state.recentPages = recentPages;
  await page.route('**/mentions/search{,?**}', async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;

    if (body?.query?.trim()) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          sections: [
            {
              kind: 'pages',
              title: 'Pages',
              has_more: false,
              status: 'ok',
              items: recentPages.map(({ id, title }) => ({
                kind: 'page',
                object_id: id,
                title,
                mention: { type: 'page', page_id: id },
              })),
            },
          ],
          partial: false,
        },
      }),
    });
  });
});

Given('a fresh fixture page was created and renamed in this tab', async ({ page }) => {
  const state = getState(page);
  const title = `Fresh ${state.runId}`;
  const documentUrl = page.url();
  // `addPage` and the title's rename feed the tab's local index (MEN-WEB-07).
  const id = await createDocumentPageAndNavigate(page);

  await renameCurrentPage(page, title);
  state.freshPage = { id, title };

  // Back to the first document without a reload, which would forget this tab's creation.
  await page.goBack();
  await page.waitForURL((url) => url.href === documentUrl);
  await focusEditor(page);
});

Given('mention search answers the empty query with no pages', async ({ page }) => {
  await page.route('**/mentions/search{,?**}', async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;

    if (body?.query?.trim()) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'success', data: { sections: [], partial: false } }),
    });
  });
});

Given('typed mention searches are held for {int} ms', async ({ page }, holdMs: number) => {
  const state = getState(page);

  state.heldTypedSearchesAnswered = 0;
  await page.route('**/mentions/search{,?**}', async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;

    if (!body?.query?.trim()) {
      await route.fallback();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, holdMs));
    // The picker aborts a typed search it no longer needs; that one is never answered.
    await route.continue().then(
      () => {
        state.heldTypedSearchesAnswered = (state.heldTypedSearchesAnswered ?? 0) + 1;
      },
      () => undefined
    );
  });
});

Given('the mention typeahead v2 is switched on', async ({ page }) => {
  // The picker reads the switch each time it opens, so no reload is needed.
  await page.evaluate((key) => localStorage.setItem(key, 'true'), MENTION_TYPEAHEAD_V2_OVERRIDE_KEY);
});

Given('the mention sections switch is on', async ({ page }) => {
  // Read when the picker opens, as the v2 switch is.
  await page.evaluate((key) => localStorage.setItem(key, 'true'), MENTION_SECTIONS_V2_OVERRIDE_KEY);
});

Given(
  'mention search answers the sections fixture query with the member, five pages and a database',
  async ({ page }) => {
    const state = getState(page);
    const query = `sections${state.runId}`;
    const databaseTitle = `Database ${query}`;
    const databaseId = uuidv4();
    const databaseViewId = uuidv4();
    const pages = [1, 2, 3, 4, 5].map((index) => ({ id: uuidv4(), title: `Page ${index} ${query}` }));
    const memberUuid = state.memberUuid ?? uuidv4();

    state.sectionsQuery = query;
    state.sectionsDatabaseTitle = databaseTitle;
    await page.route('**/mentions/search{,?**}', async (route) => {
      const body = route.request().postDataJSON() as { query?: string; include?: string[] } | null;

      if (body?.query?.trim() !== query) {
        await route.fallback();
        return;
      }

      const rowsOnly = Array.isArray(body.include) && body.include.length === 1 && body.include[0] === 'database_row';
      // Out of the order servers send, so only the picker can put People, Pages and Databases in it.
      const sections = rowsOnly
        ? []
        : [
            {
              kind: 'databases',
              title: 'Databases',
              has_more: false,
              status: 'ok',
              items: [
                {
                  kind: 'database',
                  object_id: databaseId,
                  title: databaseTitle,
                  database_id: databaseId,
                  database_view_id: databaseViewId,
                  mention: { type: 'database', database_id: databaseId, database_view_id: databaseViewId },
                },
              ],
            },
            {
              kind: 'pages',
              title: 'Pages',
              has_more: false,
              status: 'ok',
              items: pages.map(({ id, title }) => ({
                kind: 'page',
                object_id: id,
                title,
                mention: { type: 'page', page_id: id },
              })),
            },
            {
              kind: 'people',
              title: 'People',
              has_more: false,
              status: 'ok',
              items: [
                {
                  kind: 'person',
                  object_id: memberUuid,
                  title: state.memberName,
                  subtitle: state.memberEmail,
                  mention: { type: 'person', person_id: memberUuid, person_name: state.memberName, page_id: uuidv4() },
                },
              ],
            },
          ];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'success', data: { sections, partial: false } }),
      });
    });
  }
);

Given('a mention search document contains an indexed fixture database row', async ({ page, request }) => {
  const state = getState(page);
  const rowKeyword = `Mention Row ${state.runId}`;
  const databaseName = `Mention Search DB ${state.runId}`;

  state.rowKeyword = rowKeyword;
  state.databaseName = databaseName;

  await createDatabaseView(page, 'Grid', 8000);
  await waitForGridReady(page);
  await renameCurrentDatabasePage(page, databaseName);
  const identity = await getCurrentDatabaseIdentity(page);
  const rowId = await createDatabaseRowViaApi(
    request,
    requireOwnerToken(state),
    requireWorkspaceId(state),
    identity.databaseId,
    rowKeyword
  );

  state.databaseId = identity.databaseId;
  state.databaseViewId = identity.databaseViewId;
  state.rowId = rowId;

  await waitForDatabaseRowInApi(
    request,
    requireOwnerToken(state),
    requireWorkspaceId(state),
    identity.databaseId,
    rowId
  );
  await mockDatabaseRowMentionSearch(page, state);
  const docViewId = await createDocumentPageAndNavigate(page);

  await insertLinkedDatabaseViaSlash(page, docViewId, databaseName);
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toContainText(rowKeyword, { timeout: 30000 });
  await focusParagraphBelowLinkedDatabase(page);
});

When('I open the mention panel with an empty query', async ({ page }) => {
  await openMentionPanel(page);
});

When('I type the first letters of the first recent fixture page', async ({ page }) => {
  const [first, second] = requireRecentPages(getState(page));

  // Stamps the first keystroke, and the first commit after it that shows the first page without
  // the second: the narrowed list, which no typed answer has reached yet.
  await page.evaluate(
    ({ shown, hidden }) => {
      const probe: MentionNarrowProbe = {};
      const optionTexts = () =>
        Array.from(document.querySelectorAll('[data-testid="mention-panel"] [data-option-kind]')).map(
          (option) => option.textContent ?? ''
        );
      const check = () => {
        if (probe.keyAt === undefined || probe.narrowedAt !== undefined) return;

        const texts = optionTexts();

        if (texts.some((text) => text.includes(shown)) && !texts.some((text) => text.includes(hidden))) {
          probe.narrowedAt = performance.now();
        }
      };

      (window as Window & { __mentionNarrowProbe?: MentionNarrowProbe }).__mentionNarrowProbe = probe;
      document.addEventListener(
        'keydown',
        () => {
          probe.keyAt = performance.now();
        },
        { capture: true, once: true }
      );
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    { shown: first.title, hidden: second.title }
  );
  await page.keyboard.type(first.title.slice(0, 2), { delay: 30 });
});

When('I search mentions for the first letters of the fresh fixture page', async ({ page }) => {
  const { title } = requireFreshPage(getState(page));

  await openMentionPanel(page);
  // Stamps the query's first keystroke, and the first moment after it that an option shows the page.
  await page.evaluate((shown) => {
    const probe: MentionShownProbe = {};
    const check = () => {
      if (probe.keyAt === undefined || probe.shownAt !== undefined) return;

      const options = Array.from(document.querySelectorAll('[data-testid="mention-panel"] [data-option-kind]'));

      if (options.some((option) => option.textContent === shown)) probe.shownAt = performance.now();
    };

    (window as Window & { __mentionShownProbe?: MentionShownProbe }).__mentionShownProbe = probe;
    document.addEventListener(
      'keydown',
      () => {
        probe.keyAt = performance.now();
        // The bare `@` may list the page already: it was opened and created seconds ago.
        queueMicrotask(check);
      },
      { capture: true, once: true }
    );
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, title);
  // The run id makes the page's first letters unique in the fixture workspace.
  await page.keyboard.type(title.slice(0, 'Fresh '.length + 3), { delay: 30 });
});

When('I search mentions for the sections fixture query', async ({ page }) => {
  await searchMentionsInEditor(page, requireSectionsQuery(getState(page)));
});

When('I search mentions for the fixture member', async ({ page }) => {
  await searchMentionsInEditor(page, getState(page).memberName);
});

When('I search mentions for {string}', async ({ page }, query: string) => {
  await searchMentionsInEditor(page, query);
});

When('I search mentions for the fixture database row', async ({ page }) => {
  const state = getState(page);
  const rowKeyword = requireRowKeyword(state);
  const rowRequestPromise = page.waitForRequest(
    (request) => {
      if (!request.url().includes('/mentions/search')) return false;

      const body = request.postDataJSON() as {
        query?: string;
        include?: string[];
        filter?: {
          database_ids?: string[];
        };
      } | null;
      const isRowRequest =
        body?.query === rowKeyword &&
        Array.isArray(body.include) &&
        body.include.length === 1 &&
        body.include[0] === 'database_row';

      if (isRowRequest) {
        state.rowSearchRequestBody = body;
      }

      return isRowRequest;
    },
    { timeout: 30000 }
  );

  await searchMentionsAtCurrentSelection(page, rowKeyword);
  await rowRequestPromise;
});

Then('the mention panel shows date quick picks', async ({ page }) => {
  const panel = mentionPanel(page);

  await expect(panel.getByText('Today', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText('Tomorrow', { exact: true })).toBeVisible({ timeout: 15000 });
});

Then('the mention panel does not show a links section', async ({ page }) => {
  await expect(mentionPanel(page).getByText('Links', { exact: true })).toHaveCount(0);
});

Then('the mention panel does not show database rows', async ({ page }) => {
  // By default the picker folds a Database rows section into Pages (MEN-WEB-12's separate layout
  // is behind its switch), so absence is asserted on row results by their data-option-kind too.
  await expect(mentionPanel(page).getByText('Database rows', { exact: true })).toHaveCount(0);
  await expect(mentionPanel(page).locator('[data-option-kind="database_row"]')).toHaveCount(0);
});

Then('the mention panel shows both recent fixture pages', async ({ page }) => {
  const panel = mentionPanel(page);

  for (const { title } of requireRecentPages(getState(page))) {
    await expect(panel.getByText(title, { exact: true })).toBeVisible({ timeout: 15000 });
  }
});

Then('the mention panel shows only the first recent fixture page while typed searches are held', async ({ page }) => {
  const state = getState(page);
  const [first, second] = requireRecentPages(state);
  const panel = mentionPanel(page);

  await expect(panel.getByText(first.title, { exact: true })).toBeVisible({ timeout: 1000 });
  await expect(panel.getByText(second.title, { exact: true })).toHaveCount(0);
  // No typed answer arrived: the list was narrowed from the bare answer on screen.
  expect(state.heldTypedSearchesAnswered).toBe(0);

  const probe = await page.evaluate(
    () => (window as Window & { __mentionNarrowProbe?: MentionNarrowProbe }).__mentionNarrowProbe
  );

  expect(probe?.keyAt, 'the first keystroke').toBeDefined();
  expect(probe?.narrowedAt, 'the narrowed list').toBeDefined();
  // The plan's budget. React commits before the browser paints, so this is soft on loaded runners.
  expect.soft((probe?.narrowedAt ?? 0) - (probe?.keyAt ?? 0), 'keystroke to narrowed list, ms').toBeLessThan(100);
});

Then(
  'the mention panel shows the fresh fixture page, flagged fresh, while typed searches are held',
  async ({ page }) => {
    const state = getState(page);
    const { title } = requireFreshPage(state);
    const option = mentionPanel(page).locator('[data-option-kind="page"]').filter({ hasText: title });

    await expect(option).toBeVisible({ timeout: 1000 });
    await expect(option).toHaveAttribute('data-fresh', 'true');
    // No typed answer arrived: the page came from the local lane.
    expect(state.heldTypedSearchesAnswered).toBe(0);

    const probe = await page.evaluate(
      () => (window as Window & { __mentionShownProbe?: MentionShownProbe }).__mentionShownProbe
    );

    expect(probe?.keyAt, 'the first keystroke').toBeDefined();
    expect(probe?.shownAt, 'the fresh page').toBeDefined();
    // The plan's budget, measured to React's commit. Soft on loaded runners.
    expect.soft((probe?.shownAt ?? 0) - (probe?.keyAt ?? 0), 'keystroke to the fresh page, ms').toBeLessThan(100);
  }
);

Then('the mention panel shows the people, pages and databases sections in that order', async ({ page }) => {
  const sections = mentionPanel(page).locator('[data-section-kind]');

  await expect
    .poll(() => sections.evaluateAll((shown) => shown.map((section) => section.getAttribute('data-section-kind'))), {
      timeout: 15000,
    })
    .toEqual(['people', 'pages', 'databases']);
  // Titled from the translations, which in English read as servers title them.
  for (const [kind, title] of [
    ['people', 'People'],
    ['pages', 'Pages'],
    ['databases', 'Databases'],
  ]) {
    const heading = mentionPanel(page).locator(`[data-section-kind="${kind}"]`).getByText(title, { exact: true });

    await expect(heading).toBeVisible();
  }
});

Then(
  'the mention panel lists the fixture database in its own section beside four pages and "1 more"',
  async ({ page }) => {
    const state = getState(page);
    const panel = mentionPanel(page);
    const pagesSection = panel.locator('[data-section-kind="pages"]');

    await expect(
      panel.locator('[data-section-kind="databases"] [data-option-kind="database"]').filter({
        hasText: requireSectionsDatabaseTitle(state),
      })
    ).toBeVisible({ timeout: 15000 });
    await expect(pagesSection.locator('[data-option-kind="page"]')).toHaveCount(4);
    await expect(pagesSection.locator('[data-option-key="pages|more"]')).toHaveText('1 more results...');
  }
);

Then('the mention panel offers to create a page named after the query last', async ({ page }) => {
  const query = requireSectionsQuery(getState(page));
  const options = mentionPanel(page).locator('[data-option-key]');
  const keys = await options.evaluateAll((shown) => shown.map((option) => option.getAttribute('data-option-key')));

  // After every result: the sub-page, then the page reference.
  expect(keys.slice(-2)).toEqual(['createPage:childPage', 'createPage:pageReference']);
  await expect(options.nth(keys.length - 2)).toHaveText(`Create "${query}" sub-page`);
});

Then('the mention panel shows the fixture member', async ({ page }) => {
  await expect(mentionPanel(page).getByText(getState(page).memberName, { exact: true })).toBeVisible({
    timeout: 30000,
  });
});

Then('the mention panel shows an external link for {string}', async ({ page }, hostname: string) => {
  const linksSection = mentionPanel(page).locator('[data-section-kind="links"]');
  const hostnamePattern = new RegExp(escapeRegExp(hostname));

  await expect(linksSection.getByText('Links', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(linksSection.getByRole('button', { name: hostnamePattern })).toBeVisible({ timeout: 15000 });
});

Then(
  'the typed mention requests for {string} were answered on two streams of one session',
  async ({ page }, query: string) => {
    const state = getState(page);
    const answered = requireMentionRequests(state);
    const typed = () => answered.filter((request) => request.body?.query === query);
    const primaryOf = () => typed().find((request) => !isDatabaseRowOnlyRecordedRequest(request));
    const rowsOf = () => typed().find(isDatabaseRowOnlyRecordedRequest);

    // The primary request and the rows-only request leave together after the typing debounce.
    await expect
      .poll(() => Boolean(primaryOf() && rowsOf()), {
        timeout: 15000,
        message: `answered primary and rows mention requests for "${query}". ${mentionFailureHint(state)}`,
      })
      .toBe(true);

    const primary = primaryOf();
    const rows = rowsOf();
    const primaryStream = primary?.headers['x-request-stream-id'] ?? '';
    const session = /^web-mention-(.+)-primary$/.exec(primaryStream)?.[1];

    expect(primary?.body?.include ?? []).not.toContain('database_row');
    expect(session, `primary stream id "${primaryStream}". ${mentionFailureHint(state)}`).toBeTruthy();
    expect(rows?.headers['x-request-stream-id']).toBe(`web-mention-${session}-rows`);
    expect(primary?.headers['x-request-time']).toMatch(/^\d+$/);
    expect(rows?.headers['x-request-time']).toMatch(/^\d+$/);
    expect([primary?.status, rows?.status]).toEqual([200, 200]);
    state.mentionStreamSession = session;
  }
);

Then(
  'the empty mention request was answered on the bare stream of that session without database rows',
  async ({ page }) => {
    const state = getState(page);
    const session = state.mentionStreamSession;
    const bareOf = () => requireMentionRequests(state).find((request) => (request.body?.query ?? '') === '');

    expect(session, 'the session of the typed mention requests').toBeTruthy();
    await expect
      .poll(() => Boolean(bareOf()), {
        timeout: 15000,
        message: `an answered empty-query mention request. ${mentionFailureHint(state)}`,
      })
      .toBe(true);

    const bare = bareOf();

    expect(bare?.body?.include ?? []).not.toContain('database_row');
    // Typing does not end the panel session, so the bare request shares the typed requests' session.
    expect(bare?.headers['x-request-stream-id']).toBe(`web-mention-${session}-bare`);
    expect(bare?.headers['x-request-time']).toMatch(/^\d+$/);
    expect(bare?.status).toBe(200);
  }
);

Then('the browser sent a database-row mention search request', async ({ page }) => {
  const body = getState(page).rowSearchRequestBody as {
    query?: string;
    include?: string[];
    filter?: { database_ids?: string[] };
  };

  expect(body).toMatchObject({
    query: requireRowKeyword(getState(page)),
    include: ['database_row'],
  });

  if (body.filter?.database_ids) {
    expect(body.filter.database_ids).toContain(requireDatabaseId(getState(page)));
  }
});

Then('the mention panel shows the fixture database row', async ({ page }) => {
  const resultSection = mentionPanel(page).locator('[data-option-category="result"]');
  const rowResult = resultSection
    .locator('[data-option-kind="database_row"]')
    .filter({ hasText: new RegExp(requireRowKeyword(getState(page))) });

  // The stubbed rows answer has a Database rows section, which the default folded layout shows in
  // Pages: there is no "Database rows" heading.
  await expect(rowResult.first()).toBeVisible({ timeout: 30000 });
  await expect(resultSection.getByText('Database rows', { exact: true })).toHaveCount(0);
});

async function ensureMemberJoinedOwnerWorkspace(request: APIRequestContext, state: MentionFixtureState): Promise<void> {
  const workspaceId = requireWorkspaceId(state);
  const ownerToken = requireOwnerToken(state);
  const memberSession = await signInFixtureAccount(request, state.memberEmail);

  state.memberToken = memberSession.accessToken;

  let memberWorkspaceInfo = await getUserWorkspaceInfo(request, memberSession.accessToken);
  const alreadyJoined = memberWorkspaceInfo.workspaces.some((workspace) => workspace.workspace_id === workspaceId);

  if (!alreadyJoined) {
    // A hosted server, which CI's backend is, lets a Free workspace hold one member.
    grantWorkspaceProSubscription(workspaceId);

    const createdInvite = await apiPost<{ code: string | null }>(
      request,
      ownerToken,
      `/api/workspace/${workspaceId}/invite-code`,
      { validity_period_hours: 24 }
    );
    const inviteCode =
      createdInvite.code ??
      (await apiGet<{ code: string | null }>(request, ownerToken, `/api/workspace/${workspaceId}/invite-code`)).code;

    if (!inviteCode) {
      throw new Error('Mention fixture workspace invite code was not created');
    }

    await apiPost<{ workspace_id: string }>(request, memberSession.accessToken, '/api/workspace/join-by-invite-code', {
      code: inviteCode,
    });
    memberWorkspaceInfo = await getUserWorkspaceInfo(request, memberSession.accessToken);
  }

  state.memberUuid = memberWorkspaceInfo.user_profile.uuid;
  await apiPut<void>(request, memberSession.accessToken, `/api/workspace/${workspaceId}/update-member-profile`, {
    name: state.memberName,
  });
}

async function signInFixtureAccount(request: APIRequestContext, email: string): Promise<AuthSession> {
  const authUtils = new AuthTestUtils();
  const callbackLink = await authUtils.generateSignInUrl(request, email);
  const hashIndex = callbackLink.indexOf('#');

  if (hashIndex === -1) {
    throw new Error(`Fixture auth callback for ${email} did not contain a token hash`);
  }

  const params = new URLSearchParams(callbackLink.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) {
    throw new Error(`Fixture auth callback for ${email} did not include access and refresh tokens`);
  }

  const verifyResponse = await request.get(`${TestConfig.apiUrl}/api/user/verify/${accessToken}`, {
    failOnStatusCode: false,
    timeout: FEATURE_PASSWORDLESS_TOKEN_TIMEOUT_MS,
  });

  if (!verifyResponse.ok()) {
    throw new Error(
      `Failed to verify fixture account ${email}: HTTP ${verifyResponse.status()} ${await verifyResponse.text()}`
    );
  }

  const tokenResponse = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=refresh_token`, {
    data: { refresh_token: refreshToken },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });

  if (!tokenResponse.ok()) {
    throw new Error(`Failed to refresh fixture token for ${email}: HTTP ${tokenResponse.status()}`);
  }

  const tokenData = (await tokenResponse.json()) as AuthTokenData;
  const refreshedAccessToken = tokenData.access_token || accessToken;
  const refreshedRefreshToken = tokenData.refresh_token || refreshToken;

  return {
    accessToken: refreshedAccessToken,
    refreshToken: refreshedRefreshToken,
    tokenData: {
      ...tokenData,
      access_token: refreshedAccessToken,
      refresh_token: refreshedRefreshToken,
    },
  };
}

async function signBrowserInWithSession(page: Page, session: AuthSession): Promise<void> {
  await page.addInitScript(() => {
    (window as Window & { Cypress?: boolean }).Cypress = true;
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ accessToken, refreshToken, tokenData }) => {
    const storedToken = {
      ...tokenData,
      access_token: tokenData.access_token || accessToken,
      refresh_token: tokenData.refresh_token || refreshToken,
    };

    localStorage.setItem('af_auth_token', storedToken.access_token);
    localStorage.setItem('af_refresh_token', storedToken.refresh_token);

    if (storedToken.user?.id) {
      localStorage.setItem('af_user_id', storedToken.user.id);
    }

    localStorage.setItem('token', JSON.stringify(storedToken));
  }, session);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
}

async function getUserWorkspaceInfo(request: APIRequestContext, token: string): Promise<UserWorkspaceInfoPayload> {
  return apiGet<UserWorkspaceInfoPayload>(request, token, '/api/user/workspace');
}

async function createDatabaseRowViaApi(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  databaseId: string,
  rowKeyword: string
): Promise<string> {
  return apiPost<string>(request, token, `/api/workspace/${workspaceId}/database/${databaseId}/row`, {
    cells: {
      Name: rowKeyword,
    },
    document: null,
    parse_link_as_link_preview: false,
  });
}

async function waitForDatabaseRowInApi(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  databaseId: string,
  rowId: string
): Promise<void> {
  const startedAt = Date.now();
  let lastRows: DatabaseRowListItem[] = [];

  while (Date.now() - startedAt < MENTION_API_POLL_TIMEOUT_MS) {
    lastRows = await apiGet<DatabaseRowListItem[]>(
      request,
      token,
      `/api/workspace/${workspaceId}/database/${databaseId}/row`
    );

    if (lastRows.some((row) => row.id === rowId)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, MENTION_API_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for database row ${rowId}. Last rows: ${JSON.stringify(lastRows)}`);
}

async function getCurrentDatabaseIdentity(page: Page): Promise<DatabaseIdentity> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const identity = await page.evaluate(() => {
      const testWindow = window as Window & {
        __TEST_DATABASE_CONTEXT__?: {
          activeViewId?: string;
          databaseDoc?: {
            guid?: string;
            getMap?: (key: string) => {
              get?: (key: string) => { get?: (key: string) => string | undefined } | undefined;
            };
          };
        };
      };
      const context = testWindow.__TEST_DATABASE_CONTEXT__;
      const dataSection = context?.databaseDoc?.getMap?.('data');
      const database = dataSection?.get?.('database');
      const databaseId = database?.get?.('id') ?? context?.databaseDoc?.guid;
      const databaseViewId = context?.activeViewId;

      if (!databaseId || !databaseViewId) {
        return null;
      }

      return { databaseId, databaseViewId };
    });

    if (identity) {
      return identity;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Timed out waiting for the active database identity from the UI');
}

async function mockDatabaseRowMentionSearch(page: Page, state: MentionFixtureState): Promise<void> {
  await page.route('**/mentions/search{,?**}', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      query?: string;
      include?: string[];
      filter?: {
        database_ids?: string[];
      };
    } | null;
    const databaseId = requireDatabaseId(state);
    const rowKeyword = requireRowKeyword(state);

    if (body?.query !== rowKeyword) {
      await route.continue();
      return;
    }

    if (
      !Array.isArray(body.include) ||
      body.include.length !== 1 ||
      body.include[0] !== 'database_row'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            sections: [],
            partial: false,
          },
        }),
      });
      return;
    }

    const databaseViewId = state.databaseViewId;
    const rowId = requireRowId(state);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          sections: [
            {
              kind: 'database_rows',
              title: 'Database rows',
              has_more: false,
              status: 'ready',
              items: [
                {
                  kind: 'database_row',
                  object_id: rowId,
                  title: rowKeyword,
                  subtitle: 'Database row',
                  database_id: databaseId,
                  database_view_id: databaseViewId,
                  database_row_id: rowId,
                  row_document_id: null,
                  can_access_context: true,
                  mention: {
                    type: 'database_row',
                    database_id: databaseId,
                    database_view_id: databaseViewId,
                    row_id: rowId,
                    row_document_id: null,
                  },
                },
              ],
            },
          ],
          partial: false,
        },
      }),
    });
  });
}

async function waitForMentionApiItem(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  payload: Record<string, unknown>,
  predicate: (item: MentionSearchItem) => boolean
): Promise<MentionSearchItem> {
  const startedAt = Date.now();
  let lastResponse: MentionSearchResponse | undefined;

  while (Date.now() - startedAt < MENTION_API_POLL_TIMEOUT_MS) {
    lastResponse = await apiPost<MentionSearchResponse>(
      request,
      token,
      `/api/workspace/${workspaceId}/mentions/search`,
      payload
    );

    const item = lastResponse.sections.flatMap((section) => section.items).find(predicate);

    if (item) {
      return item;
    }

    await new Promise((resolve) => setTimeout(resolve, MENTION_API_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for mention API item. Last response: ${JSON.stringify(lastResponse)}`);
}

async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });

  return unwrapApiResponse<T>(response.status(), await response.text());
}

async function apiPost<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: authHeaders(token),
    data,
    failOnStatusCode: false,
  });

  return unwrapApiResponse<T>(response.status(), await response.text());
}

async function apiPut<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.put(`${TestConfig.apiUrl}${path}`, {
    headers: authHeaders(token),
    data,
    failOnStatusCode: false,
  });

  return unwrapApiResponse<T>(response.status(), await response.text());
}

function unwrapApiResponse<T>(status: number, rawBody: string): T {
  let body: ApiResponse<T> | undefined;

  try {
    body = rawBody ? (JSON.parse(rawBody) as ApiResponse<T>) : undefined;
  } catch {
    throw new Error(`API returned non-JSON response with status ${status}: ${rawBody}`);
  }

  if (status < 200 || status >= 300 || body?.code !== 0) {
    throw new Error(`API request failed: HTTP ${status} ${rawBody}`);
  }

  return body.data as T;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function openMentionPanel(page: Page): Promise<void> {
  await focusEditor(page);
  await page.keyboard.type('@', { delay: 20 });
  await expect(mentionPanel(page)).toBeVisible({ timeout: 15000 });
}

async function searchMentionsInEditor(page: Page, query: string): Promise<void> {
  await openMentionPanel(page);
  await page.keyboard.type(query, { delay: 30 });
}

async function searchMentionsAtCurrentSelection(page: Page, query: string): Promise<void> {
  await page.keyboard.type('@', { delay: 20 });
  await expect(mentionPanel(page)).toBeVisible({ timeout: 15000 });
  await page.keyboard.type(query, { delay: 30 });
}

async function focusParagraphBelowLinkedDatabase(page: Page): Promise<void> {
  const blockId = await page.evaluate(() => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: {
        children?: Array<{ type?: string; blockId?: string; children?: unknown[] }>;
      };
      __TEST_CUSTOM_EDITOR__?: {
        addBelowBlock?: (editor: unknown, blockId: string, type: string, data: Record<string, never>) => string | void;
      };
    };
    const editor = testWindow.__TEST_EDITOR__;
    const customEditor = testWindow.__TEST_CUSTOM_EDITOR__;
    const linkedDatabaseBlock = editor?.children?.find((node) => node.type === 'grid');

    if (!editor || !customEditor?.addBelowBlock || !linkedDatabaseBlock?.blockId) {
      return null;
    }

    return customEditor.addBelowBlock(editor, linkedDatabaseBlock.blockId, 'paragraph', {}) ?? null;
  });

  if (!blockId) {
    throw new Error('Unable to create a paragraph below the linked database for mention search');
  }

  const paragraph = BlockSelectors.blockByType(page, 'paragraph').last();

  await expect(paragraph).toBeVisible({ timeout: 15000 });
  await paragraph.click({ force: true });
  await page.waitForTimeout(200);
}

async function focusEditor(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]').last();

  if ((await dialog.count()) > 0) {
    const scrollContainer = page.locator('.MuiDialog-paper .appflowy-scroll-container').last();

    if ((await scrollContainer.count()) > 0) {
      await scrollContainer.evaluate((el) => el.scrollTo(0, 9999));
      await page.waitForTimeout(500);
    }

    const editor = dialog.locator('[data-testid="editor-content"]').first();
    const placeholder = dialog.getByText('Enter a / to insert a block, or start typing').last();

    await expect(editor).toBeVisible({ timeout: 15000 });

    if ((await placeholder.count()) > 0 && (await placeholder.isVisible().catch(() => false))) {
      await placeholder.click({ force: true });
    } else {
      await editor.click({ force: true });
    }

    await page.waitForTimeout(200);
    return;
  }

  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ force: true });
  await page.waitForTimeout(200);
}

function mentionPanel(page: Page) {
  return page.getByTestId('mention-panel');
}

function getState(page: Page): MentionFixtureState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Mention fixture state is not initialized for this page');
  }

  return state;
}

function requireWorkspaceId(state: MentionFixtureState): string {
  if (!state.workspaceId) {
    throw new Error('Mention fixture workspace ID is not initialized');
  }

  return state.workspaceId;
}

function requireOwnerToken(state: MentionFixtureState): string {
  if (!state.ownerToken) {
    throw new Error('Mention fixture owner token is not initialized');
  }

  return state.ownerToken;
}

function requireMentionRequests(state: MentionFixtureState): RecordedMentionRequest[] {
  if (!state.mentionRequests) {
    throw new Error('Mention search requests are not being recorded');
  }

  return state.mentionRequests;
}

function isMentionSearchRequest(request: Request): boolean {
  return request.method() === 'POST' && request.url().includes('/mentions/search');
}

// Mention searches that failed without a response explain a missing stream header: the page sends a
// search again without the headers when a CORS preflight rejects them, as a Cloud nginx.conf whose
// $cors_headers lacks x-request-time and x-request-stream-id does for a Web on another origin.
function mentionFailureHint(state: MentionFixtureState): string {
  const failed = state.failedMentionRequests ?? [];

  if (failed.length === 0) return 'No mention request failed without a response.';

  return (
    `${failed.length} mention request(s) failed without a response (${[...new Set(failed)].join(', ')}). ` +
    'A CORS preflight that rejects x-request-time and x-request-stream-id makes the page send ' +
    'mention searches without them.'
  );
}

function isDatabaseRowOnlyRecordedRequest(request: RecordedMentionRequest): boolean {
  const include = request.body?.include;

  return Array.isArray(include) && include.length === 1 && include[0] === 'database_row';
}

function requireSectionsQuery(state: MentionFixtureState): string {
  if (!state.sectionsQuery) {
    throw new Error('The stubbed sections mention answer is not initialized');
  }

  return state.sectionsQuery;
}

function requireSectionsDatabaseTitle(state: MentionFixtureState): string {
  if (!state.sectionsDatabaseTitle) {
    throw new Error('The stubbed sections mention answer is not initialized');
  }

  return state.sectionsDatabaseTitle;
}

function requireFreshPage(state: MentionFixtureState): { id: string; title: string } {
  if (!state.freshPage) {
    throw new Error('No fresh fixture page was created');
  }

  return state.freshPage;
}

function requireRecentPages(state: MentionFixtureState): { id: string; title: string }[] {
  if (!state.recentPages || state.recentPages.length < 2) {
    throw new Error('The stubbed recent mention pages are not initialized');
  }

  return state.recentPages;
}

function requireRowKeyword(state: MentionFixtureState): string {
  if (!state.rowKeyword) {
    throw new Error('Mention fixture row keyword is not initialized');
  }

  return state.rowKeyword;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireDatabaseId(state: MentionFixtureState): string {
  if (!state.databaseId) {
    throw new Error('Mention fixture database ID is not initialized');
  }

  return state.databaseId;
}

function requireRowId(state: MentionFixtureState): string {
  if (!state.rowId) {
    throw new Error('Mention fixture row ID is not initialized');
  }

  return state.rowId;
}
