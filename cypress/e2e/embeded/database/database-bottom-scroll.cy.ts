import { v4 as uuidv4 } from 'uuid';
import { AuthTestUtils } from '../../../support/auth-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  EditorSelectors,
  ModalSelectors,
  SlashCommandSelectors,
  waitForReactUpdate
} from '../../../support/selectors';

describe('Embedded Database - Bottom Scroll Preservation', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Minified React error') ||
          err.message.includes('View not found') ||
          err.message.includes('No workspace or service found') ||
          err.message.includes('Cannot resolve a DOM point from Slate point') ||
          err.message.includes('No range and node found')) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should preserve scroll position when creating grid database at bottom of long document', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Testing scroll preservation when creating database at bottom - Test email: ${testEmail}`);

    // Step 1: Login
    cy.task('log', '[STEP 1] Visiting login page');
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    cy.task('log', '[STEP 2] Starting authentication');
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.task('log', '[STEP 3] Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 2: Create a new document
      cy.task('log', '[STEP 4] Creating new document');
      AddPageSelectors.inlineAddButton().first().as('addBtn');
      cy.get('@addBtn').should('be.visible').click();
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().as('menuItem');
      cy.get('@menuItem').click();
      waitForReactUpdate(1000);

      // Handle the new page modal if it appears
      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="new-page-modal"]').length > 0) {
          cy.task('log', '[STEP 4.1] Handling new page modal');
          ModalSelectors.newPageModal().should('be.visible').within(() => {
            ModalSelectors.spaceItemInModal().first().as('spaceItem');
            cy.get('@spaceItem').click();
            waitForReactUpdate(500);
            cy.contains('button', 'Add').click();
          });
          cy.wait(3000);
        } else {
          cy.wait(3000);
        }
      });

      // Step 3: Wait for editor to be available and stable
      cy.task('log', '[STEP 5] Waiting for editor to be available');
      EditorSelectors.firstEditor().should('exist', { timeout: 15000 });
      waitForReactUpdate(2000); // Give extra time for editor to stabilize

      // Step 4: Add many lines to exceed screen height
      cy.task('log', '[STEP 6] Adding multiple lines to exceed screen height');

      // Click editor to focus it
      EditorSelectors.firstEditor().click({ force: true });
      waitForReactUpdate(500);

      // Build text content with 30 lines (enough to exceed viewport)
      let textContent = '';
      for (let i = 1; i <= 30; i++) {
        textContent += `Line ${i} - This is a longer line of text to ensure we have enough content to scroll{enter}`;
      }

      cy.task('log', '[STEP 6.1] Typing 30 lines of content');
      // Use cy.focused() to type - more stable than re-querying editor element
      cy.focused().type(textContent, { delay: 1 });

      cy.task('log', '[STEP 6.2] Content added successfully');
      waitForReactUpdate(2000);

      // Step 5: Get the scroll container and record initial state
      cy.task('log', '[STEP 7] Finding scroll container');
      cy.get('.appflowy-scroll-container').first().as('scrollContainer');

      // Step 6: Scroll to the bottom
      cy.task('log', '[STEP 8] Scrolling to bottom of document');
      cy.get('@scrollContainer').then(($container) => {
        const scrollHeight = $container[0].scrollHeight;
        const clientHeight = $container[0].clientHeight;
        const scrollToPosition = scrollHeight - clientHeight;

        cy.task('log', `[STEP 8.1] Scroll metrics: scrollHeight=${scrollHeight}, clientHeight=${clientHeight}, scrollToPosition=${scrollToPosition}`);

        // Scroll to bottom
        cy.get('@scrollContainer').scrollTo(0, scrollToPosition);
        waitForReactUpdate(500);

        // Verify we're at the bottom
        cy.get('@scrollContainer').then(($cont) => {
          const currentScrollTop = $cont[0].scrollTop;
          cy.task('log', `[STEP 8.2] Current scroll position after scrolling: ${currentScrollTop}`);

          // Allow some tolerance (within 50px of bottom)
          expect(currentScrollTop).to.be.greaterThan(scrollToPosition - 50);
        });
      });

      // Step 7: Store the scroll position before opening slash menu
      let scrollPositionBeforeSlashMenu = 0;

      cy.get('@scrollContainer').then(($container) => {
        scrollPositionBeforeSlashMenu = $container[0].scrollTop;
        cy.task('log', `[STEP 9] Scroll position before opening slash menu: ${scrollPositionBeforeSlashMenu}`);
      });

      // Step 8: Open slash menu at the bottom
      cy.task('log', '[STEP 10] Opening slash menu at bottom');
      // Click editor at the end and type slash
      EditorSelectors.firstEditor().click().type('{enter}/');
      waitForReactUpdate(500);

      // Step 9: Verify slash menu is visible
      cy.task('log', '[STEP 11] Verifying slash menu is visible');
      SlashCommandSelectors.slashPanel().should('be.visible');

      // Step 10: Check that scroll position is preserved after opening slash menu
      cy.get('@scrollContainer').then(($container) => {
        const scrollAfterSlashMenu = $container[0].scrollTop;
        cy.task('log', `[STEP 11.1] Scroll position after opening slash menu: ${scrollAfterSlashMenu}`);

        // Allow some tolerance (within 100px) since the menu might cause minor layout shifts
        const scrollDifference = Math.abs(scrollAfterSlashMenu - scrollPositionBeforeSlashMenu);
        cy.task('log', `[STEP 11.2] Scroll difference: ${scrollDifference}px`);

        // The scroll should not jump to the top (which would be < 1000)
        // It should stay near the bottom
        expect(scrollAfterSlashMenu).to.be.greaterThan(scrollPositionBeforeSlashMenu - 200);

        if (scrollDifference > 100) {
          cy.task('log', `[WARNING] Scroll position changed by ${scrollDifference}px when opening slash menu`);
        }
      });

      // Step 11: Select Grid option from slash menu
      cy.task('log', '[STEP 12] Selecting Grid option from slash menu');
      let scrollBeforeGridCreation = 0;

      cy.get('@scrollContainer').then(($container) => {
        scrollBeforeGridCreation = $container[0].scrollTop;
        cy.task('log', `[STEP 12.1] Scroll position before creating grid: ${scrollBeforeGridCreation}`);
      });

      SlashCommandSelectors.slashPanel().within(() => {
        SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('grid')).first().as('gridMenuItem');
        cy.get('@gridMenuItem').should('be.visible').click();
      });

      waitForReactUpdate(2000);

      // Step 12: Verify the modal opened (database opens in a modal)
      cy.task('log', '[STEP 13] Verifying database modal opened');
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');

      // Step 13: CRITICAL CHECK - Verify scroll position is preserved after creating database
      cy.task('log', '[STEP 14] CRITICAL: Verifying scroll position after creating database');
      cy.get('@scrollContainer').then(($container) => {
        const scrollAfterGridCreation = $container[0].scrollTop;
        const scrollHeight = $container[0].scrollHeight;
        const clientHeight = $container[0].clientHeight;

        cy.task('log', `[STEP 14.1] Scroll position after creating grid: ${scrollAfterGridCreation}`);
        cy.task('log', `[STEP 14.2] scrollHeight: ${scrollHeight}, clientHeight: ${clientHeight}`);

        const scrollDifference = Math.abs(scrollAfterGridCreation - scrollBeforeGridCreation);
        cy.task('log', `[STEP 14.3] Scroll difference after grid creation: ${scrollDifference}px`);

        // CRITICAL ASSERTION: The document should NOT scroll to the top
        // If it scrolled to top, scrollAfterGridCreation would be close to 0
        // We expect it to stay near the bottom
        expect(scrollAfterGridCreation).to.be.greaterThan(scrollBeforeGridCreation - 300);

        // Also verify it's not at the very top
        expect(scrollAfterGridCreation).to.be.greaterThan(500);

        if (scrollAfterGridCreation < 500) {
          cy.task('log', `[CRITICAL FAILURE] Document scrolled to top! Position: ${scrollAfterGridCreation}`);
          throw new Error(`Document scrolled to top (position: ${scrollAfterGridCreation}) when creating grid at bottom`);
        }

        if (scrollDifference > 300) {
          cy.task('log', `[WARNING] Large scroll change detected: ${scrollDifference}px`);
        } else {
          cy.task('log', `[SUCCESS] Scroll position preserved! Difference: ${scrollDifference}px`);
        }
      });

      // Step 14: Close the modal and verify final state
      cy.task('log', '[STEP 15] Closing database modal');
      cy.get('[role="dialog"]').within(() => {
        cy.get('button').first().click(); // Click close button
      });

      waitForReactUpdate(1000);

      // Step 15: Verify the grid database was actually created in the document
      cy.task('log', '[STEP 16] Verifying grid database exists in document');
      cy.get('[class*="appflowy-database"]').should('exist');

      DatabaseGridSelectors.grid().should('exist');

      cy.task('log', '[TEST COMPLETE] Scroll preservation test passed successfully');
    });
  });
});
