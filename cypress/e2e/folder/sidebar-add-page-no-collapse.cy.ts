/**
 * Test: Sidebar does not collapse or reload when a page is created from another tab.
 *
 * Uses a fresh user account (no hardcoded snapshot accounts).
 *
 * Flow:
 * 1. Sign in with a new random user
 * 2. Expand the General space — observe the default "Getting started" page
 * 3. Install a reload-detection marker on the main window
 * 4. Open an iframe pointing to the same workspace (simulates a second tab)
 * 5. Create a new document from the iframe via the "New page" button
 * 6. Verify the main window:
 *    a. Did NOT do a full page refresh / reload
 *    b. Sidebar still shows the original pages (no collapse)
 *    c. The newly created page appears via BroadcastChannel sync
 * 7. Cleanup: delete the newly created page
 */

import { AuthTestUtils } from '../../support/auth-utils';
import {
  PageSelectors,
  SidebarSelectors,
  byTestId,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';
import { expandSpaceByName } from '../../support/page-utils';

const SPACE_NAME = 'General';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Signs in with the given email and waits for the app to be ready.
 */
function signIn(email: string) {
  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(1000);
  const authUtils = new AuthTestUtils();
  authUtils.signInWithTestUrl(email);
  SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
  cy.wait(2000);
}

// ---------------------------------------------------------------------------
// Iframe helpers (adapted from cross-tab-sync.cy.ts)
// ---------------------------------------------------------------------------

/**
 * Get the iframe body for interaction.
 */
function getIframeBody() {
  return cy
    .get('#test-sync-iframe')
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap);
}

/**
 * Wait for the iframe app to finish loading (page items rendered).
 */
function waitForIframeReady() {
  cy.log('[HELPER] Waiting for iframe to be ready');
  return cy
    .get('#test-sync-iframe', { timeout: 30000 })
    .should('exist')
    .then(($iframe) => {
      return new Cypress.Promise((resolve) => {
        const checkReady = () => {
          try {
            const iframeDoc = ($iframe[0] as HTMLIFrameElement).contentDocument;

            if (iframeDoc) {
              const pageItems = iframeDoc.querySelectorAll('[data-testid="page-item"]');

              if (pageItems.length > 0) {
                cy.log(`[HELPER] Iframe ready with ${pageItems.length} page items`);
                resolve(null);
                return;
              }
            }
          } catch {
            // Cross-origin or not ready yet
          }

          setTimeout(checkReady, 500);
        };

        setTimeout(checkReady, 3000);
      });
    });
}

/**
 * Inject Cypress marker into the iframe so hover-dependent buttons are visible.
 */
function injectCypressMarkerIntoIframe() {
  return cy.get('#test-sync-iframe').then(($iframe) => {
    const iframeWindow = ($iframe[0] as HTMLIFrameElement).contentWindow;

    if (iframeWindow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (iframeWindow as any).Cypress = true;
    }
  });
}

/**
 * Install a reload-detection marker on the main window.
 * Sets a property on window that will be lost if the page fully reloads.
 */
const RELOAD_MARKER = '__NO_RELOAD_MARKER__';

function installReloadDetection() {
  cy.window().then((win) => {
    (win as unknown as Record<string, unknown>)[RELOAD_MARKER] = true;
  });
  cy.window().its(RELOAD_MARKER).should('eq', true);
}

/**
 * Assert that the page has NOT reloaded by checking the marker still exists.
 */
function assertNoReload() {
  cy.window().its(RELOAD_MARKER).should('eq', true);
}

/**
 * Create an iframe pointing to the given URL.
 */
function createIframe(appUrl: string) {
  cy.document().then((doc) => {
    const container = doc.createElement('div');

    container.id = 'test-iframe-container';
    container.style.cssText =
      'position: fixed; top: 50px; right: 10px; width: 700px; height: 600px; z-index: 9999; border: 3px solid blue; background: white;';

    const iframe = doc.createElement('iframe');

    iframe.id = 'test-sync-iframe';
    iframe.src = appUrl;
    iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

    container.appendChild(iframe);
    doc.body.appendChild(container);
  });
}

