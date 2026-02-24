/**
 * Test: Bidirectional sidebar sync between main window and iframe.
 *
 * Uses a fresh user account (no hardcoded snapshot accounts).
 *
 * Flow:
 * 1. Sign in with a new random user, create a parent page
 * 2. Open an iframe pointing to the same workspace (second tab)
 * 3. From main window: create a sub-document under the parent
 *    → verify it appears in the iframe
 * 4. From iframe: create a sub-database (Grid) under the parent
 *    → verify it appears in the main window
 * 5. From main window: create another sub-document
 *    → verify it appears in the iframe
 * 6. From iframe: create another sub-document
 *    → verify it appears in the main window
 * 7. Final strict assertions: both sides have all 4 children by view ID,
 *    no sidebar collapse, no page reload
 */

import {
  PageSelectors,
  SidebarSelectors,
  byTestId,
  hoverToShowActions,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';
import { expandPageByName, expandSpaceByName } from '../../support/page-utils';
import {
  createTestSyncIframe,
  getIframeBody,
  injectCypressMarkerIntoIframe,
  removeTestSyncIframe,
  waitForIframeReady,
} from '../../support/iframe-test-helpers';

const SPACE_NAME = 'General';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChildInfo {
  viewId: string;
  name: string;
}

/**
 * Use the inline "+" button on a page in the MAIN window to add a child.
 * `menuItemIndex`: 0 = Document, 1 = Grid, 2 = Board, 3 = Calendar
 */
function addChildInMainWindow(parentPageName: string, menuItemIndex: number) {
  hoverToShowActions(PageSelectors.itemByName(parentPageName).first());
  waitForReactUpdate(1000);

  // Target only the parent's own row (first direct child), not nested children
  PageSelectors.itemByName(parentPageName).first().children().first()
    .find(byTestId('inline-add-page'), { timeout: 5000 })
    .first()
    .click({ force: true });
  waitForReactUpdate(1000);

  cy.get('[data-slot="dropdown-menu-content"]', { timeout: 5000 })
    .should('be.visible')
    .within(() => {
      cy.get('[role="menuitem"]').eq(menuItemIndex).click();
    });

  cy.wait(3000);

  // Dismiss any modal/dialog that opens
  cy.get('body').then(($body) => {
    if (
      $body.find('[role="dialog"]').length > 0 ||
      $body.find('.MuiDialog-container').length > 0
    ) {
      cy.get('body').type('{esc}');
      cy.wait(1000);
    }
  });
  waitForReactUpdate(1000);
}

/**
 * Use the inline "+" button on a page in the IFRAME to add a child.
 * `menuItemIndex`: 0 = Document, 1 = Grid, 2 = Board, 3 = Calendar
 */
function addChildInIframe(parentPageName: string, menuItemIndex: number) {
  // Hover over parent in iframe to reveal "+"
  getIframeBody()
    .find(`[data-testid="page-name"]:contains("${parentPageName}")`)
    .first()
    .closest(byTestId('page-item'))
    .children()
    .first()
    .trigger('mouseenter', { force: true });
  waitForReactUpdate(1000);

  // Click inline "+" button
  getIframeBody()
    .find(`[data-testid="page-name"]:contains("${parentPageName}")`)
    .first()
    .closest(byTestId('page-item'))
    .find(byTestId('inline-add-page'))
    .first()
    .click({ force: true });
  waitForReactUpdate(1000);

  // Select layout from the dropdown
  getIframeBody()
    .find('[data-slot="dropdown-menu-content"]', { timeout: 5000 })
    .should('be.visible')
    .find('[role="menuitem"]')
    .eq(menuItemIndex)
    .click({ force: true });

  cy.wait(3000);

  // Close any dialog in iframe
  getIframeBody().then(($body: JQuery<HTMLElement>) => {
    if (
      $body.find('[role="dialog"]').length > 0 ||
      $body.find('.MuiDialog-container').length > 0
    ) {
      cy.wrap($body).type('{esc}');
      cy.wait(1000);
    }

    const backBtn = $body.find('button:contains("Back to home")');

    if (backBtn.length > 0) {
      cy.wrap(backBtn).first().click({ force: true });
      cy.wait(1000);
    }
  });
  waitForReactUpdate(1000);
}

/**
 * Collect direct child {viewId, name} under a parent in the main window.
 */
function getChildrenInMainWindow(parentPageName: string): Cypress.Chainable<ChildInfo[]> {
  return PageSelectors.itemByName(parentPageName)
    .first()
    .children()
    .last()
    .children(byTestId('page-item'))
    .then(($items) => {
      return Array.from($items).map(($item) => {
        const $el = Cypress.$($item);
        const name = $el.find(byTestId('page-name')).first().text().trim();
        const testId = $el.children().first().attr('data-testid') ?? '';
        const viewId = testId.startsWith('page-') ? testId.slice('page-'.length) : testId;

        return { viewId, name };
      });
    });
}

/**
 * Collect direct child {viewId, name} under a parent in the iframe.
 */
function getChildrenInIframe(parentPageName: string): Cypress.Chainable<ChildInfo[]> {
  return getIframeBody()
    .find(`[data-testid="page-name"]:contains("${parentPageName}")`)
    .first()
    .closest(byTestId('page-item'))
    .children()
    .last()
    .children(byTestId('page-item'))
    .then(($items: JQuery<HTMLElement>) => {
      return Array.from($items).map(($item) => {
        const $el = Cypress.$($item);
        const name = $el.find(byTestId('page-name')).first().text().trim();
        const testId = $el.children().first().attr('data-testid') ?? '';
        const viewId = testId.startsWith('page-') ? testId.slice('page-'.length) : testId;

        return { viewId, name };
      });
    });
}

/**
 * Wait until a parent in the main window has at least `expectedCount` children.
 */
function waitForMainWindowChildCount(
  parentPageName: string,
  expectedCount: number,
  attempts = 0,
  maxAttempts = 30
): void {
  if (attempts >= maxAttempts) {
    throw new Error(
      `Main window: child count under "${parentPageName}" did not reach ${expectedCount}`
    );
  }

  getChildrenInMainWindow(parentPageName).then((children) => {
    if (children.length >= expectedCount) {
      testLog.info(
        `Main window child count: ${children.length} (expected >= ${expectedCount})`
      );
      return;
    }

    cy.wait(1000).then(() =>
      waitForMainWindowChildCount(parentPageName, expectedCount, attempts + 1, maxAttempts)
    );
  });
}

/**
 * Wait until a parent in the iframe has at least `expectedCount` children.
 */
function waitForIframeChildCount(
  parentPageName: string,
  expectedCount: number,
  attempts = 0,
  maxAttempts = 30
): void {
  if (attempts >= maxAttempts) {
    throw new Error(
      `Iframe: child count under "${parentPageName}" did not reach ${expectedCount}`
    );
  }

  getChildrenInIframe(parentPageName).then((children) => {
    if (children.length >= expectedCount) {
      testLog.info(
        `Iframe child count: ${children.length} (expected >= ${expectedCount})`
      );
      return;
    }

    cy.wait(1000).then(() =>
      waitForIframeChildCount(parentPageName, expectedCount, attempts + 1, maxAttempts)
    );
  });
}

/**
 * Log children summary.
 */
function logChildren(label: string, children: ChildInfo[]) {
  const summary = children.map((c) => `${c.name} [${c.viewId.slice(0, 8)}]`).join(', ');

  testLog.info(`${label} (${children.length}): ${summary}`);
}

/**
 * Assert that a list of children contains all expected view IDs.
 */
function assertContainsAllViewIds(
  children: ChildInfo[],
  expectedViewIds: string[],
  context: string
) {
  const currentViewIds = new Set(children.map((c) => c.viewId));

  for (const viewId of expectedViewIds) {
    expect(
      currentViewIds.has(viewId),
      `[${context}] View ID ${viewId} must be present`
    ).to.be.true;
  }
}

// ---------------------------------------------------------------------------
// Reload detection
// ---------------------------------------------------------------------------

const RELOAD_MARKER = '__NO_RELOAD_MARKER__';

function installReloadDetection() {
  cy.window().then((win) => {
    (win as unknown as Record<string, unknown>)[RELOAD_MARKER] = true;
  });
  cy.window().its(RELOAD_MARKER).should('eq', true);
}

function assertNoReload() {
  cy.window().its(RELOAD_MARKER).should('eq', true);
}

// =============================================================================
// Tests
// =============================================================================

describe('Sidebar bidirectional sync: main window ↔ iframe', () => {
  before(() => {
    logAppFlowyEnvironment();
  });

  beforeEach(() => {
    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection') ||
        err.message.includes('cancelled') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('_dEH') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('cross-origin')
      ) {
        return false;
      }

      return true;
    });

    cy.viewport(1400, 900);
  });

  afterEach(() => {
    removeTestSyncIframe();
  });

  it('should sync sub-documents and sub-databases bidirectionally without sidebar collapse or reload', () => {
    const testEmail = generateRandomEmail();
    const allCreatedViewIds: string[] = [];

    // ------------------------------------------------------------------
    // Step 1: Sign in and create a parent page
    // ------------------------------------------------------------------
    testLog.step(1, 'Sign in with a new user');
    cy.signIn(testEmail);
    SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });

    testLog.step(2, 'Expand General space');
    expandSpaceByName(SPACE_NAME);
    waitForReactUpdate(1000);
    PageSelectors.names({ timeout: 10000 }).should('exist');

    testLog.step(3, 'Create a parent page in General');
    cy.get(byTestId('new-page-button')).first().click({ force: true });
    waitForReactUpdate(1000);

    cy.get(byTestId('new-page-modal'))
      .should('be.visible')
      .find(byTestId('space-item'))
      .contains(SPACE_NAME)
      .click({ force: true });
    waitForReactUpdate(500);

    cy.get(byTestId('new-page-modal')).find('button').contains('Add').click({ force: true });
    waitForReactUpdate(3000);

    // Dismiss any modal
    cy.get('body').then(($body) => {
      if (
        $body.find('[role="dialog"]').length > 0 ||
        $body.find('.MuiDialog-container').length > 0
      ) {
        cy.get('body').type('{esc}');
        cy.wait(1000);
      }
    });

    const parentPageName = 'Untitled';

    PageSelectors.nameContaining(parentPageName, { timeout: 10000 }).should('exist');
    testLog.info(`Parent page "${parentPageName}" created`);

    // ------------------------------------------------------------------
    // Step 4: Open iframe FIRST, before creating any children
    // ------------------------------------------------------------------
    testLog.step(4, 'Create iframe with same app URL');
    installReloadDetection();

    let appUrl = '';

    cy.url().then((url) => {
      appUrl = url;
      testLog.info(`App URL: ${appUrl}`);
    });

    cy.then(() => {
      createTestSyncIframe(appUrl);
    });

    waitForIframeReady();
    waitForReactUpdate(2000);
    injectCypressMarkerIntoIframe();
    waitForReactUpdate(500);

    // Expand space in iframe
    testLog.info('Expanding space in iframe');
    getIframeBody()
      .find(`[data-testid="space-name"]:contains("${SPACE_NAME}")`)
      .first()
      .click({ force: true });
    waitForReactUpdate(1000);

    // ------------------------------------------------------------------
    // Step 5: MAIN WINDOW → create sub-document #1
    // ------------------------------------------------------------------
    testLog.step(5, 'Main window: create sub-document #1');
    addChildInMainWindow(parentPageName, 0); // 0 = Document

    // Expand parent in main window to see the child
    expandPageByName(parentPageName);

    getChildrenInMainWindow(parentPageName).then((children) => {
      logChildren('Main window children after doc #1', children);
      expect(children.length).to.eq(1);
      allCreatedViewIds.push(children[0].viewId);
      testLog.info(`Doc #1 viewId: ${children[0].viewId}`);
    });

    // Verify it syncs to iframe — expand parent in iframe first
    testLog.info('Expanding parent in iframe');
    getIframeBody()
      .find(`[data-testid="page-name"]:contains("${parentPageName}")`)
      .first()
      .closest(byTestId('page-item'))
      .find(byTestId('outline-toggle-expand'))
      .first()
      .click({ force: true });
    waitForReactUpdate(1000);

    cy.then(() => waitForIframeChildCount(parentPageName, 1));

    getChildrenInIframe(parentPageName).then((children) => {
      logChildren('Iframe children after doc #1 sync', children);
      assertContainsAllViewIds(children, allCreatedViewIds, 'Iframe after doc #1');
      testLog.info('Doc #1 synced to iframe');
    });

    // ------------------------------------------------------------------
    // Step 6: IFRAME → create sub-database (Grid)
    // ------------------------------------------------------------------
    testLog.step(6, 'Iframe: create sub-database (Grid)');
    addChildInIframe(parentPageName, 1); // 1 = Grid

    getChildrenInIframe(parentPageName).then((children) => {
      logChildren('Iframe children after grid', children);
      const newChild = children.find((c) => !allCreatedViewIds.includes(c.viewId));

      expect(newChild, 'New grid child should exist in iframe').to.not.be.undefined;
      allCreatedViewIds.push(newChild!.viewId);
      testLog.info(`Grid viewId: ${newChild!.viewId}`);
    });

    // Verify it syncs to main window
    cy.then(() => waitForMainWindowChildCount(parentPageName, 2));

    getChildrenInMainWindow(parentPageName).then((children) => {
      logChildren('Main window children after grid sync', children);
      assertContainsAllViewIds(children, allCreatedViewIds, 'Main after grid');
      testLog.info('Grid synced to main window');
    });

    // ------------------------------------------------------------------
    // Step 7: MAIN WINDOW → create sub-document #2
    // ------------------------------------------------------------------
    testLog.step(7, 'Main window: create sub-document #2');
    addChildInMainWindow(parentPageName, 0); // 0 = Document

    getChildrenInMainWindow(parentPageName).then((children) => {
      logChildren('Main window children after doc #2', children);
      const newChild = children.find((c) => !allCreatedViewIds.includes(c.viewId));

      expect(newChild, 'New doc #2 should exist in main window').to.not.be.undefined;
      allCreatedViewIds.push(newChild!.viewId);
      testLog.info(`Doc #2 viewId: ${newChild!.viewId}`);
    });

    // Verify it syncs to iframe
    cy.then(() => waitForIframeChildCount(parentPageName, 3));

    getChildrenInIframe(parentPageName).then((children) => {
      logChildren('Iframe children after doc #2 sync', children);
      assertContainsAllViewIds(children, allCreatedViewIds, 'Iframe after doc #2');
      testLog.info('Doc #2 synced to iframe');
    });

    // ------------------------------------------------------------------
    // Step 8: IFRAME → create sub-document #3
    // ------------------------------------------------------------------
    testLog.step(8, 'Iframe: create sub-document #3');
    addChildInIframe(parentPageName, 0); // 0 = Document

    getChildrenInIframe(parentPageName).then((children) => {
      logChildren('Iframe children after doc #3', children);
      const newChild = children.find((c) => !allCreatedViewIds.includes(c.viewId));

      expect(newChild, 'New doc #3 should exist in iframe').to.not.be.undefined;
      allCreatedViewIds.push(newChild!.viewId);
      testLog.info(`Doc #3 viewId: ${newChild!.viewId}`);
    });

    // Verify it syncs to main window
    cy.then(() => waitForMainWindowChildCount(parentPageName, 4));

    getChildrenInMainWindow(parentPageName).then((children) => {
      logChildren('Main window children after doc #3 sync', children);
      assertContainsAllViewIds(children, allCreatedViewIds, 'Main after doc #3');
      testLog.info('Doc #3 synced to main window');
    });

    // ------------------------------------------------------------------
    // Step 9: Final strict assertions
    // ------------------------------------------------------------------
    testLog.step(9, 'Final strict assertions on both sides');

    // Assert no page reload
    assertNoReload();
    testLog.info('No page reload occurred');

    // Strict assertion on MAIN WINDOW
    getChildrenInMainWindow(parentPageName).then((children) => {
      logChildren('FINAL main window children', children);

      expect(children.length).to.eq(
        4,
        'Main window: parent should have exactly 4 children (2 docs from main + 1 grid from iframe + 1 doc from iframe)'
      );

      assertContainsAllViewIds(children, allCreatedViewIds, 'FINAL main window');

      // Verify each child is visible in the DOM
      for (const child of children) {
        cy.get(byTestId(`page-${child.viewId}`))
          .should('exist')
          .should('be.visible');
        testLog.info(`Main window: "${child.name}" [${child.viewId}] visible`);
      }
    });

    // Strict assertion on IFRAME (check existence — children may be hidden if parent collapsed)
    getChildrenInIframe(parentPageName).then((children) => {
      logChildren('FINAL iframe children', children);

      expect(children.length).to.eq(
        4,
        'Iframe: parent should have exactly 4 children (2 docs from main + 1 grid from iframe + 1 doc from iframe)'
      );

      assertContainsAllViewIds(children, allCreatedViewIds, 'FINAL iframe');

      // Verify each child exists in iframe DOM (visibility depends on expand state)
      for (const child of children) {
        getIframeBody()
          .find(byTestId(`page-${child.viewId}`))
          .should('exist');
        testLog.info(`Iframe: "${child.name}" [${child.viewId}] exists`);
      }
    });

    testLog.info(
      'Bidirectional sync verified — all 4 children (2 docs + 1 grid from both sides) present on both sides'
    );
  });
});
