// Integration test for legacy database visibility in the slash menu and mention panel.
//
// This test verifies:
// 1. Legacy databases (created before the Database Container feature in v0.10.7)
//    appear in the slash menu's "Link to existing database" picker.
// 2. Database child views (e.g. "View of Trip" Grid/Board under "Trip") do NOT
//    appear as duplicated entries in the mention panel's "Recent pages" list.
//
// The bug (slash menu): loadDatabasesForPicker() in SlashPanel.tsx only shows
// database containers (is_database_container === true) when any containers exist.
// Legacy databases don't have the is_database_container flag, so they are filtered
// out in mixed workspaces.
//
// The bug (mention panel): MentionPanel.tsx used flattenViews() which flattens
// every child view in the tree. Child views of databases (e.g. "View of Trip" Grid
// and "View of Trip" Board) have different view_ids, so uniqBy('view_id') does not
// deduplicate them, causing duplicate entries in "Recent pages".
//
// Test account: legacy_db_links@appflowy.io (contains Document A with legacy databases)
// - "Trip" - a legacy top-level database (Grid) with child views like "View of Trip"
// - "To-dos" - a legacy top-level database

import { getSlashMenuItemName } from '../../../support/i18n-constants';
import {
  EditorSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../../support/selectors';
import { testLog } from '../../../support/test-helpers';

const LEGACY_TEST_EMAIL = 'legacy_db_links@appflowy.io';
const TEST_DOCUMENT_NAME = 'Document A';

describe('Legacy Database - Slash Menu Visibility', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  it('legacy database "Trip" appears in slash menu linked grid picker', () => {
    testLog.testStart('Legacy database visibility in slash menu');

    // Step 1: Login with the legacy test account
    testLog.step(1, `Signing in as ${LEGACY_TEST_EMAIL}`);
    cy.signIn(LEGACY_TEST_EMAIL).then(() => {
      testLog.success('Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');

      // Wait for workspace sync from cloud
      testLog.step(2, 'Waiting for workspace sync from cloud');
      cy.wait(8000);

      // Step 3: Expand the "General" space in the sidebar (it may be collapsed)
      testLog.step(3, 'Expanding "General" space in sidebar');
      SpaceSelectors.itemByName('General', { timeout: 30000 })
        .should('be.visible')
        .click();
      waitForReactUpdate(2000);

      // Step 3b: Expand "Getting started" — Document A is nested under it
      testLog.step(3, 'Expanding "Getting started" in sidebar');
      cy.contains('[data-testid="page-name"]', 'Getting started', {
        timeout: 15000,
      })
        .first()
        .closest('[data-testid="page-item"]')
        .find('button')
        .first()
        .click({ force: true });
      waitForReactUpdate(2000);

      // Step 4: Navigate to "Document A"
      // "Document A" is nested under "Getting started" which we expanded above.
      testLog.step(4, `Navigating to "${TEST_DOCUMENT_NAME}"`);
      cy.contains('[data-testid="page-name"]', TEST_DOCUMENT_NAME, {
        timeout: 15000,
      })
        .first()
        .click({ force: true });
      waitForReactUpdate(3000);

      // Step 5: Wait for editor to load
      testLog.step(5, 'Waiting for editor to load');
      EditorSelectors.firstEditor().should('exist', { timeout: 15000 });

      // Step 6: Click in the editor and open slash menu
      // The document has embedded databases so the editor center may be offscreen.
      // Use force:true to click and focus the editor regardless.
      testLog.step(6, 'Opening slash menu');
      EditorSelectors.firstEditor().click({ force: true });
      waitForReactUpdate(500);
      EditorSelectors.firstEditor().type('/');
      waitForReactUpdate(500);

      // Step 7: Select "Linked Grid" from the slash menu
      testLog.step(7, 'Selecting "Linked Grid" from slash menu');
      SlashCommandSelectors.slashPanel()
        .should('be.visible')
        .within(() => {
          SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('linkedGrid'))
            .first()
            .click();
        });
      waitForReactUpdate(1000);

      // Step 8: Verify the database picker popover appears
      testLog.step(8, 'Verifying database picker is shown');
      cy.contains('Link to an existing database', { timeout: 10000 }).should(
        'be.visible',
      );

      // Wait for loading to complete
      cy.get('body').then(($body) => {
        if ($body.text().includes('Loading...')) {
          cy.contains('Loading...', { timeout: 15000 }).should('not.exist');
        }
      });

      // Step 9: Search for "Trip" in the database picker
      testLog.step(9, 'Searching for "Trip" in database picker');
      cy.get('.MuiPopover-paper')
        .last()
        .should('be.visible')
        .within(() => {
          cy.get('input[placeholder*="Search"]')
            .should('be.visible')
            .clear()
            .type('Trip');
          waitForReactUpdate(2000);

          // THE KEY ASSERTION: The "Trip" legacy database should appear in the picker.
          // This fails without the fix because loadDatabasesForPicker() in SlashPanel.tsx
          // filters out legacy databases when any database containers exist.
          testLog.step(10, 'Asserting "Trip" database is visible');
          cy.contains('span', 'Trip').should('exist');
          testLog.success(
            'Legacy database "Trip" is visible in the slash menu picker',
          );
        });

      testLog.testEnd('Legacy database visibility in slash menu');
    });
  });

  it('mention panel does not show duplicate database child views when searching', () => {
    testLog.testStart('No duplicate database child views in mention panel');

    // Step 1: Login with the legacy test account
    testLog.step(1, `Signing in as ${LEGACY_TEST_EMAIL}`);
    cy.signIn(LEGACY_TEST_EMAIL).then(() => {
      testLog.success('Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');

      // Wait for workspace sync from cloud
      testLog.step(2, 'Waiting for workspace sync from cloud');
      cy.wait(8000);

      // Step 3: Expand the "General" space in the sidebar
      testLog.step(3, 'Expanding "General" space in sidebar');
      SpaceSelectors.itemByName('General', { timeout: 30000 })
        .should('be.visible')
        .click();
      waitForReactUpdate(2000);

      // Step 3b: Expand "Getting started" — Document A is nested under it
      testLog.step(3, 'Expanding "Getting started" in sidebar');
      cy.contains('[data-testid="page-name"]', 'Getting started', {
        timeout: 15000,
      })
        .first()
        .closest('[data-testid="page-item"]')
        .find('button')
        .first()
        .click({ force: true });
      waitForReactUpdate(2000);

      // Step 4: Navigate to "Document A"
      testLog.step(4, `Navigating to "${TEST_DOCUMENT_NAME}"`);
      cy.contains('[data-testid="page-name"]', TEST_DOCUMENT_NAME, {
        timeout: 15000,
      })
        .first()
        .click({ force: true });
      waitForReactUpdate(3000);

      // Step 5: Wait for editor to load
      testLog.step(5, 'Waiting for editor to load');
      EditorSelectors.firstEditor().should('exist', { timeout: 15000 });

      // Step 6: Open mention panel by typing "@"
      testLog.step(6, 'Opening mention panel with @');
      EditorSelectors.firstEditor().click({ force: true });
      waitForReactUpdate(500);
      EditorSelectors.firstEditor().type('@');
      waitForReactUpdate(1000);

      // Step 7: Verify the mention panel appears
      testLog.step(7, 'Verifying mention panel is shown');
      cy.get('[data-testid="mention-panel"]', { timeout: 10000 }).should(
        'be.visible',
      );

      // Step 8: Search for "trip" in the mention panel to filter results
      testLog.step(8, 'Typing "trip" to filter mention results');
      EditorSelectors.firstEditor().type('trip');
      waitForReactUpdate(1000);

      // Step 9: Assert that "View of Trip" does NOT appear in the mention panel.
      // Database child views should be filtered out — only the parent database
      // ("Trip") should be linkable, not its child views ("View of Trip").
      testLog.step(9, 'Asserting no duplicate "View of Trip" entries');
      cy.get('[data-testid="mention-panel"]').within(() => {
        cy.get('button').then(($buttons) => {
          const viewOfTripButtons = $buttons.filter((_, el) => {
            return el.textContent?.trim() === 'View of Trip';
          });

          testLog.info(
            `Found ${viewOfTripButtons.length} "View of Trip" button(s) in mention panel`,
          );

          // There should be zero "View of Trip" entries — they are child views
          // of the "Trip" database and should not appear as standalone pages.
          expect(viewOfTripButtons.length).to.equal(
            0,
            'Database child views like "View of Trip" should not appear in mention panel',
          );
        });

        // Additionally verify that "Trip" itself IS present (the parent database)
        cy.contains('button', 'Trip').should('exist');
        testLog.success(
          'No duplicate "View of Trip" entries found; parent "Trip" is present',
        );
      });

      testLog.testEnd('No duplicate database child views in mention panel');
    });
  });
});
