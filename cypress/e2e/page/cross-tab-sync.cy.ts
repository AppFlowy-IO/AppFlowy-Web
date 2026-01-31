/**
 * Test: Cross-Tab/Iframe Synchronization via BroadcastChannel
 *
 * This test verifies that sidebar updates are synchronized across multiple tabs/iframes
 * via BroadcastChannel when creating and deleting views.
 *
 * Test flow:
 * 1. Login with test user in main window
 * 2. Create an iframe with the same app URL
 * 3. Create a new document in the iframe (in General space)
 * 4. Verify the main window's sidebar reflects the new document
 * 5. Delete the document from the iframe
 * 6. Verify the main window's sidebar reflects the deletion
 */

import {
  PageSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { AuthTestUtils } from '../../support/auth-utils';
import { expandSpaceByName } from '../../support/page-utils';

const SPACE_NAME = 'General';

/**
 * Get iframe body for interaction
 */
function getIframeBody() {
  return cy
    .get('#test-sync-iframe')
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap);
}

/**
 * Wait for iframe to be ready with app loaded
 */
function waitForIframeReady() {
  cy.log('[HELPER] Waiting for iframe to be ready');
  return cy.get('#test-sync-iframe', { timeout: 30000 })
    .should('exist')
    .then(($iframe) => {
      return new Cypress.Promise((resolve) => {
        const checkReady = () => {
          try {
            const iframeDoc = $iframe[0].contentDocument;
            if (iframeDoc) {
              const pageItems = iframeDoc.querySelectorAll('[data-testid="page-item"]');
              if (pageItems.length > 0) {
                cy.log(`[HELPER] Iframe ready with ${pageItems.length} page items`);
                resolve(null);
                return;
              }
            }
          } catch (e) {
            // Cross-origin or not ready yet
          }
          setTimeout(checkReady, 500);
        };
        // Start checking after a delay
        setTimeout(checkReady, 3000);
      });
    });
}

/**
 * Inject Cypress marker into iframe to enable test mode
 * This allows hover-dependent buttons to be visible in the iframe
 */
function injectCypressMarkerIntoIframe() {
  cy.log('[HELPER] Injecting Cypress marker into iframe');
  return cy.get('#test-sync-iframe').then(($iframe) => {
    const iframeWindow = $iframe[0].contentWindow;
    if (iframeWindow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (iframeWindow as any).Cypress = true;
    }
  });
}

