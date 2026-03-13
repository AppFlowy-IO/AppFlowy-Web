/**
 * Image Toolbar Hover E2E Tests
 *
 * Verifies that hovering over an image block shows the toolbar with all
 * action buttons (including Align) without crashing.
 *
 * Regression test for: Align component used useSelectionToolbarContext() which
 * threw when rendered outside SelectionToolbarContext.Provider (i.e., from ImageToolbar).
 */
import { v4 as uuidv4 } from 'uuid';
import { EditorSelectors, waitForReactUpdate, AddPageSelectors } from '../../../support/selectors';

describe('Image Toolbar Hover Actions', () => {
  const testEmail = `${uuidv4()}@appflowy.io`;

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      // Fail the test if we see the specific context error we fixed
      if (err.message.includes('useSelectionToolbarContext must be used within')) {
        return true; // Let it fail the test
      }

      // Suppress other transient errors
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Minified React error')
      ) {
        return false;
      }

      return true;
    });

    // Mock the image fetch
    cy.intercept('GET', '**/logo.png', {
      statusCode: 200,
      fixture: 'appflowy.png',
      headers: {
        'content-type': 'image/png',
      },
    }).as('getImage');

    cy.signIn(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForReactUpdate(1000);
    });
  });

  /**
   * Helper: Create a page, insert an image block, and wait for it to render.
   */
  const insertImageBlock = () => {
    // Create a new page
    AddPageSelectors.inlineAddButton().first().click();
    waitForReactUpdate(500);
    cy.get('[role="menuitem"]').first().click(); // Create Doc
    waitForReactUpdate(1000);

    // Close the modal that opens after creating a page
    cy.get('[role="dialog"]').should('exist');
    cy.get('[role="dialog"]').find('button').filter(':visible').last().click({ force: true });
    waitForReactUpdate(1000);

    // Focus editor
    EditorSelectors.firstEditor().should('exist').click({ force: true });
    waitForReactUpdate(1000);
    EditorSelectors.firstEditor().focus();
    waitForReactUpdate(500);

    // Type '/' to open slash menu and insert image
    EditorSelectors.firstEditor().type('/', { force: true });
    waitForReactUpdate(1000);
    cy.get('[data-testid="slash-panel"]').should('exist').should('be.visible');
    EditorSelectors.firstEditor().type('image', { force: true });
    waitForReactUpdate(1000);
    cy.get('[data-testid^="slash-menu-"]').contains(/^Image$/).click({ force: true });
    waitForReactUpdate(1000);

    // Upload image
    cy.get('input[type="file"]').attachFile('appflowy.png');
    waitForReactUpdate(3000);

    // Verify image block exists
    cy.get('[data-block-type="image"]').should('have.length.at.least', 1);
  };

  it('should show toolbar with all actions when hovering over image (regression: Align outside SelectionToolbarContext)', () => {
    insertImageBlock();

    // Hover over the image block to trigger toolbar
    cy.get('[data-block-type="image"]').first().realHover();
    waitForReactUpdate(1000);

    // Verify toolbar actions are visible without errors
    cy.get('[data-testid="copy-image-button"]').should('exist').and('be.visible');
    cy.get('[data-testid="download-image-button"]').should('exist').and('be.visible');

    // The Align button should be rendered without crashing
    // (This was the exact bug: Align threw because it called useSelectionToolbarContext outside the Provider)
    cy.get('[data-block-type="image"]').first().find('.absolute.right-0.top-0').should('exist');
  });

  it('should show toolbar on hover and hide on mouse leave', () => {
    insertImageBlock();

    // Hover to show toolbar
    cy.get('[data-block-type="image"]').first().realHover();
    waitForReactUpdate(1000);
    cy.get('[data-testid="copy-image-button"]').should('exist');

    // Move mouse away to hide toolbar
    EditorSelectors.firstEditor().realHover({ position: 'topLeft' });
    waitForReactUpdate(1000);

    // Toolbar should be hidden
    cy.get('[data-testid="copy-image-button"]').should('not.exist');
  });

  it('should allow repeated hover/unhover cycles without errors', () => {
    insertImageBlock();

    // Hover and unhover multiple times to ensure no stale state or context errors
    for (let i = 0; i < 3; i++) {
      cy.get('[data-block-type="image"]').first().realHover();
      waitForReactUpdate(500);
      cy.get('[data-testid="copy-image-button"]').should('exist');

      EditorSelectors.firstEditor().realHover({ position: 'topLeft' });
      waitForReactUpdate(500);
    }
  });
});
