import { v4 as uuidv4 } from 'uuid';
import { EditorSelectors, waitForReactUpdate, AddPageSelectors } from '../../../support/selectors';

describe('Download Image Test', () => {
  const testEmail = `${uuidv4()}@appflowy.io`;

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);

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

  it('should download image when clicking download button', () => {
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

    // Ensure focus
    EditorSelectors.firstEditor().focus();
    waitForReactUpdate(500);

    // Type '/' to open slash menu
    EditorSelectors.firstEditor().type('/', { force: true });
    waitForReactUpdate(1000);

    // Check if slash panel exists
    cy.get('[data-testid="slash-panel"]').should('exist').should('be.visible');

    // Type 'image' to filter
    EditorSelectors.firstEditor().type('image', { force: true });
    waitForReactUpdate(1000);

    // Click Image item
    cy.get('[data-testid^="slash-menu-"]').contains(/^Image$/).click({ force: true });
    waitForReactUpdate(1000);

    // Upload image directly
    cy.get('input[type="file"]').attachFile('appflowy.png');
    waitForReactUpdate(2000);

    waitForReactUpdate(2000);

    // Find the image block and hover to show toolbar
    cy.get('[data-block-type="image"]').first().should('exist');
    // Use realHover from cypress-real-events for proper mouse enter behavior
    cy.get('[data-block-type="image"]').first().realHover();
    waitForReactUpdate(1000);

    // Click the download button
    cy.get('[data-testid="download-image-button"]').should('exist').click({ force: true });

    // Verify success notification appears
    cy.contains('Image downloaded successfully').should('exist');
  });
});
