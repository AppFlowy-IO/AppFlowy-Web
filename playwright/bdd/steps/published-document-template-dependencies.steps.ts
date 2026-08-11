import { APIRequestContext, BrowserContext, expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp, signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  databaseBlocks,
  editFirstGridCell,
  editorForView,
  firstGridCellText,
  insertInlineGridViaSlash,
  insertLinkedGridViaSlash,
} from '../../support/duplicate-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { ShareSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const FIXTURE_EMAIL = 'duplicate@appflowy.io';
const FIXTURE_PASSWORD = 'AppFlowy!@123';
const PERMANENTLY_DELETED_TEXT = 'This referenced database was permanently deleted';
const NO_ACCESS_TEXT = 'No access';
const NO_PERMISSION_TEXT = "You don't have permission to view this database";

const ViewLayout = {
  Document: 0,
} as const;

type ApiResponse<T> = {
  code?: number;
  data?: T;
  message?: string;
};

type WorkspaceView = {
  view_id: string;
  name: string;
  layout?: number;
  extra?: {
    database_id?: string;
    is_database_container?: boolean;
  };
  children?: WorkspaceView[];
};

type CreatePageResponse = {
  view_id: string;
  database_id?: string;
};

type DuplicateResult = {
  view_id: string;
  database_mappings: Record<string, string[]>;
};

type DatabaseBlockIdentity = {
  databaseId: string;
  viewId: string;
  parentId: string;
};

type PublishedDocumentTemplateState = {
  publisherToken?: string;
  publisherWorkspaceId?: string;
  publisherGeneralSpaceId?: string;
  sourceDocumentId?: string;
  sourceDocumentName?: string;
  sourceDatabaseIdentity?: DatabaseBlockIdentity;
  inlineRowMarker?: string;
  duplicatedInlineRowMarker?: string;
  referencedPageId?: string;
  referencedPageName?: string;
  referencedPageMarker?: string;
  publishedUrl?: string;
  consumerContext?: BrowserContext;
  consumerPage?: Page;
  consumerToken?: string;
  consumerWorkspaceId?: string;
  duplicateResult?: DuplicateResult;
  publisherRoots: string[];
  consumerRoots: string[];
};

const stateByPage = new WeakMap<Page, PublishedDocumentTemplateState>();

Before({ tags: '@published-document-template-dependencies' }, async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {
    publisherRoots: [],
    consumerRoots: [],
  });
});

After({ tags: '@published-document-template-dependencies' }, async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state) return;

  const cleanupErrors: string[] = [];

  await cleanupConsumerCopies(request, state).catch((error) => {
    cleanupErrors.push(`consumer cleanup: ${errorMessage(error)}`);
  });
  await cleanupPublisherPages(request, state).catch((error) => {
    cleanupErrors.push(`publisher cleanup: ${errorMessage(error)}`);
  });
  await state.consumerContext?.close().catch((error) => {
    cleanupErrors.push(`consumer context cleanup: ${errorMessage(error)}`);
  });

  stateByPage.delete(page);

  if (cleanupErrors.length > 0) {
    throw new Error(`Published document template teardown failed:\n${cleanupErrors.join('\n')}`);
  }
});

