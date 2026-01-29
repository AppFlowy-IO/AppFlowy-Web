import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../../support/auth-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';
import { testLog } from '../../../support/test-helpers';
import {
  AddPageSelectors,
  BlockSelectors,
  DatabaseGridSelectors,
  PageSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../../support/selectors';

describe('Embedded Database Sync', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Database';
  const spaceName = 'General';

  const getWorkspaceIdFromPath = () =>
    cy.location('pathname').then((pathname) => {
      const parts = pathname.split('/').filter(Boolean);
      return parts[1] || '';
    });

  const currentViewIdFromUrl = () =>
    cy.location('pathname').then((pathname) => {
      const parts = pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
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

  const ensurePageExpandedByViewId = (viewId: string) => {
    const pageItem = () => PageSelectors.itemByViewId(viewId, { timeout: 30000 });

    pageItem().should('exist');
    pageItem().then(($pageItem) => {
      const collapseToggle = $pageItem.find('[data-testid="outline-toggle-collapse"]');
      if (collapseToggle.length > 0) {
        return;
      }

      const expandToggle = $pageItem.find('[data-testid="outline-toggle-expand"]');
      if (expandToggle.length > 0) {
        cy.wrap(expandToggle.first()).click({ force: true });
        waitForReactUpdate(500);
      }
    });
  };

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

  it('syncs embedded database edits to full database view', () => {
    const testEmail = generateRandomEmail();
    const cellText = `embed-sync-${Date.now()}`;

    testLog.testStart('Embedded database sync');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      testLog.step(1, 'Create a document page (opens ViewModal)');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Expand modal to full page view.
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
      cy.get('[role="dialog"]').find('button').first().click({ force: true });
      waitForReactUpdate(1000);

      currentViewIdFromUrl().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });

      testLog.step(2, 'Insert embedded Grid database via slash menu');
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel().should('be.visible').within(() => {
        SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('grid')).first().click({ force: true });
      });

      // Ensure embedded database block appears
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).find(BlockSelectors.blockSelector('grid')).should('exist');
        cy.get(`#editor-${docViewId}`).find('[data-testid="database-grid"]').should('exist');
      });

      waitForReactUpdate(3000);

      testLog.step(3, 'Locate database view id in sidebar');
      ensureSpaceExpanded(spaceName);
      cy.get<string>('@docViewId').then((docViewId) => {
        ensurePageExpandedByViewId(docViewId);
      });

      PageSelectors.firstChildViewIdByName(dbName).then((dbViewId) => {
        expect(dbViewId).to.not.equal('');
        cy.wrap(dbViewId).as('dbViewId');
      });

      getWorkspaceIdFromPath().then((workspaceId) => {
        expect(workspaceId).to.not.equal('');
        cy.wrap(workspaceId).as('workspaceId');
      });

      testLog.step(4, 'Open full database view in iframe');
      cy.get<string>('@workspaceId').then((workspaceId) => {
        cy.get<string>('@dbViewId').then((dbViewId) => {
          const iframeUrl = `/app/${workspaceId}/${dbViewId}`;

          cy.document().then((doc) => {
            const iframe = doc.createElement('iframe');
            iframe.src = iframeUrl;
            iframe.id = 'embedded-db-sync-iframe';
            iframe.style.width = '50%';
            iframe.style.height = '500px';
            iframe.style.position = 'fixed';
            iframe.style.bottom = '0';
            iframe.style.left = '0';
            iframe.style.border = '2px solid #10b981';
            iframe.style.zIndex = '9999';
            doc.body.appendChild(iframe);
          });
        });
      });

      const getIframeBody = () =>
        cy
          .get('#embedded-db-sync-iframe', { timeout: 30000 })
          .its('0.contentDocument.body')
          .should('not.be.empty')
          .then(cy.wrap);

      getIframeBody().find('[data-testid="database-grid"]', { timeout: 30000 }).should('be.visible');

      testLog.step(5, 'Edit embedded database cell');
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`)
          .find('[data-testid="database-grid"]')
          .within(() => {
            DatabaseGridSelectors.newRowButton().click({ force: true });
            waitForReactUpdate(1000);
            DatabaseGridSelectors.firstCell().click({ force: true });
          });
        cy.focused().type(cellText).type('{enter}');
      });

      waitForReactUpdate(1500);

      testLog.step(6, 'Verify iframe database shows the same edit');
      getIframeBody()
        .find('[data-testid="database-grid"]', { timeout: 15000 })
        .should('contain.text', cellText);
    });
  });
});