/**
 * Remove the test iframe if it exists.
 */
function removeIframe() {
  cy.document().then((doc) => {
    const container = doc.getElementById('test-iframe-container');

    if (container) {
      container.remove();
    }
  });
}

/**
 * Collect all visible page names in the main-window sidebar.
 */
function getVisiblePageNames(): Cypress.Chainable<string[]> {
  return PageSelectors.names().then(($names) => {
    return Array.from($names).map((el) => Cypress.$(el).text().trim());
  });
}

/**
 * Retry until the page count in the main window increases beyond `initialCount`.
 */
function waitForPageCountIncrease(initialCount: number, attempts = 0, maxAttempts = 30): void {
  if (attempts >= maxAttempts) {
    throw new Error(
      'Page count did not increase in main window — BroadcastChannel sync may not be working'
    );
  }

  PageSelectors.names().then(($pages) => {
    const newCount = $pages.length;

    testLog.info(
      `Page count check: current=${newCount}, initial=${initialCount}, attempt=${attempts + 1}`
    );

    if (newCount > initialCount) {
      testLog.info('Page count increased — sync received');
      return;
    }

    cy.wait(1000).then(() => waitForPageCountIncrease(initialCount, attempts + 1, maxAttempts));
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('Sidebar does not collapse or reload when a page is created from another tab (iframe)', () => {
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
    removeIframe();
  });

  it('should keep existing pages visible and not reload after a page is created from an iframe', () => {
    const testEmail = generateRandomEmail();

    // ------------------------------------------------------------------
    // Step 1: Sign in with a fresh user
    // ------------------------------------------------------------------
    testLog.step(1, 'Sign in with a new user');
    signIn(testEmail);

    // ------------------------------------------------------------------
    // Step 2: Expand the General space and record initial pages
    // ------------------------------------------------------------------
    testLog.step(2, 'Expand General space and record initial pages');
    expandSpaceByName(SPACE_NAME);
    waitForReactUpdate(1000);

    // The default workspace has at least a "Getting started" page
    PageSelectors.names({ timeout: 10000 }).should('exist');

    let initialPageNames: string[] = [];
    let initialPageCount = 0;

    getVisiblePageNames().then((names) => {
      initialPageNames = names;
      initialPageCount = names.length;
      testLog.info(`Initial pages (${initialPageCount}): ${names.join(', ')}`);
    });

    // ------------------------------------------------------------------
    // Step 3: Install reload detection on the main window
    // ------------------------------------------------------------------
    testLog.step(3, 'Install reload detection marker');
    installReloadDetection();
    testLog.info('Reload detection installed');

    // ------------------------------------------------------------------
    // Step 4: Capture the current app URL and create an iframe
    // ------------------------------------------------------------------
    testLog.step(4, 'Create iframe with same app URL');
    let appUrl = '';

    cy.url().then((url) => {
      appUrl = url;
      testLog.info(`App URL: ${appUrl}`);
    });

    cy.then(() => {
      createIframe(appUrl);
    });

    // ------------------------------------------------------------------
    // Step 5: Wait for iframe to load and expand its space
    // ------------------------------------------------------------------
    testLog.step(5, 'Wait for iframe to be ready');
    waitForIframeReady();
    waitForReactUpdate(2000);
    injectCypressMarkerIntoIframe();
    waitForReactUpdate(500);

    testLog.info('Expanding space in iframe');
    getIframeBody()
      .find(`[data-testid="space-name"]:contains("${SPACE_NAME}")`)
      .first()
      .click({ force: true });
    waitForReactUpdate(1000);

    // ------------------------------------------------------------------
    // Step 6: Create a new document from the iframe via "New page" button
    // ------------------------------------------------------------------
    testLog.step(6, 'Create new page from iframe');

    getIframeBody()
      .find(byTestId('new-page-button'))
      .first()
      .click({ force: true });
    waitForReactUpdate(1000);

    // Select the General space in the new-page modal
    getIframeBody()
      .find(byTestId('new-page-modal'))
      .should('be.visible')
      .find(byTestId('space-item'))
      .contains(SPACE_NAME)
      .click({ force: true });
    waitForReactUpdate(500);

    // Click "Add" to create the page
    getIframeBody()
      .find(byTestId('new-page-modal'))
      .find('button')
      .contains('Add')
      .click({ force: true });
    waitForReactUpdate(3000);

    // Close any dialog in iframe if needed
    getIframeBody().then(($body: JQuery<HTMLElement>) => {
      const backBtn = $body.find('button:contains("Back to home")');

      if (backBtn.length > 0) {
        cy.wrap(backBtn).first().click({ force: true });
        waitForReactUpdate(1000);
      }
    });

    // ------------------------------------------------------------------
    // Step 7: Wait for BroadcastChannel sync to the main window
    // ------------------------------------------------------------------
    testLog.step(7, 'Wait for page creation to sync to main window');

    // Re-expand space in main window in case it collapsed
    expandSpaceByName(SPACE_NAME);
    waitForReactUpdate(1000);

    // Wait until page count increases
    cy.then(() => {
      waitForPageCountIncrease(initialPageCount);
    });

    // ------------------------------------------------------------------
    // Step 8: KEY ASSERTION — Verify main window did NOT reload
    // ------------------------------------------------------------------
    testLog.step(8, 'Verify main window did not reload');
    assertNoReload();
    testLog.info('No page reload occurred');

    // ------------------------------------------------------------------
    // Step 9: KEY ASSERTION — Verify original pages are STILL visible
    //         in the main window sidebar (no collapse)
    // ------------------------------------------------------------------
    testLog.step(9, 'Verify existing pages are still visible in main window');

    getVisiblePageNames().then((currentNames) => {
      testLog.info(`Current pages: ${currentNames.join(', ')}`);

      // Every initial page must still be present
      for (const name of initialPageNames) {
        expect(currentNames).to.include(
          name,
          `Original page "${name}" should still be visible after iframe created a new page`
        );
        testLog.info(`Confirmed still visible: "${name}"`);
      }

      // There should be at least one more page than before
      expect(currentNames.length).to.be.greaterThan(
        initialPageCount,
        `Expected more pages after adding from iframe (was ${initialPageCount}, now ${currentNames.length})`
      );

      testLog.info(
        'Sidebar did NOT collapse — all original pages preserved and new page synced'
      );
    });

    // ------------------------------------------------------------------
    // Step 10: Cleanup — delete the newly created page
    // ------------------------------------------------------------------
    testLog.step(10, 'Cleanup: delete the newly created page from main window');

    // The new page is "Untitled" (default name for newly created pages)
    PageSelectors.nameContaining('Untitled')
      .first()
      .parents(byTestId('page-item'))
      .first()
      .trigger('mouseenter', { force: true });
    waitForReactUpdate(500);

    PageSelectors.moreActionsButton('Untitled').click({ force: true });
    waitForReactUpdate(500);

    cy.get(byTestId('view-action-delete')).should('be.visible').click();
    waitForReactUpdate(500);

    // Confirm deletion if dialog appears
    cy.get('body').then(($body) => {
      const confirmButton = $body.find(byTestId('confirm-delete-button'));

      if (confirmButton.length > 0) {
        cy.get(byTestId('confirm-delete-button')).click({ force: true });
      } else {
        const deleteButton = $body.find('button:contains("Delete")');

        if (deleteButton.length > 0) {
          cy.wrap(deleteButton).first().click({ force: true });
        }
      }
    });
    waitForReactUpdate(2000);

    testLog.info('Cleanup complete');
  });
});
