import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Editor Tab Synchronization', () => {
  const testEmail = generateRandomEmail();
  let testPageUrl: string;

  before(() => {
    cy.viewport(1280, 720);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);
    
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

    cy.visit('/app');
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
    cy.wait(2000);
    
    // Capture the current URL to load in iframe
    cy.url().then(url => {
      testPageUrl = url;
    });
    
    // Clear editor for clean state
    EditorSelectors.firstEditor().click({ force: true });
    cy.focused().type('{selectall}{backspace}');
    waitForReactUpdate(500);
  });

  it('should sync changes between two "tabs" (iframe)', () => {
    // Inject an iframe pointing to the same URL to simulate a second tab
    // We append it to the body. 
    // Note: styling ensures it's visible for debugging but doesn't overlap too much
    cy.document().then((doc) => {
      const iframe = doc.createElement('iframe');
      iframe.src = testPageUrl;
      iframe.id = 'collab-iframe';
      iframe.style.width = '50%';
      iframe.style.height = '500px';
      iframe.style.position = 'fixed';
      iframe.style.bottom = '0';
      iframe.style.right = '0';
      iframe.style.border = '2px solid red';
      iframe.style.zIndex = '9999';
      doc.body.appendChild(iframe);
    });

    // Helper to access iframe body
    const getIframeBody = () => {
      return cy
        .get('#collab-iframe', { timeout: 30000 })
        .its('0.contentDocument.body').should('not.be.empty')
        .then(cy.wrap);
    };

    // Wait for iframe app to load
    getIframeBody().find('[data-slate-editor="true"]', { timeout: 30000 }).should('be.visible');

    // 1. Type in Main Window
    cy.log('Typing in Main Window');
    // Click topLeft to avoid iframe overlay at bottom right
    EditorSelectors.slateEditor().first().click('topLeft', { force: true }).type('Hello from Main');
    waitForReactUpdate(2000); // Wait longer for sync

    // 2. Verify in Iframe with longer timeout
    getIframeBody().find('[data-slate-editor="true"]', { timeout: 15000 }).should('contain.text', 'Hello from Main');

    // 3. Type in Iframe
    cy.log('Typing in Iframe');
    // Iframe editor might be small, force click to be safe
    getIframeBody().find('[data-slate-editor="true"]').click({ force: true }).type(' and Iframe');
    waitForReactUpdate(2000);

    // 4. Verify in Main Window with longer timeout
    EditorSelectors.slateEditor().should('contain.text', 'Hello from Main and Iframe');
  });
});