describe('Cross-Tab/Iframe Synchronization via BroadcastChannel', () => {
  // Handle uncaught exceptions
  beforeEach(() => {
    cy.on('uncaught:exception', (err: Error) => {
      // Ignore known non-critical errors
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

    // Set viewport size - larger to accommodate iframe
    cy.viewport(1400, 900);
  });

  it('should sync sidebar when creating a view from iframe', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.log(`[TEST START] Testing cross-tab sync when creating view from iframe with: ${testEmail}`);

    // Step 1: Sign in with test user
    cy.log('[STEP 1] Signing in with test user');
    authUtils.signInWithTestUrl(testEmail);

    // Step 2: Wait for app to fully load
    cy.log('[STEP 2] Waiting for app to fully load');
    PageSelectors.names({ timeout: 60000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 3: Expand the space in main window
    cy.log('[STEP 3] Expanding space in main window');
    expandSpaceByName(SPACE_NAME);
    waitForReactUpdate(1000);

    // Step 4: Get the current URL and initial page count
    cy.log('[STEP 4] Getting current URL and initial page count');
    let appUrl = '';
    let initialPageCount = 0;

    cy.url().then((url) => {
      appUrl = url;
      cy.log(`[INFO] App URL: ${appUrl}`);
    });

    PageSelectors.names().then(($pages) => {
      initialPageCount = $pages.length;
      cy.log(`[INFO] Initial page count in main window: ${initialPageCount}`);
    });

    // Step 5: Create an iframe with the same app URL
    cy.log('[STEP 5] Creating iframe with app URL');
    cy.document().then((doc) => {
      // Create iframe container
      const iframeContainer = doc.createElement('div');
      iframeContainer.id = 'test-iframe-container';
      iframeContainer.style.cssText = 'position: fixed; top: 50px; right: 10px; width: 700px; height: 600px; z-index: 9999; border: 3px solid blue; background: white;';

      // Create iframe
      const iframe = doc.createElement('iframe');
      iframe.id = 'test-sync-iframe';
      iframe.src = appUrl;
      iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

      iframeContainer.appendChild(iframe);
      doc.body.appendChild(iframeContainer);
    });

    // Step 6: Wait for iframe to load and be ready
    cy.log('[STEP 6] Waiting for iframe to load');
    waitForIframeReady();
    waitForReactUpdate(2000);

    // Step 6.1: Inject Cypress marker into iframe for test mode
    injectCypressMarkerIntoIframe();
    waitForReactUpdate(500);

    // Step 7: Expand space in iframe
    cy.log('[STEP 7] Expanding space in iframe');
    getIframeBody().find(`[data-testid="space-name"]:contains("${SPACE_NAME}")`).first().click({ force: true });
    waitForReactUpdate(1000);

    // Step 8: Create a new document in iframe using "New page" button
    cy.log('[STEP 8] Creating new document in iframe using New page button');

    // Click the "New page" button in the iframe sidebar
    getIframeBody().find('[data-testid="new-page-button"]').first().click({ force: true });
    waitForReactUpdate(1000);

    // In the modal, select the General space
    cy.log('[STEP 8.1] Selecting General space in modal');
    getIframeBody().find('[data-testid="new-page-modal"]').should('be.visible');
    // Click on the space item that contains "General"
    getIframeBody().find('[data-testid="new-page-modal"]').find('[data-testid="space-item"]').contains(SPACE_NAME).click({ force: true });
    waitForReactUpdate(500);

    // Click the "Add" button to create the page
    cy.log('[STEP 8.2] Clicking Add button to create page');
    getIframeBody().find('[data-testid="new-page-modal"]').find('button').contains('Add').click({ force: true });
    waitForReactUpdate(3000);

    // Close any dialog in iframe if needed
    getIframeBody().then(($body) => {
      const backToHomeBtn = $body.find('button:contains("Back to home")');
      if (backToHomeBtn.length > 0) {
        cy.wrap(backToHomeBtn).first().click({ force: true });
        waitForReactUpdate(1000);
      }
    });

    // Step 9: Verify main window's sidebar reflects the new document
    cy.log('[STEP 9] Verifying main window sidebar updated via BroadcastChannel');

    // Make sure main window space is expanded
    expandSpaceByName(SPACE_NAME);
    waitForReactUpdate(1000);

    // Wait for page count to increase in main window
    const waitForPageCountIncrease = (attempts = 0, maxAttempts = 30): void => {
      if (attempts >= maxAttempts) {
        throw new Error('Page count did not increase in main window - BroadcastChannel sync may not be working');
      }

      PageSelectors.names().then(($pages) => {
        const newCount = $pages.length;
        cy.log(`[INFO] Current page count in main window: ${newCount}, initial: ${initialPageCount}, attempt: ${attempts + 1}`);

        if (newCount > initialPageCount) {
          cy.log('[SUCCESS] Main window sidebar updated via BroadcastChannel!');
          return;
        }

        // Wait and retry
        cy.wait(1000).then(() => waitForPageCountIncrease(attempts + 1, maxAttempts));
      });
    };

    waitForPageCountIncrease();

    // Verify "Untitled" page appears in main window
    PageSelectors.nameContaining('Untitled', { timeout: 30000 }).should('exist');
    cy.log('[SUCCESS] New document from iframe appeared in main window sidebar!');

    // Step 10: Clean up - remove iframe and delete the document
    cy.log('[STEP 10] Cleaning up');
    cy.get('#test-iframe-container').then(($container) => {
      $container.remove();
    });
    waitForReactUpdate(500);

    // Delete the created document from main window
    PageSelectors.nameContaining('Untitled').first().parents('[data-testid="page-item"]').first().trigger('mouseenter', { force: true });
    waitForReactUpdate(500);
    PageSelectors.moreActionsButton('Untitled').click({ force: true });
    waitForReactUpdate(500);

    cy.get('[data-testid="view-action-delete"]').should('be.visible').click();
    waitForReactUpdate(500);

    // Confirm deletion if dialog appears
    cy.get('body').then(($body) => {
      const confirmButton = $body.find('[data-testid="confirm-delete-button"]');
      if (confirmButton.length > 0) {
        cy.get('[data-testid="confirm-delete-button"]').click({ force: true });
      } else {
        const deleteButton = $body.find('button:contains("Delete")');
        if (deleteButton.length > 0) {
          cy.wrap(deleteButton).first().click({ force: true });
        }
      }
    });
    waitForReactUpdate(2000);

    cy.log('[TEST COMPLETE] Cross-tab sync for view creation verified successfully!');
  });

  it('should sync sidebar when deleting a view from main window to iframe', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.log(`[TEST START] Testing cross-tab sync when deleting view from main window with: ${testEmail}`);

    // Step 1: Sign in with test user
    cy.log('[STEP 1] Signing in with test user');
    authUtils.signInWithTestUrl(testEmail);

    // Step 2: Wait for app to fully load
    cy.log('[STEP 2] Waiting for app to fully load');
    PageSelectors.names({ timeout: 60000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 3: Expand the space
    cy.log('[STEP 3] Expanding space');
    expandSpaceByName(SPACE_NAME);
    waitForReactUpdate(1000);

    // Step 4: Get current URL and initial page count
    cy.log('[STEP 4] Getting current URL and initial page count');
    let appUrl = '';
    let initialPageCount = 0;

    cy.url().then((url) => {
      appUrl = url;
    });

    PageSelectors.names().then(($pages) => {
      initialPageCount = $pages.length;
      cy.log(`[INFO] Initial page count: ${initialPageCount}`);
    });

    // Step 5: Create a document in main window FIRST (before iframe)
    cy.log('[STEP 5] Creating a document in main window');

    // Click the "New page" button in main window
    cy.get('[data-testid="new-page-button"]').first().click({ force: true });
    waitForReactUpdate(1000);

    // In the modal, select the General space
    cy.get('[data-testid="new-page-modal"]').should('be.visible');
    cy.get('[data-testid="new-page-modal"]').find('[data-testid="space-item"]').contains(SPACE_NAME).click({ force: true });
    waitForReactUpdate(500);

    // Click the "Add" button
    cy.get('[data-testid="new-page-modal"]').find('button').contains('Add').click({ force: true });
    waitForReactUpdate(3000);

    // Close any dialog
    cy.get('body').then(($body) => {
      const backToHomeBtn = $body.find('button:contains("Back to home")');
      if (backToHomeBtn.length > 0) {
        cy.wrap(backToHomeBtn).first().click({ force: true });
        waitForReactUpdate(1000);
      }
    });
    waitForReactUpdate(2000);

    // Try to close dialog multiple times if needed
    const closeDialogIfExists = (attempts = 0): void => {
      if (attempts >= 5) return;

      cy.get('body').then(($body) => {
        if ($body.find('.MuiDialog-root').length > 0) {
          const backBtn = $body.find('button:contains("Back to home")');
          if (backBtn.length > 0) {
            cy.wrap(backBtn).first().click({ force: true });
          } else {
            cy.get('body').type('{esc}');
          }
          cy.wait(500).then(() => closeDialogIfExists(attempts + 1));
        }
      });
    };

    closeDialogIfExists();
    waitForReactUpdate(1000);

    // Verify document was created in main window
    PageSelectors.nameContaining('Untitled', { timeout: 30000 }).should('exist');
    cy.log('[SUCCESS] Document created in main window');

    // Step 6: Create an iframe AFTER the document is created
    cy.log('[STEP 6] Creating iframe with app URL');
    cy.document().then((doc) => {
      const iframeContainer = doc.createElement('div');
      iframeContainer.id = 'test-iframe-container';
      iframeContainer.style.cssText = 'position: fixed; top: 50px; right: 10px; width: 700px; height: 600px; z-index: 9999; border: 3px solid red; background: white;';

      const iframe = doc.createElement('iframe');
      iframe.id = 'test-sync-iframe';
      iframe.src = appUrl;
      iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

      iframeContainer.appendChild(iframe);
      doc.body.appendChild(iframeContainer);
    });

    // Wait for iframe to load
    waitForIframeReady();
    waitForReactUpdate(2000);

    // Step 7: Expand space in iframe
    cy.log('[STEP 7] Expanding space in iframe');
    getIframeBody().find(`[data-testid="space-name"]:contains("${SPACE_NAME}")`).first().click({ force: true });
    waitForReactUpdate(1000);

    // Step 8: Verify iframe shows the document (it should since iframe loaded after document was created)
    cy.log('[STEP 8] Verifying iframe shows the document');

    // Verify "Untitled" page appears in iframe
    getIframeBody().find('[data-testid="page-name"]:contains("Untitled")', { timeout: 30000 }).should('exist');
    cy.log('[SUCCESS] Document appears in iframe!');

    // Get page count after creation
    let pageCountAfterCreate = 0;
    PageSelectors.names().then(($pages) => {
      pageCountAfterCreate = $pages.length;
      cy.log(`[INFO] Page count after creating document: ${pageCountAfterCreate}`);
    });

    // Step 9: Delete the document from main window
    cy.log('[STEP 9] Deleting document from main window');

    // Find and hover over the Untitled page in main window
    PageSelectors.nameContaining('Untitled').first().parents('[data-testid="page-item"]').first().trigger('mouseenter', { force: true });
    waitForReactUpdate(500);

    // Click more actions button
    PageSelectors.moreActionsButton('Untitled').click({ force: true });
    waitForReactUpdate(500);

    // Click delete
    cy.get('[data-testid="view-action-delete"]').should('be.visible').click();
    waitForReactUpdate(500);

    // Confirm deletion if dialog appears
    cy.get('body').then(($body) => {
      const confirmButton = $body.find('[data-testid="confirm-delete-button"]');
      if (confirmButton.length > 0) {
        cy.get('[data-testid="confirm-delete-button"]').click({ force: true });
      } else {
        const deleteButton = $body.find('button:contains("Delete")');
        if (deleteButton.length > 0) {
          cy.wrap(deleteButton).first().click({ force: true });
        }
      }
    });
    waitForReactUpdate(2000);

    // Step 10: Verify iframe's sidebar reflects the deletion via BroadcastChannel
    cy.log('[STEP 10] Verifying iframe sidebar updated after deletion via BroadcastChannel');

    // Wait for page count to decrease in iframe
    const waitForIframePageCountDecrease = (attempts = 0, maxAttempts = 30): void => {
      if (attempts >= maxAttempts) {
        throw new Error('Page count did not decrease in iframe - BroadcastChannel sync may not be working for deletion');
      }

      getIframeBody().find('[data-testid="page-name"]').then(($pages) => {
        const newCount = $pages.length;
        cy.log(`[INFO] Current page count in iframe: ${newCount}, after create: ${pageCountAfterCreate}, attempt: ${attempts + 1}`);

        if (newCount < pageCountAfterCreate) {
          cy.log('[SUCCESS] Iframe sidebar updated after deletion via BroadcastChannel!');
          return;
        }

        // Wait and retry
        cy.wait(1000).then(() => waitForIframePageCountDecrease(attempts + 1, maxAttempts));
      });
    };

    waitForIframePageCountDecrease();

    // Verify "Untitled" page no longer exists in iframe
    getIframeBody().find('[data-testid="page-name"]:contains("Untitled")').should('not.exist');
    cy.log('[SUCCESS] Deleted document removed from iframe sidebar via BroadcastChannel!');

    // Step 11: Clean up - remove iframe
    cy.log('[STEP 11] Cleaning up - removing iframe');
    cy.get('#test-iframe-container').then(($container) => {
      $container.remove();
    });

    cy.log('[TEST COMPLETE] Cross-tab sync for view deletion (main→iframe) verified successfully!');
  });
});
