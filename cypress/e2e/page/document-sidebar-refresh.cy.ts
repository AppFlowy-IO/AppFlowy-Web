/**
 * Test: Document Create and Rename with Sidebar Refresh via WebSocket
 *
 * This test verifies that the sidebar updates correctly via WebSocket notifications
 * when creating and renaming documents.
 *
 * Test flow:
 * 1. Login with test user
 * 2. Count existing pages in sidebar
 * 3. Hover over "Getting started" page and click the plus button to create a new document
 * 4. Verify sidebar page count increases (proves WebSocket notification works)
 * 5. Rename the document via context menu
 * 6. Verify the renamed document appears in sidebar
 * 7. Clean up by deleting the test document
 */

import {
  PageSelectors,
  SpaceSelectors,
  ViewActionSelectors,
  ModalSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { AuthTestUtils } from '../../support/auth-utils';

const _spaceName = 'General';

/**
 * Expand a space in the sidebar by clicking on it if not already expanded
 */
function expandSpaceInSidebar(spaceNameToExpand: string) {
  cy.log(`[HELPER] Expanding space "${spaceNameToExpand}" in sidebar`);

  SpaceSelectors.itemByName(spaceNameToExpand, { timeout: 30000 }).then(($space) => {
    const expandedIndicator = $space.find('[data-testid="space-expanded"]');
    const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

    if (!isExpanded) {
      SpaceSelectors.itemByName(spaceNameToExpand).find('[data-testid="space-name"]').click({ force: true });
      waitForReactUpdate(1000);
    }
  });
}

describe('Document Sidebar Refresh via WebSocket', () => {
  // Handle uncaught exceptions
  beforeEach(() => {
    cy.on('uncaught:exception', (err: Error) => {
      // Ignore known non-critical errors
      if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection') ||
        err.message.includes('cancelled') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('_dEH')
      ) {
        return false;
      }
      return true;
    });

    // Set viewport size
    cy.viewport(1280, 720);
  });

  it('should verify sidebar updates via WebSocket when creating and renaming documents', () => {
    const uniqueId = Date.now();
    const renamedDocumentName = `Renamed-${uniqueId}`;
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.log(`[TEST START] Testing sidebar refresh via WebSocket notifications with: ${testEmail}`);

    // Step 1-4: Sign in with test user using auth utils
    cy.log('[STEP 1-4] Signing in with test user');
    authUtils.signInWithTestUrl(testEmail);

    // Step 5: Wait for app to fully load
    cy.log('[STEP 5] Waiting for app to fully load');
    PageSelectors.names({ timeout: 60000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 6: Expand the General space
    cy.log('[STEP 6] Expanding General space');
    expandSpaceInSidebar(_spaceName);
    waitForReactUpdate(1000);

    // Count existing pages
    let initialPageCount = 0;
    let parentPageName = '';
    PageSelectors.names().then(($pages) => {
      initialPageCount = $pages.length;
      cy.log(`[INFO] Initial page count: ${initialPageCount}`);
      // Get the first page name to use as parent
      if ($pages.length > 0) {
        parentPageName = $pages.first().text().trim();
        cy.log(`[INFO] Will use "${parentPageName}" as parent page`);
      }
    });

    // Step 8: Hover over the first page and click the plus button
    cy.log('[STEP 8] Hovering over first page to show plus button');
    cy.get('[data-testid="page-item"]').first().trigger('mouseenter');
    waitForReactUpdate(500);

    // Click the inline add page button (plus button)
    cy.log('[STEP 8.1] Clicking the inline add page button');
    cy.get('[data-testid="page-item"]').first().find('[data-testid="inline-add-page"]').first().click({ force: true });
    waitForReactUpdate(500);

    // Step 9: Select "Document" from the dropdown menu
    cy.log('[STEP 9] Selecting Document from dropdown');
    cy.get('[data-testid="view-actions-popover"]').should('be.visible');
    // Click the first menu item which is "Document"
    cy.get('[data-testid="view-actions-popover"]').find('[role="menuitem"]').first().click();
    waitForReactUpdate(3000);

    // Step 10: Verify sidebar page count increased (WebSocket notification worked!)
    cy.log('[STEP 10] Verifying page count increased via WebSocket notification');
    expandSpaceInSidebar(_spaceName);
    waitForReactUpdate(2000);

    // Wait for the new page to appear and verify count increased
    const waitForPageCountIncrease = (attempts = 0, maxAttempts = 30): void => {
      if (attempts >= maxAttempts) {
        throw new Error('Page count did not increase - WebSocket notification may not be working');
      }

      PageSelectors.names().then(($pages) => {
        const newCount = $pages.length;
        cy.log(`[INFO] Current page count: ${newCount}, initial: ${initialPageCount}, attempt: ${attempts + 1}`);

        if (newCount > initialPageCount) {
          cy.log('[SUCCESS] Page count increased!');
          return;
        }

        // Wait and retry
        cy.wait(1000).then(() => waitForPageCountIncrease(attempts + 1, maxAttempts));
      });
    };

    waitForPageCountIncrease();

    cy.log('[SUCCESS] New document appeared in sidebar via WebSocket notification!');

    // Step 11: Close any dialog that may have opened
    cy.log('[STEP 11] Closing any open dialog');
    // Check for "No access" dialog first and close it
    cy.get('body').then(($body) => {
      // Check for "Back to home" button (indicates "No access" dialog)
      const backToHomeBtn = $body.find('button:contains("Back to home")');
      if (backToHomeBtn.length > 0) {
        cy.log('[STEP 11.1] Found "No access" dialog, clicking Back to home');
        cy.wrap(backToHomeBtn).first().click({ force: true });
        waitForReactUpdate(1000);
        return;
      }

      // Check for X close button
      const closeBtn = $body.find('[data-testid="close-modal-button"]');
      if (closeBtn.length > 0) {
        cy.log('[STEP 11.2] Found close button, clicking it');
        cy.wrap(closeBtn).first().click({ force: true });
        waitForReactUpdate(1000);
        return;
      }

      // Try pressing Escape as fallback
      if ($body.find('.MuiDialog-root').length > 0) {
        cy.log('[STEP 11.3] Found dialog, pressing Escape');
        cy.get('body').type('{esc}');
        waitForReactUpdate(1000);
      }
    });

    // Wait for dialog to be completely gone
    waitForReactUpdate(2000);
    // Retry closing if dialog is still there
    cy.get('body').then(($body) => {
      const backToHomeBtn = $body.find('button:contains("Back to home")');
      if (backToHomeBtn.length > 0) {
        cy.log('[STEP 11.4] Dialog still open, clicking Back to home again');
        cy.wrap(backToHomeBtn).first().click({ force: true });
        waitForReactUpdate(1000);
      }
    });
    cy.get('.MuiDialog-root', { timeout: 30000 }).should('not.exist');

    // Step 12: Expand the parent page to show the newly created child
    cy.log('[STEP 12] Expanding parent page to show new child');
    // Click on the expand toggle of the first page item to show its children
    // Use eq(0) to get the direct toggle, not nested ones
    cy.get('[data-testid="page-item"]').first().find('[data-testid="outline-toggle-expand"]').first().click({ force: true });
    waitForReactUpdate(1000);

    // Find the newly created "Untitled" page under the parent
    cy.log('[STEP 12.1] Finding newly created Untitled page');
    // The new page should be named "Untitled" by default
    PageSelectors.nameContaining('Untitled', { timeout: 30000 }).first().should('exist');

    // Step 13: Hover over Untitled page and click the more actions button
    cy.log('[STEP 13] Opening more actions menu on Untitled page');
    PageSelectors.nameContaining('Untitled').first().parents('[data-testid="page-item"]').first().trigger('mouseenter', { force: true });
    waitForReactUpdate(500);
    PageSelectors.moreActionsButton('Untitled').click({ force: true });
    waitForReactUpdate(500);

    // Step 14: Click rename
    cy.log('[STEP 14] Clicking rename button');
    ViewActionSelectors.renameButton().should('be.visible').click();
    waitForReactUpdate(500);

    // Step 15: Enter new name
    cy.log(`[STEP 15] Renaming to: ${renamedDocumentName}`);
    ModalSelectors.renameInput().should('be.visible');
    ModalSelectors.renameInput().clear();
    waitForReactUpdate(300);
    ModalSelectors.renameInput().type(renamedDocumentName);
    waitForReactUpdate(500);

    // Step 16: Save the rename
    cy.log('[STEP 16] Saving rename');
    ModalSelectors.renameSaveButton().should('be.visible').click();
    waitForReactUpdate(2000);

    // Step 17: Verify renamed document appears in sidebar via WebSocket
    cy.log('[STEP 17] Verifying renamed document in sidebar');
    PageSelectors.nameContaining(renamedDocumentName, { timeout: 30000 })
      .should('exist')
      .then(() => {
        cy.log(`[SUCCESS] Renamed document "${renamedDocumentName}" appeared in sidebar via WebSocket!`);
      });

    // Step 18: Clean up - delete the test document
    cy.log('[STEP 18] Cleaning up - deleting test document');
    PageSelectors.itemByName(renamedDocumentName).trigger('mouseenter');
    waitForReactUpdate(500);
    PageSelectors.moreActionsButton(renamedDocumentName).click({ force: true });
    waitForReactUpdate(500);

    cy.get('[data-testid="view-action-delete"]').should('be.visible').click();
    waitForReactUpdate(500);

    // Confirm deletion if dialog appears
    cy.get('body').then(($body) => {
      // Check if there's a confirmation button
      const confirmButton = $body.find('[data-testid="confirm-delete-button"]');
      if (confirmButton.length > 0) {
        cy.get('[data-testid="confirm-delete-button"]').click({ force: true });
      } else {
        // Try finding a button with delete text
        const deleteButton = $body.find('button:contains("Delete")');
        if (deleteButton.length > 0) {
          cy.wrap(deleteButton).first().click({ force: true });
        }
      }
    });
    waitForReactUpdate(2000);

    // Step 19: Verify document is removed from sidebar
    cy.log('[STEP 19] Verifying document removed from sidebar');
    PageSelectors.nameContaining(renamedDocumentName, { timeout: 10000 }).should('not.exist');

    cy.log('[TEST COMPLETE] Sidebar refresh via WebSocket notification verified successfully!');
  });

  it('should verify sidebar updates via WebSocket when creating AI chat', () => {
    const testEmail = generateRandomEmail();
    const authUtils = new AuthTestUtils();

    cy.log(`[TEST START] Testing AI chat sidebar refresh via WebSocket notifications with: ${testEmail}`);

    // Step 1: Sign in with test user
    cy.log('[STEP 1] Signing in with test user');
    authUtils.signInWithTestUrl(testEmail);

    // Step 2: Wait for app to fully load
    cy.log('[STEP 2] Waiting for app to fully load');
    PageSelectors.names({ timeout: 60000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 3: Expand the General space
    cy.log('[STEP 3] Expanding General space');
    expandSpaceInSidebar(_spaceName);
    waitForReactUpdate(1000);

    // Count existing pages
    let initialPageCount = 0;
    PageSelectors.names().then(($pages) => {
      initialPageCount = $pages.length;
      cy.log(`[INFO] Initial page count: ${initialPageCount}`);
    });

    // Step 4: Hover over the first page and click the plus button
    cy.log('[STEP 4] Hovering over first page to show plus button');
    cy.get('[data-testid="page-item"]').first().trigger('mouseenter');
    waitForReactUpdate(500);

    // Click the inline add page button (plus button)
    cy.log('[STEP 4.1] Clicking the inline add page button');
    cy.get('[data-testid="page-item"]').first().find('[data-testid="inline-add-page"]').first().click({ force: true });
    waitForReactUpdate(500);

    // Step 5: Select "AI Chat" from the dropdown menu
    cy.log('[STEP 5] Selecting AI Chat from dropdown');
    cy.get('[data-testid="view-actions-popover"]').should('be.visible');
    // Click the AI Chat menu item
    cy.get('[data-testid="add-ai-chat-button"]').click();
    waitForReactUpdate(3000);

    // Step 6: Verify sidebar page count increased (WebSocket notification worked!)
    cy.log('[STEP 6] Verifying page count increased via WebSocket notification');
    expandSpaceInSidebar(_spaceName);
    waitForReactUpdate(2000);

    // Wait for the new AI chat to appear and verify count increased
    const waitForPageCountIncrease = (attempts = 0, maxAttempts = 30): void => {
      if (attempts >= maxAttempts) {
        throw new Error('Page count did not increase - WebSocket notification may not be working for AI chat');
      }

      PageSelectors.names().then(($pages) => {
        const newCount = $pages.length;
        cy.log(`[INFO] Current page count: ${newCount}, initial: ${initialPageCount}, attempt: ${attempts + 1}`);

        if (newCount > initialPageCount) {
          cy.log('[SUCCESS] Page count increased for AI chat!');
          return;
        }

        // Wait and retry
        cy.wait(1000).then(() => waitForPageCountIncrease(attempts + 1, maxAttempts));
      });
    };

    waitForPageCountIncrease();

    cy.log('[SUCCESS] New AI chat appeared in sidebar via WebSocket notification!');

    // Step 7: Expand the parent page to show the newly created AI chat
    cy.log('[STEP 7] Expanding parent page to show new AI chat');
    cy.get('[data-testid="page-item"]').first().find('[data-testid="outline-toggle-expand"]').first().click({ force: true });
    waitForReactUpdate(1000);

    // Step 8: Clean up - delete the AI chat
    cy.log('[STEP 8] Cleaning up - deleting AI chat');
    // Find the Untitled page (AI chat default name) and delete it
    PageSelectors.nameContaining('Untitled', { timeout: 30000 }).first().should('be.visible');
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

    cy.log('[TEST COMPLETE] AI chat sidebar refresh via WebSocket notification verified successfully!');
  });
});