Given('I sign in as the seeded document dependency publisher', async ({ page, request }) => {
  const state = getState(page);

  // Fixture source:
  // AppFlowy-Cloud-Premium/tests/workspace/page_view/duplication_test.rs
  // - duplicate_preconfigured_document_with_linked_and_inline_databases
  // - duplicate_preconfigured_database_row_docs_preserve_linked_and_inline_semantics
  await signInWithPasswordViaUi(page, FIXTURE_EMAIL, FIXTURE_PASSWORD, 3000);
  await expect(page).toHaveURL(/\/app\//, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

  state.publisherToken = await requireAuthToken(page);
  state.publisherWorkspaceId = workspaceIdFromAppUrl(page.url());

  const workspaceRoot = await getWorkspaceView(
    request,
    state.publisherToken,
    state.publisherWorkspaceId,
    state.publisherWorkspaceId,
    2
  );
  const generalSpace = workspaceRoot.children?.find((view) => view.name === 'General');

  if (!generalSpace) {
    throw new Error('The seeded document dependency fixture has no General space');
  }

  state.publisherGeneralSpaceId = generalSpace.view_id;
});

Given(
  'a temporary document template contains a referenced view of database {string}',
  async ({ page, request }, databaseName: string) => {
    const state = getState(page);
    const source = await createTemporaryDocument(page, request, state, 'referenced database');

    await insertLinkedGridViaSlash(page, source.view_id, databaseName);

    const sourceBlock = firstDatabaseBlock(page, source.view_id);

    await expect(sourceBlock).toBeVisible({ timeout: 30000 });
    state.sourceDatabaseIdentity = await requireDatabaseBlockIdentity(page, source.view_id);
  }
);

Given('the source referenced database shows {string}', async ({ page }, expectedRow: string) => {
  const state = getState(page);
  const sourceDocumentId = requireValue(state.sourceDocumentId, 'source document id');

  await expect(firstDatabaseBlock(page, sourceDocumentId)).toContainText(expectedRow, { timeout: 60000 });
});

Given(
  'a temporary document template contains an inline database with identifiable row data',
  async ({ page, request }) => {
    const state = getState(page);
    const source = await createTemporaryDocument(page, request, state, 'inline database');
    const marker = `BDD inline template row ${Date.now()}`;

    await insertInlineGridViaSlash(page, source.view_id);

    const sourceBlock = firstDatabaseBlock(page, source.view_id);

    await expect(sourceBlock).toBeVisible({ timeout: 30000 });
    await editFirstGridCell(page, sourceBlock, marker);

    state.inlineRowMarker = marker;
    state.sourceDatabaseIdentity = await requireDatabaseBlockIdentity(page, source.view_id);

    // Reload before publishing so this scenario proves the block and row reached
    // the server rather than duplicating unsaved browser state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(firstDatabaseBlock(page, source.view_id)).toContainText(marker, { timeout: 60000 });
  }
);

Given('a temporary document template contains a reference to another temporary page', async ({ page, request }) => {
  const state = getState(page);
  const targetName = `BDD referenced page ${Date.now()}`;
  const targetMarker = `Referenced page body ${Date.now()}`;
  const target = await createDocumentViaApi(request, state, targetName, targetMarker);
  const source = await createTemporaryDocument(page, request, state, 'page reference');

  state.referencedPageId = target.view_id;
  state.referencedPageName = targetName;
  state.referencedPageMarker = targetMarker;
  registerPublisherRoot(state, target.view_id);

  const slateEditor = page.locator('[data-slate-editor="true"]').first();
  const targetUrl = `${new URL(page.url()).origin}/app/${requireValue(
    state.publisherWorkspaceId,
    'publisher workspace id'
  )}/${target.view_id}`;

  await expect(slateEditor).toBeVisible({ timeout: 30000 });
  await slateEditor.click({ force: true });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async (url) => navigator.clipboard.writeText(url), targetUrl);
  await page.keyboard.press(`${modifierKey()}+V`);

  const mention = page.locator(`.mention-inline[data-mention-id="${target.view_id}"]`);

  await expect(mention).toBeVisible({ timeout: 30000 });
  await expect(mention.locator('.mention-content')).toContainText(targetName, { timeout: 30000 });

  // A reload is the persistence boundary used by the template publish below.
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator(`.mention-inline[data-mention-id="${target.view_id}"]`)).toBeVisible({
    timeout: 30000,
  });
});

Given(
  'a temporary document template contains a referenced view of nested fixture database {string}',
  async ({ page, request }, databaseName: string) => {
    const state = getState(page);
    const source = await createTemporaryDocument(page, request, state, 'nested referenced database');

    await insertLinkedGridViaSlash(page, source.view_id, databaseName);

    const sourceBlock = firstDatabaseBlock(page, source.view_id);

    await expect(sourceBlock).toBeVisible({ timeout: 30000 });
    state.sourceDatabaseIdentity = await requireDatabaseBlockIdentity(page, source.view_id);
  }
);

