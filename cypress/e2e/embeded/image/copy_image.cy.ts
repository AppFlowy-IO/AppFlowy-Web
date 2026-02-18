import { v4 as uuidv4 } from 'uuid';
import { EditorSelectors, waitForReactUpdate, AddPageSelectors } from '../../../support/selectors';

describe('Copy Image Test', () => {
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

      // Mock the clipboard write AFTER navigation to /app
      cy.window().then((win) => {
        // Stub the clipboard.write to capture what's being written
        const writeStub = cy.stub().as('clipboardWrite').resolves();
        if (win.navigator.clipboard) {
          cy.stub(win.navigator.clipboard, 'write').callsFake(writeStub);
        } else {
          Object.defineProperty(win.navigator, 'clipboard', {
            value: { write: writeStub },
            configurable: true,
            writable: true
          });
        }
      });
    });
  });

  it('should copy image to clipboard when clicking copy button', () => {
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
    cy.get('input[type=\"file\"]').attachFile('appflowy.png');
    waitForReactUpdate(2000);

    waitForReactUpdate(2000);

    // Verify we have at least 1 image block
    cy.get('[data-block-type="image"]').should('have.length.at.least', 1);

    // Find the image block and hover to show toolbar
    cy.get('[data-block-type="image"]').first().should('exist');
    // Use realHover from cypress-real-events for proper mouse enter behavior
    cy.get('[data-block-type="image"]').first().realHover();
    waitForReactUpdate(1000);

    // Click the copy button
    cy.get('[data-testid="copy-image-button"]').should('exist').click({ force: true });
    waitForReactUpdate(1000);

    // Verify clipboard write was called with image data
    cy.get('@clipboardWrite').should('have.been.called');
    cy.get('@clipboardWrite').then((stub: any) => {
      // The clipboard.write is called with an array of ClipboardItems
      // Each ClipboardItem has a types property
      expect(stub.called).to.be.true;
      const args = stub.args[0];
      expect(args).to.have.length(1);
      const clipboardItems = args[0];
      expect(clipboardItems).to.have.length(1);
      const clipboardItem = clipboardItems[0];
      // Verify it's writing image/png
      expect(clipboardItem.types).to.include('image/png');
    });
  });
});
