import { AuthTestUtils } from '../../support/auth-utils';
import { AddPageSelectors, EditorSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('View Modal Sync', () => {
  const getWorkspaceIdFromPath = () =>
    cy.location('pathname').then((pathname) => {
      const parts = pathname.split('/').filter(Boolean);
      return parts[1] || '';
    });

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

  it('syncs edits from ViewModal to full page view', () => {
    const testEmail = generateRandomEmail();
    const modalText = `modal-sync-${Date.now()}`;
    const iframeText = `iframe-sync-${Date.now()}`;

    testLog.testStart('ViewModal sync');
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

      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');

      testLog.step(2, 'Capture modal viewId and open iframe');
      cy.get('[role="dialog"]')
        .find('[id^="editor-"]')
        .first()
        .invoke('attr', 'id')
        .then((id) => {
          const viewId = (id || '').replace('editor-', '');
          expect(viewId).to.not.equal('');
          cy.wrap(viewId).as('modalViewId');
        });

      getWorkspaceIdFromPath().then((workspaceId) => {
        expect(workspaceId).to.not.equal('');
        cy.wrap(workspaceId).as('workspaceId');
      });

      cy.get<string>('@workspaceId').then((workspaceId) => {
        cy.get<string>('@modalViewId').then((viewId) => {
          const iframeUrl = `/app/${workspaceId}/${viewId}`;

          cy.document().then((doc) => {
            const iframe = doc.createElement('iframe');
            iframe.src = iframeUrl;
            iframe.id = 'view-modal-sync-iframe';
            iframe.style.width = '50%';
            iframe.style.height = '500px';
            iframe.style.position = 'fixed';
            iframe.style.bottom = '0';
            iframe.style.right = '0';
            iframe.style.border = '2px solid #3b82f6';
            iframe.style.zIndex = '9999';
            doc.body.appendChild(iframe);
          });
        });
      });

      const getIframeBody = () =>
        cy
          .get('#view-modal-sync-iframe', { timeout: 30000 })
          .its('0.contentDocument.body')
          .should('not.be.empty')
          .then(cy.wrap);

      getIframeBody().find('[data-slate-editor="true"]', { timeout: 30000 }).should('be.visible');

      testLog.step(3, 'Type in ViewModal');
      cy.get('[role="dialog"]').within(() => {
        EditorSelectors.slateEditor().first().click('topLeft', { force: true }).type(modalText);
      });
      waitForReactUpdate(1500);

      testLog.step(4, 'Verify text appears in iframe');
      getIframeBody()
        .find('[data-slate-editor="true"]', { timeout: 15000 })
        .should('contain.text', modalText);

      testLog.step(5, 'Type in iframe and verify modal');
      getIframeBody().find('[data-slate-editor="true"]').click({ force: true }).type(iframeText);
      waitForReactUpdate(1500);

      cy.get('[role="dialog"]')
        .find('[data-slate-editor="true"]', { timeout: 15000 })
        .should('contain.text', iframeText);
    });
  });
});