Given(
  'the source referenced database contains nested rows {string} and {string}',
  async ({ page }, linkedRow: string, inlineRow: string) => {
    const state = getState(page);
    const sourceDocumentId = requireValue(state.sourceDocumentId, 'source document id');
    const sourceBlock = firstDatabaseBlock(page, sourceDocumentId);

    await expect(sourceBlock).toContainText(linkedRow, { timeout: 60000 });
    await expect(sourceBlock).toContainText(inlineRow, { timeout: 60000 });

    // Validate the seeded precondition so a later failure cannot be attributed
    // to stale or incomplete fixture data.
    await expectNestedRowDatabaseAvailable(page, sourceBlock, linkedRow);
    await closeRowDetailWithEscape(page);
    await expectNestedRowDatabaseAvailable(page, sourceBlock, inlineRow);
    await closeRowDetailWithEscape(page);
  }
);

When('I publish only the temporary document template', async ({ page }) => {
  const state = getState(page);
  const sourceDocumentId = requireValue(state.sourceDocumentId, 'source document id');

  state.publishedUrl = await publishCurrentDocument(
    page,
    requireValue(state.publisherWorkspaceId, 'publisher workspace id'),
    sourceDocumentId
  );
});

When(
  'a different account starts with the published document template in {string}',
  async ({ page, request, browser }, destinationSpaceName: string) => {
    const state = getState(page);
    const publishedUrl = requireValue(state.publishedUrl, 'published URL');
    const consumerEmail = generateRandomEmail();

    expect(consumerEmail).not.toBe(FIXTURE_EMAIL);

    const consumerContext = await browser.newContext({
      baseURL: new URL(publishedUrl).origin,
      viewport: { width: 1440, height: 900 },
    });
    const consumerPage = await consumerContext.newPage();

    state.consumerContext = consumerContext;
    state.consumerPage = consumerPage;
    setupPageErrorHandling(consumerPage);

    await signInAndWaitForApp(consumerPage, request, consumerEmail);

    state.consumerToken = await requireAuthToken(consumerPage);
    state.consumerWorkspaceId = workspaceIdFromAppUrl(consumerPage.url());

    const consumerWorkspaceRoot = await getWorkspaceView(
      request,
      state.consumerToken,
      state.consumerWorkspaceId,
      state.consumerWorkspaceId,
      2
    );
    const destinationSpace = consumerWorkspaceRoot.children?.find((view) => view.name === destinationSpaceName);

    if (!destinationSpace) {
      throw new Error(`The consumer workspace has no ${destinationSpaceName} space`);
    }

    await consumerPage.goto(publishedUrl, { waitUntil: 'domcontentloaded' });

    const startWithTemplate = consumerPage.getByRole('button', { name: 'Start with this template' });

    await expect(startWithTemplate).toBeVisible({ timeout: 60000 });
    await startWithTemplate.click();

    const destinationDialog = consumerPage.getByRole('dialog').filter({ hasText: 'Where would you like to add' }).last();

    await expect(destinationDialog).toBeVisible({ timeout: 30000 });

    const destinationSpaceItem = destinationDialog
      .getByTestId('space-item')
      .filter({ hasText: destinationSpaceName })
      .first();

    await expect(destinationSpaceItem).toBeVisible({ timeout: 30000 });
    await destinationSpaceItem.click();

    const addButton = destinationDialog.getByRole('button', { name: 'Add', exact: true });

    await expect(addButton).toBeEnabled({ timeout: 15000 });

    const duplicateResponsePromise = consumerPage.waitForResponse(
      (response) => {
        const url = new URL(response.url());

        return (
          response.request().method() === 'POST' &&
          url.pathname === `/api/workspace/${state.consumerWorkspaceId}/published-duplicate`
        );
      },
      { timeout: 90000 }
    );

    await addButton.click();

    const duplicateResponse = await duplicateResponsePromise;
    const responseBody = (await duplicateResponse.json().catch(() => null)) as ApiResponse<DuplicateResult> | null;

    expect(
      duplicateResponse.ok() && responseBody?.code === 0 && responseBody.data,
      `Published document template duplication failed with HTTP ${duplicateResponse.status()}: ${JSON.stringify(
        responseBody
      )}`
    ).toBeTruthy();

    state.duplicateResult = responseBody!.data!;
    state.consumerRoots.push(responseBody!.data!.view_id);

    const openInBrowser = consumerPage.getByRole('button', { name: /Open in browser/i });

    await expect(openInBrowser).toBeVisible({ timeout: 30000 });
    await openInBrowser.click();
    await expect(consumerPage).toHaveURL(/\/app\//, { timeout: 30000 });
    await expect(editorForView(consumerPage, responseBody!.data!.view_id)).toBeVisible({ timeout: 60000 });
  }
);

Then('the duplicated referenced database shows {string}', async ({ page }, expectedRow: string) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);
  const duplicatedBlock = firstDatabaseBlock(consumerPage, duplicateResult.view_id);

  await expectDatabaseBlockAvailable(consumerPage, duplicatedBlock, expectedRow);

  const duplicatedIdentity = await requireDatabaseBlockIdentity(consumerPage, duplicateResult.view_id);
  const sourceIdentity = requireValue(state.sourceDatabaseIdentity, 'source database identity');

  expect(duplicatedIdentity.databaseId).not.toBe(sourceIdentity.databaseId);
  expect(Object.keys(duplicateResult.database_mappings)).toContain(duplicatedIdentity.databaseId);
});

