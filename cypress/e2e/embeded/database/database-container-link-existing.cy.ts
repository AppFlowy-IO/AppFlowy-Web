import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../../support/auth-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';
import { testLog } from '../../../support/test-helpers';
import {
  AddPageSelectors,
  ModalSelectors,
  PageSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  ViewActionSelectors,
  waitForReactUpdate,
} from '../../../support/selectors';

describe('Database Container - Link Existing Database in Document', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Database';
  const spaceName = 'General';

  const currentDocumentViewIdFromDialog = () =>
    cy
      .get('[role="dialog"]:visible', { timeout: 20000 })
      .last()
      .find('[id^="editor-"]:not([id^="editor-title-"])', { timeout: 20000 })
      .first()
      .invoke('attr', 'id')
      .then((id) => (id ?? '').replace('editor-', ''));

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

  const ensurePageExpanded = (name: string) => {
    PageSelectors.itemByName(name).should('exist');
    PageSelectors.itemByName(name).then(($page) => {
      const isExpanded = $page.find('[data-testid="outline-toggle-collapse"]').length > 0;

      if (!isExpanded) {
        PageSelectors.itemByName(name).find('[data-testid="outline-toggle-expand"]').first().click({ force: true });
        waitForReactUpdate(500);
      }
    });
  };

  const ensurePageExpandedByViewId = (viewId: string) => {
    cy.get(`[data-testid="page-${viewId}"]`)
      .first()
      .closest('[data-testid="page-item"]')
      .should('exist')
      .then(($page) => {
        const isExpanded = $page.find('[data-testid="outline-toggle-collapse"]').length > 0;

        if (!isExpanded) {
          cy.wrap($page).find('[data-testid="outline-toggle-expand"]').first().click({ force: true });
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

  it('creates a linked view under the document (no new container)', () => {
    const testEmail = generateRandomEmail();
    const sourceName = `SourceDB_${Date.now()}`;

    testLog.testStart('Link existing database in document');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // 1) Create a standalone database (container exists in the sidebar)
      testLog.step(1, 'Create standalone Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });

      // Rename container to a unique name so the linked database picker is deterministic
      ensureSpaceExpanded(spaceName);
      PageSelectors.itemByName(dbName).should('exist');
      PageSelectors.moreActionsButton(dbName).click({ force: true });
      ViewActionSelectors.renameButton().should('be.visible').click({ force: true });
      ModalSelectors.renameInput().should('be.visible').clear().type(sourceName);
      ModalSelectors.renameSaveButton().click({ force: true });
      waitForReactUpdate(2000);
      PageSelectors.itemByName(sourceName).should('exist');

      // 2) Create a document page
      testLog.step(2, 'Create document page');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Capture the document view id for reliable sidebar targeting.
      // When creating a document while a database modal is open, the URL may still point to the database view.
      currentDocumentViewIdFromDialog().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });
      waitForReactUpdate(1000);

      // 3) Insert linked grid via slash menu (should NOT create a new container)
      testLog.step(3, 'Insert linked grid via slash menu');
      // Avoid chaining .type() directly after .click() since the editor can re-render on focus.
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel().should('be.visible').within(() => {
        SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('linkedGrid')).first().click({ force: true });
      });
      waitForReactUpdate(1000);

      SlashCommandSelectors.selectDatabase(sourceName);
      waitForReactUpdate(3000);

      // 4) Verify sidebar: document has a "View of <db>" child, and no container child
      testLog.step(4, 'Verify document children in sidebar');
      ensureSpaceExpanded(spaceName);
      const referencedName = `View of ${sourceName}`;

      cy.get<string>('@docViewId').then((docViewId) => {
        ensurePageExpandedByViewId(docViewId);

        cy
          .get(`[data-testid="page-${docViewId}"]`)
          .first()
          .closest('[data-testid="page-item"]')
          .within(() => {
            cy.get('[data-testid="page-name"]').then(($els) => {
              const names = Array.from($els).map((el) => (el.textContent || '').trim());
              expect(names).to.include(referencedName);
              expect(names).not.to.include(dbName);
            });
          });
      });

      testLog.testEnd('Link existing database in document');
    });
  });
});
