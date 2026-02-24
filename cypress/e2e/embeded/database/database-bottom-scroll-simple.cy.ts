import { getSlashMenuItemName } from '../../../support/i18n-constants';
import {
  EditorSelectors,
  SlashCommandSelectors,
  waitForReactUpdate
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Embedded Database - Bottom Scroll Preservation (Simplified)', () => {

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

  it('should preserve scroll position when creating grid at bottom', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST] Email: ${testEmail}`);

    // Login

    // Use cy.session for authentication like the working tests
    cy.session(testEmail, () => {
      cy.signIn(testEmail);
    }, {
      validate: () => {
        cy.window().then((win) => {
          const token = win.localStorage.getItem('af_auth_token');
          expect(token).to.be.ok;
        });
      }
    });

    // Visit app and open Getting Started document (like working tests)
    cy.visit('/app');
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
    cy.wait(2000);

    // Clear existing content and add 30 lines
    EditorSelectors.firstEditor().click({ force: true });
    cy.focused().type('{selectall}{backspace}');
    waitForReactUpdate(500);

    let content = '';
    for (let i = 1; i <= 30; i++) {
      content += `Line ${i} content{enter}`;
    }
    cy.focused().type(content, { delay: 1 });
    waitForReactUpdate(2000);

    // Scroll to bottom
    cy.get('.appflowy-scroll-container').first().then($container => {
      const scrollHeight = $container[0].scrollHeight;
      const clientHeight = $container[0].clientHeight;
      const targetScroll = scrollHeight - clientHeight;

      // Scroll to bottom using DOM
      $container[0].scrollTop = targetScroll;
      cy.task('log', `[SCROLL] Scrolled to: ${targetScroll}`);
    });

    cy.wait(1000); // Give more time for any scroll settling

    // Record scroll position and store it globally so code can access it
    let scrollBefore = 0;
    cy.get('.appflowy-scroll-container').first().then($container => {
      scrollBefore = $container[0].scrollTop;
      cy.task('log', `[SCROLL] Immediately before typing "/": ${scrollBefore}`);

      // Store in window so our code can access it
      cy.window().then((win) => {
        win.__CYPRESS_EXPECTED_SCROLL__ = scrollBefore;
      });
    });

    // Create database at bottom (cursor already at end from previous typing, just type "/")
    // Don't click - clicking might cause scroll. Use cy.focused() since cursor is already there.
    cy.focused().type('/', { delay: 0 });
    waitForReactUpdate(500);

    SlashCommandSelectors.slashPanel().should('be.visible').within(() => {
      SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('grid')).first().click();
    });

    waitForReactUpdate(2000);

    // Check modal opened
    cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');

    // CRITICAL: Verify scroll position is preserved (didn't jump to top)
    cy.get('.appflowy-scroll-container').first().then($container => {
      const scrollAfter = $container[0].scrollTop;
      const scrollDelta = Math.abs(scrollAfter - scrollBefore);

      cy.task('log', `[SCROLL] After grid creation: ${scrollAfter}`);
      cy.task('log', `[SCROLL] Scroll delta: ${scrollBefore} -> ${scrollAfter} (changed by ${scrollAfter - scrollBefore})`);

      // Verify scroll didn't jump to top (the bug we're testing for)
      if (scrollAfter < 200) {
        cy.task('log', `[FAIL] Document scrolled to top (${scrollAfter})! This is the bug we are testing for.`);
      }

      // Should NOT scroll to top (scrollAfter should be > 200)
      expect(scrollAfter).to.be.greaterThan(200,
        `Document should not scroll to top when creating database at bottom. Before: ${scrollBefore}, After: ${scrollAfter}`);

      // Verify scroll stayed close to original position (within 100px tolerance)
      // This ensures we not only avoided scrolling to top, but preserved the actual position
      expect(scrollDelta).to.be.lessThan(100,
        `Scroll position should be preserved within 100px. Before: ${scrollBefore}, After: ${scrollAfter}, Delta: ${scrollDelta}`);

      cy.task('log', `[SUCCESS] Scroll preserved! Before: ${scrollBefore}, After: ${scrollAfter}, Delta: ${scrollDelta}px`);
    });
  });
});