Then('the duplicated referenced database remains available after reload', async ({ page }) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);

  await reloadDuplicatedDocument(consumerPage, state);
  await expectDatabaseBlockAvailable(consumerPage, firstDatabaseBlock(consumerPage, duplicateResult.view_id));
});

Then('the duplicated inline database has an independent database identity', async ({ page }) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);
  const sourceDocumentId = requireValue(state.sourceDocumentId, 'source document id');
  const sourceIdentity = requireValue(state.sourceDatabaseIdentity, 'source database identity');
  const sourceMarker = requireValue(state.inlineRowMarker, 'inline row marker');
  const duplicatedBlock = firstDatabaseBlock(consumerPage, duplicateResult.view_id);

  await expectDatabaseBlockAvailable(consumerPage, duplicatedBlock, sourceMarker);

  const duplicatedIdentity = await requireDatabaseBlockIdentity(consumerPage, duplicateResult.view_id);

  expect(duplicatedIdentity.databaseId).not.toBe(sourceIdentity.databaseId);
  expect(Object.keys(duplicateResult.database_mappings)).toContain(duplicatedIdentity.databaseId);

  const duplicatedMarker = `Edited only in consumer ${Date.now()}`;

  await editFirstGridCell(consumerPage, duplicatedBlock, duplicatedMarker);
  state.duplicatedInlineRowMarker = duplicatedMarker;

  // Prove this is a deep copy, not merely a working reference to the source DB.
  await page.goto(`/app/${requireValue(state.publisherWorkspaceId, 'publisher workspace id')}/${sourceDocumentId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(firstDatabaseBlock(page, sourceDocumentId)).toContainText(sourceMarker, { timeout: 60000 });
  expect(await firstGridCellText(firstDatabaseBlock(page, sourceDocumentId))).not.toContain(duplicatedMarker);
});

Then('the duplicated inline database row remains available after reload', async ({ page }) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);
  const expectedMarker = requireValue(state.duplicatedInlineRowMarker, 'duplicated inline row marker');

  await reloadDuplicatedDocument(consumerPage, state);
  await expectDatabaseBlockAvailable(
    consumerPage,
    firstDatabaseBlock(consumerPage, duplicateResult.view_id),
    expectedMarker
  );
});

Then('the duplicated page reference points to a new accessible page copy', async ({ page, request }) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);
  const sourceReferenceId = requireValue(state.referencedPageId, 'source referenced page id');
  const referenceName = requireValue(state.referencedPageName, 'referenced page name');
  const referenceMarker = requireValue(state.referencedPageMarker, 'referenced page marker');
  const mention = editorForView(consumerPage, duplicateResult.view_id).locator('.mention-inline').first();

  await expect(mention).toBeVisible({ timeout: 60000 });

  const duplicatedReferenceId = await mention.getAttribute('data-mention-id');

  expect(duplicatedReferenceId, 'The duplicated mention must have a page id').toBeTruthy();
  expect(
    duplicatedReferenceId,
    'The duplicated mention must point to a new destination page instead of the publisher page'
  ).not.toBe(sourceReferenceId);
  await expect(mention).toContainText(referenceName, { timeout: 30000 });

  const duplicatedSubtree = await getWorkspaceView(
    request,
    requireValue(state.consumerToken, 'consumer token'),
    requireValue(state.consumerWorkspaceId, 'consumer workspace id'),
    duplicateResult.view_id,
    2
  );
  const duplicatedReference = findView(duplicatedSubtree, duplicatedReferenceId!);

  expect(duplicatedReference?.name).toBe(referenceName);

  await mention.click({ force: true });
  await expect(consumerPage.getByText(referenceMarker, { exact: true })).toBeVisible({ timeout: 60000 });
});

Then(
  'the duplicated referenced database contains nested rows {string} and {string}',
  async ({ page }, linkedRow: string, inlineRow: string) => {
    const state = getState(page);
    const consumerPage = requireConsumerPage(state);
    const duplicateResult = requireDuplicateResult(state);
    const duplicatedBlock = firstDatabaseBlock(consumerPage, duplicateResult.view_id);

    await expectDatabaseBlockAvailable(consumerPage, duplicatedBlock, linkedRow);
    await expect(duplicatedBlock).toContainText(inlineRow, { timeout: 60000 });

    const duplicatedIdentity = await requireDatabaseBlockIdentity(consumerPage, duplicateResult.view_id);
    const sourceIdentity = requireValue(state.sourceDatabaseIdentity, 'source database identity');

    expect(duplicatedIdentity.databaseId).not.toBe(sourceIdentity.databaseId);
    expect(Object.keys(duplicateResult.database_mappings)).toContain(duplicatedIdentity.databaseId);
  }
);

Then('row {string} has an available nested referenced database', async ({ page }, rowName: string) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);

  await expectNestedRowDatabaseAvailable(
    consumerPage,
    firstDatabaseBlock(consumerPage, duplicateResult.view_id),
    rowName
  );
  await closeRowDetailWithEscape(consumerPage);
});

Then('row {string} has an available nested inline database', async ({ page }, rowName: string) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);

  await expectNestedRowDatabaseAvailable(
    consumerPage,
    firstDatabaseBlock(consumerPage, duplicateResult.view_id),
    rowName
  );
  await closeRowDetailWithEscape(consumerPage);
});

Then('the nested database in row {string} remains available after reload', async ({ page }, rowName: string) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const duplicateResult = requireDuplicateResult(state);

  await reloadDuplicatedDocument(consumerPage, state);

  const duplicatedBlock = firstDatabaseBlock(consumerPage, duplicateResult.view_id);

  await expectNestedRowDatabaseAvailable(consumerPage, duplicatedBlock, rowName);
  await closeRowDetailWithEscape(consumerPage);
});

async function createTemporaryDocument(
  page: Page,
  request: APIRequestContext,
  state: PublishedDocumentTemplateState,
  label: string
): Promise<CreatePageResponse> {
  const sourceName = `BDD published ${label} ${Date.now()}`;
  const sourceMarker = `${sourceName} body`;
  const source = await createDocumentViaApi(request, state, sourceName, sourceMarker);

  state.sourceDocumentId = source.view_id;
  state.sourceDocumentName = sourceName;
  registerPublisherRoot(state, source.view_id);

  await page.goto(`/app/${requireValue(state.publisherWorkspaceId, 'publisher workspace id')}/${source.view_id}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(editorForView(page, source.view_id)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(sourceMarker, { exact: true })).toBeVisible({ timeout: 30000 });

  return source;
}

