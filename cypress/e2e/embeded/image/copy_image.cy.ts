import { v4 as uuidv4 } from 'uuid';
import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate, SlashCommandSelectors, AddPageSelectors } from '../../../support/selectors';

describe('Copy Image Test', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = `${uuidv4()}@appflowy.io`;
  const mockFileId = 'mock-file-id-12345';

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);

    // Mock the file upload API - this is critical for the image to render
    cy.intercept('PUT', '**/v1/blob/**', {
      statusCode: 200,
      body: {
        code: 0,
        message: 'success',
        data: {
          file_id: mockFileId,
        },
      },
    }).as('uploadFile');

    // Mock the file URL endpoint to return the fixture image
    cy.intercept('GET', `**/v1/blob/**/${mockFileId}`, {
      statusCode: 200,
      fixture: 'appflowy.png',
      headers: {
        'content-type': 'image/png',
      },
    }).as('getUploadedFile');

    // Mock the image fetch
    cy.intercept('GET', '**/logo.png', {
      statusCode: 200,
      fixture: 'appflowy.png',
      headers: {
        'content-type': 'image/png',
      },
    }).as('getImage');

    // We need to mock the clipboard write
    cy.window().then((win) => {
        // Check if clipboard exists
        if (win.navigator.clipboard) {
             cy.stub(win.navigator.clipboard, 'write').as('clipboardWrite');
        } else {
             // Mock clipboard if it doesn't exist or is not writable directly
             // In some browsers, we might need to redefine the property
             const clipboardMock = {
                 write: cy.stub().as('clipboardWrite')
             };
             try {
                 // @ts-ignore
                 win.navigator.clipboard = clipboardMock;
             } catch (e) {
                 Object.defineProperty(win.navigator, 'clipboard', {
                     value: clipboardMock,
                     configurable: true,
                     writable: true
                 });
             }
        }
    });

    cy.visit('/login', { failOnStatusCode: false });
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      waitForReactUpdate(1000);
    });
  });

  // Skip: Image upload doesn't work properly in test environment.
  // The EditorContext's uploadFile function isn't configured, so the app falls back to
  // FileHandler (local IndexedDB storage) which doesn't set the URL needed for rendering.
  // The image block is created but the img tag doesn't render, so the copy button never appears.
  it.skip('should copy image to clipboard when clicking copy button', () => {
     // Create a new page
     AddPageSelectors.inlineAddButton().first().click();
     waitForReactUpdate(500);
     cy.get('[role="menuitem"]').first().click(); // Create Doc
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

     // Wait for the upload to complete
     cy.wait('@uploadFile', { timeout: 15000 });
     waitForReactUpdate(3000);

     // The image should now be rendered.
     // We need to hover or click it to see the toolbar.
     // The toolbar is only visible when the block is selected/focused or hovered.

     // Find the image block and verify it has an image
     cy.get('[data-block-type="image"]', { timeout: 15000 }).first().should('exist');

     // Wait for image to render inside the block (might be img tag or have background-image)
     cy.get('[data-block-type="image"]').first().find('img').should('exist').and('be.visible');

     // Hover over the image block to show toolbar
     cy.get('[data-block-type="image"]').first().trigger('mouseover', { force: true }).click({ force: true });
     waitForReactUpdate(1000);

     // Click the copy button
     cy.get('[data-testid="copy-image-button"]', { timeout: 10000 }).should('exist').click({ force: true });

     // Verify clipboard write
     cy.get('@clipboardWrite').should('have.been.called');
     cy.get('@clipboardWrite').should((stub: unknown) => {
       const typedStub = stub as Cypress.Agent<sinon.SinonStub>;
       const clipboardItem = typedStub.args[0][0][0];
       expect(clipboardItem).to.be.instanceOf(ClipboardItem);
       expect(clipboardItem.types).to.include('image/png');
     });
  });
});
