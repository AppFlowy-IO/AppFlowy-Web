import { AuthTestUtils } from '../../support/auth-utils';
import { AddPageSelectors, EditorSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('View Modal', () => {
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

  it('creates a document and allows editing in ViewModal', () => {
    const testEmail = generateRandomEmail();
    const modalText = `modal-test-${Date.now()}`;

    testLog.testStart('ViewModal document creation');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      testLog.step(1, 'Create a new document (opens ViewModal)');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      testLog.step(2, 'Verify ViewModal is open');
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');

      testLog.step(3, 'Verify URL updated with new document');
      cy.url({ timeout: 15000 }).should('match', /\/app\/[^/]+\/[^/]+/);

      testLog.step(4, 'Type text in ViewModal editor');
      cy.get('[role="dialog"]').within(() => {
        EditorSelectors.slateEditor()
          .first()
          .click('topLeft', { force: true })
          .type(modalText, { force: true });
      });
      waitForReactUpdate(1500);

      testLog.step(5, 'Verify text appears in editor');
      cy.get('[role="dialog"]')
        .find('[data-slate-editor="true"]', { timeout: 10000 })
        .should('contain.text', modalText);
    });
  });
});