async function createDocumentViaApi(
  request: APIRequestContext,
  state: PublishedDocumentTemplateState,
  name: string,
  marker: string
): Promise<CreatePageResponse> {
  return postApi<CreatePageResponse>(
    request,
    requireValue(state.publisherToken, 'publisher token'),
    `/api/workspace/${requireValue(state.publisherWorkspaceId, 'publisher workspace id')}/page-view`,
    {
      parent_view_id: requireValue(state.publisherGeneralSpaceId, 'publisher General space id'),
      layout: ViewLayout.Document,
      name,
      page_data: {
        type: 'page',
        children: [
          {
            type: 'paragraph',
            data: {
              delta: [{ insert: marker }],
            },
          },
        ],
      },
    }
  );
}

async function publishCurrentDocument(page: Page, workspaceId: string, documentViewId: string): Promise<string> {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 30000 });
  await ShareSelectors.shareButton(page).click({ force: true });

  const sharePopover = ShareSelectors.sharePopover(page);

  await expect(sharePopover).toBeVisible({ timeout: 15000 });
  await sharePopover.getByText('Publish', { exact: true }).click({ force: true });

  const publishButton = ShareSelectors.publishConfirmButton(page);

  await expect(publishButton).toBeEnabled({ timeout: 30000 });

  const publishResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());

      return (
        response.request().method() === 'POST' &&
        url.pathname === `/api/workspace/${workspaceId}/page-view/${documentViewId}/publish`
      );
    },
    { timeout: 90000 }
  );

  await publishButton.click({ force: true });

  const publishResponse = await publishResponsePromise;

  expect(
    publishResponse.ok(),
    `Publishing document ${documentViewId} failed with HTTP ${publishResponse.status()}`
  ).toBeTruthy();
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 60000 });

  const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  expect(namespace, 'Expected the publisher to have a publish namespace').not.toBe('');
  expect(publishName, 'Expected the document to have a publish name').not.toBe('');

  const publishedUrl = `${new URL(page.url()).origin}/${namespace}/${publishName}`;

  await page.keyboard.press('Escape');
  return publishedUrl;
}

