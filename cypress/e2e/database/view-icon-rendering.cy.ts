import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  DatabaseViewSelectors,
  PageSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { testLog } from '../../support/test-helpers';

/**
 * Tests for ViewIcon rendering after className whitespace fix.
 * Verifies that icons render correctly without trailing whitespace in className.
 */
describe('ViewIcon Rendering', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const spaceName = 'General';

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  const ensureSpaceExpanded = (name: string) => {
    SpaceSelectors.itemByName(name).should('exist');
    SpaceSelectors.itemByName(name).then(($space) => {
      const expandedIndicator = $space.find('[data-testid="space-expanded"]');
      const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

      if (!isExpanded) {
        SpaceSelectors.itemByName(name).find('[data-testid="space-name"]').click({ force: true });
        waitForReactUpdate(500);
      }
    });
  };

  it('should render Grid, Board, and Calendar icons correctly in view tabs', () => {
    const testEmail = generateRandomEmail();

    testLog.info(`[TEST] ViewIcon rendering - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create a Grid database
      testLog.info('[STEP 1] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Verify Grid view tab exists and has icon
      testLog.info('[STEP 2] Verifying Grid view tab has icon');
      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist');
      DatabaseViewSelectors.viewTab().should('have.length.at.least', 1);

      // Add Board view
      testLog.info('[STEP 3] Creating Board view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);

      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });
      waitForReactUpdate(3000);

      // Add Calendar view
      testLog.info('[STEP 4] Creating Calendar view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);

      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Calendar')
        .click({ force: true });
      waitForReactUpdate(3000);

      // Verify all view tabs have icons (SVG elements)
      testLog.info('[STEP 5] Verifying all view tabs have icons');
      DatabaseViewSelectors.viewTab().each(($tab) => {
        // Each tab should contain an SVG icon
        cy.wrap($tab).find('svg').should('exist');
      });

      testLog.info('[TEST COMPLETE] All view icons rendered correctly');
    });
  });

  it('should render icons without trailing whitespace in className', () => {
    const testEmail = generateRandomEmail();

    testLog.info(`[TEST] ViewIcon className check - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create a Grid database
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Verify Grid view tab icon doesn't have trailing whitespace in class
      testLog.info('[STEP] Checking icon className for trailing whitespace');
      DatabaseViewSelectors.viewTab()
        .first()
        .find('svg')
        .should('exist')
        .invoke('attr', 'class')
        .then((className) => {
          if (className) {
            // Check for trailing whitespace
            const hasTrailingWhitespace = className !== className.trim();
            expect(hasTrailingWhitespace).to.be.false;

            // Check for double spaces
            const hasDoubleSpaces = className.includes('  ');
            expect(hasDoubleSpaces).to.be.false;

            testLog.info(`Icon className: "${className}" - No trailing whitespace`);
          }
        });

      testLog.info('[TEST COMPLETE] Icons have clean className without trailing whitespace');
    });
  });

  it('should render view icons in sidebar correctly', () => {
    const testEmail = generateRandomEmail();

    testLog.info(`[TEST] Sidebar view icons - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create a Grid database
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Add Board view
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);
      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });
      waitForReactUpdate(3000);

      // Expand database in sidebar to see children
      ensureSpaceExpanded(spaceName);
      waitForReactUpdate(500);

      PageSelectors.itemByName('New Database', { timeout: 10000 }).then(($dbItem) => {
        const expandToggle = $dbItem.find('[data-testid="outline-toggle-expand"]');
        if (expandToggle.length > 0) {
          cy.wrap(expandToggle.first()).click({ force: true });
          waitForReactUpdate(500);
        }
      });

      // Verify sidebar view items exist
      testLog.info('[STEP] Verifying sidebar view items exist');
      PageSelectors.itemByName('New Database', { timeout: 10000 }).within(() => {
        // Check that Grid and Board views exist
        cy.contains('Grid').should('exist');
        cy.contains('Board').should('exist');
      });

      // Verify view icons are rendered in the page items (icons are siblings, not children of name)
      // Look for SVG elements within page-item containers
      PageSelectors.itemByName('New Database', { timeout: 10000 })
        .find('[data-testid="page-item"]')
        .should('have.length.at.least', 2)
        .each(($item) => {
          // Each page item should have an SVG icon somewhere in its structure
          cy.wrap($item).find('svg').should('exist');
        });

      testLog.info('[TEST COMPLETE] Sidebar view icons rendered correctly');
    });
  });
});
