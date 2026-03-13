/**
 * Editor Panel Stability E2E Tests
 *
 * Verifies that the editor slash command panel and context providers
 * work correctly after stabilization fixes.
 *
 * Regression tests for:
 * - PanelsContext: isPanelOpen callback made stable with ref (no unnecessary re-renders)
 * - EditorContext: split into config + local state contexts
 */
import { v4 as uuidv4 } from 'uuid';
import { EditorSelectors, AddPageSelectors, waitForReactUpdate } from '../../../support/selectors';

describe('Editor Panel Stability', () => {
  const testEmail = `${uuidv4()}@appflowy.io`;

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Minified React error')
      ) {
        return false;
      }

      return true;
    });

    cy.signIn(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForReactUpdate(1000);
    });
  });

  /**
   * Helper: Create a page and focus the editor.
   */
  const createPageAndFocusEditor = () => {
    AddPageSelectors.inlineAddButton().first().click();
    waitForReactUpdate(500);
    cy.get('[role="menuitem"]').first().click(); // Create Doc
    waitForReactUpdate(1000);

    // Close the modal
    cy.get('[role="dialog"]').should('exist');
    cy.get('[role="dialog"]').find('button').filter(':visible').last().click({ force: true });
    waitForReactUpdate(1000);

    EditorSelectors.firstEditor().should('exist').click({ force: true });
    waitForReactUpdate(1000);
    EditorSelectors.firstEditor().focus();
    waitForReactUpdate(500);
  };

  it('should open and close slash panel without errors', () => {
    createPageAndFocusEditor();

    // Open slash panel
    EditorSelectors.firstEditor().type('/', { force: true });
    waitForReactUpdate(1000);

    cy.get('[data-testid="slash-panel"]').should('exist').should('be.visible');

    // Close with Escape
    cy.focused().type('{esc}', { force: true });
    waitForReactUpdate(500);

    cy.get('[data-testid="slash-panel"]').should('not.exist');
  });

  it('should handle rapid open/close slash panel cycles', () => {
    createPageAndFocusEditor();

    // Rapidly open and close the slash panel to test isPanelOpen stability
    for (let i = 0; i < 3; i++) {
      EditorSelectors.firstEditor().type('/', { force: true });
      waitForReactUpdate(500);

      cy.get('[data-testid="slash-panel"]').should('exist');

      cy.focused().type('{esc}', { force: true });
      waitForReactUpdate(500);

      cy.get('[data-testid="slash-panel"]').should('not.exist');
    }
  });

  it('should filter slash panel items and select one without panel state errors', () => {
    createPageAndFocusEditor();

    // Open slash panel and filter
    EditorSelectors.firstEditor().type('/', { force: true });
    waitForReactUpdate(1000);

    cy.get('[data-testid="slash-panel"]').should('exist');

    // Type to filter
    EditorSelectors.firstEditor().type('heading', { force: true });
    waitForReactUpdate(500);

    // Select an item — this triggers panel close via the panel context
    cy.get('[data-testid^="slash-menu-"]').contains('Heading 1').first().click({ force: true });
    waitForReactUpdate(500);

    // Panel should be closed and heading should be inserted
    cy.get('[data-testid="slash-panel"]').should('not.exist');
    cy.get('[data-block-type="heading"]').should('exist');
  });

  it('should switch between different panel types (slash → mention)', () => {
    createPageAndFocusEditor();

    // Open slash panel
    EditorSelectors.firstEditor().type('/', { force: true });
    waitForReactUpdate(1000);
    cy.get('[data-testid="slash-panel"]').should('exist');

    // Close it
    cy.focused().type('{esc}', { force: true });
    waitForReactUpdate(500);
    cy.get('[data-testid="slash-panel"]').should('not.exist');

    // Type some text then trigger mention with '@'
    EditorSelectors.firstEditor().type('Hello ', { force: true });
    waitForReactUpdate(300);

    EditorSelectors.firstEditor().type('@', { force: true });
    waitForReactUpdate(1000);

    // Close mention panel
    cy.focused().type('{esc}', { force: true });
    waitForReactUpdate(500);

    // Editor should still be functional
    EditorSelectors.firstEditor().should('exist');
  });
});