async function reloadDuplicatedDocument(page: Page, state: PublishedDocumentTemplateState): Promise<void> {
  const duplicateResult = requireDuplicateResult(state);
  const workspaceId = requireValue(state.consumerWorkspaceId, 'consumer workspace id');

  await page.goto(`/app/${workspaceId}/${duplicateResult.view_id}`, { waitUntil: 'domcontentloaded' });
  await expect(editorForView(page, duplicateResult.view_id)).toBeVisible({ timeout: 60000 });
}

function firstDatabaseBlock(page: Page, documentViewId: string): Locator {
  return databaseBlocks(editorForView(page, documentViewId)).first();
}

async function expectDatabaseBlockAvailable(page: Page, block: Locator, expectedText?: string): Promise<void> {
  await expect(block).toBeVisible({ timeout: 60000 });
  await expect(block.locator('[data-testid="database-grid"]')).toBeVisible({ timeout: 60000 });

  if (expectedText) {
    await expect(block).toContainText(expectedText, { timeout: 60000 });
  }

  await expect(block.getByText(PERMANENTLY_DELETED_TEXT, { exact: true })).toHaveCount(0);
  await expect(block.getByText(NO_ACCESS_TEXT, { exact: true })).toHaveCount(0);
  await expect(block.getByText(NO_PERMISSION_TEXT, { exact: true })).toHaveCount(0);

  // `page` is deliberately part of this helper's signature so failures report
  // the active URL, which is useful when the copied document unexpectedly
  // navigates to a stale source view.
  expect(page.url()).toContain('/app/');
}

async function expectNestedRowDatabaseAvailable(page: Page, outerDatabase: Locator, rowName: string): Promise<void> {
  await expectDatabaseBlockAvailable(page, outerDatabase, rowName);

  const row = outerDatabase.locator('[data-testid^="grid-row-"]').filter({ hasText: rowName }).first();

  await expect(row).toBeVisible({ timeout: 60000 });
  await row.scrollIntoViewIfNeeded();
  await row.hover({ force: true });

  const scopedExpandButton = row.getByTestId('row-expand-button');
  const expandButton =
    (await scopedExpandButton.count()) > 0 ? scopedExpandButton.first() : page.getByTestId('row-expand-button').first();

  await expect(expandButton).toBeVisible({ timeout: 15000 });
  await expandButton.click({ force: true });

  const dialog = page.getByRole('dialog').last();

  await expect(dialog).toBeVisible({ timeout: 30000 });

  const scrollContainer = dialog.locator('.appflowy-scroll-container').last();

  if ((await scrollContainer.count()) > 0) {
    await scrollContainer.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  }

  const nestedDatabase = dialog.locator('.appflowy-database').last();

  await expect(nestedDatabase).toBeVisible({ timeout: 60000 });
  await expect(nestedDatabase.locator('[data-testid="database-grid"]')).toBeVisible({ timeout: 60000 });
  await expect(dialog.getByText(PERMANENTLY_DELETED_TEXT, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(NO_ACCESS_TEXT, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(NO_PERMISSION_TEXT, { exact: true })).toHaveCount(0);
}

async function requireDatabaseBlockIdentity(page: Page, documentViewId: string): Promise<DatabaseBlockIdentity> {
  await expect
    .poll(() => databaseBlockIdentity(page, documentViewId), {
      timeout: 30000,
      message: `Expected document ${documentViewId} to expose a database block identity`,
    })
    .not.toBeNull();

  const identity = await databaseBlockIdentity(page, documentViewId);

  if (!identity) {
    throw new Error(`Document ${documentViewId} has no database block identity`);
  }

  return identity;
}

async function databaseBlockIdentity(page: Page, documentViewId: string): Promise<DatabaseBlockIdentity | null> {
  return page.evaluate((viewId) => {
    type EditorNode = {
      type?: string;
      data?: {
        database_id?: unknown;
        view_id?: unknown;
        view_ids?: unknown;
        parent_id?: unknown;
      };
      children?: EditorNode[];
    };

    const testWindow = window as Window & {
      __TEST_EDITORS__?: Record<string, { children?: EditorNode[] }>;
    };
    const editor = testWindow.__TEST_EDITORS__?.[viewId];
    const queue = [...(editor?.children ?? [])];

    while (queue.length > 0) {
      const node = queue.shift()!;

      if (node.type === 'grid') {
        const data = node.data;
        const databaseId = typeof data?.database_id === 'string' ? data.database_id : '';
        const scalarViewId = typeof data?.view_id === 'string' ? data.view_id : '';
        const arrayViewId = Array.isArray(data?.view_ids)
          ? data.view_ids.find((value): value is string => typeof value === 'string') ?? ''
          : '';
        const parentId = typeof data?.parent_id === 'string' ? data.parent_id : '';

        if (databaseId && (scalarViewId || arrayViewId) && parentId) {
          return {
            databaseId,
            viewId: scalarViewId || arrayViewId,
            parentId,
          };
        }
      }

      queue.push(...(node.children ?? []));
    }

    return null;
  }, documentViewId);
}

async function getWorkspaceView(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  viewId: string,
  depth: number
): Promise<WorkspaceView> {
  return getApi<WorkspaceView>(request, token, `/api/workspace/${workspaceId}/view/${viewId}?depth=${depth}`);
}

async function getApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`GET ${path} failed with HTTP ${response.status()}: ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function postApi<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data?: Record<string, unknown>
): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`POST ${path} failed with HTTP ${response.status()}: ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function cleanupConsumerCopies(request: APIRequestContext, state: PublishedDocumentTemplateState): Promise<void> {
  if (!state.consumerToken || !state.consumerWorkspaceId) return;

  for (const viewId of unique(state.consumerRoots)) {
    await deleteWorkspaceView(request, state.consumerToken, state.consumerWorkspaceId, viewId);
  }
}

async function cleanupPublisherPages(request: APIRequestContext, state: PublishedDocumentTemplateState): Promise<void> {
  if (!state.publisherToken || !state.publisherWorkspaceId) return;

  const roots = unique([...(state.sourceDocumentId ? [state.sourceDocumentId] : []), ...state.publisherRoots]);

  for (const viewId of roots) {
    await deleteWorkspaceView(request, state.publisherToken, state.publisherWorkspaceId, viewId);
  }
}

async function deleteWorkspaceView(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  viewId: string
): Promise<void> {
  const moveResponse = await request.post(
    `${TestConfig.apiUrl}/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`,
    {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    }
  );

  if (moveResponse.status() === 404) return;

  const moveBody = (await moveResponse.json().catch(() => null)) as ApiResponse<unknown> | null;

  if (!moveResponse.ok() || moveBody?.code !== 0) {
    throw new Error(`Moving ${viewId} to trash failed with HTTP ${moveResponse.status()}: ${JSON.stringify(moveBody)}`);
  }

  const deleteResponse = await request.delete(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/trash/${viewId}`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const deleteBody = (await deleteResponse.json().catch(() => null)) as ApiResponse<unknown> | null;

  if (deleteResponse.status() !== 404 && (!deleteResponse.ok() || deleteBody?.code !== 0)) {
    throw new Error(
      `Deleting ${viewId} from trash failed with HTTP ${deleteResponse.status()}: ${JSON.stringify(deleteBody)}`
    );
  }
}

async function requireAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const rawToken = localStorage.getItem('token');

    if (rawToken) {
      try {
        const parsed = JSON.parse(rawToken) as { access_token?: string };

        if (parsed.access_token) return parsed.access_token;
      } catch {
        // Fall back to the test-only token mirror below.
      }
    }

    return localStorage.getItem('af_auth_token') ?? '';
  });

  if (!token) throw new Error('The signed-in browser has no access token');
  return token;
}

function registerPublisherRoot(state: PublishedDocumentTemplateState, viewId: string): void {
  if (!state.publisherRoots.includes(viewId)) {
    state.publisherRoots.push(viewId);
  }
}

function workspaceIdFromAppUrl(urlValue: string): string {
  const segments = new URL(urlValue).pathname.split('/').filter(Boolean);
  const appIndex = segments.indexOf('app');
  const workspaceId = appIndex >= 0 ? segments[appIndex + 1] : undefined;

  if (!workspaceId) throw new Error(`Could not read a workspace id from ${urlValue}`);
  return workspaceId;
}

function findView(root: WorkspaceView, viewId: string): WorkspaceView | undefined {
  if (root.view_id === viewId) return root;

  for (const child of root.children ?? []) {
    const found = findView(child, viewId);

    if (found) return found;
  }

  return undefined;
}

function modifierKey(): 'Meta' | 'Control' {
  return process.platform === 'darwin' ? 'Meta' : 'Control';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function getState(page: Page): PublishedDocumentTemplateState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Published document template dependency scenario state is missing');
  return state;
}

function requireConsumerPage(state: PublishedDocumentTemplateState): Page {
  return requireValue(state.consumerPage, 'consumer page');
}

function requireDuplicateResult(state: PublishedDocumentTemplateState): DuplicateResult {
  return requireValue(state.duplicateResult, 'published document duplicate result');
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
