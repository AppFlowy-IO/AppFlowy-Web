import {
  expandSpaceByName,
  ensurePageExpandedByViewId,
  createDocumentPageAndNavigate,
  insertLinkedDatabaseViaSlash,
} from '../../../support/page-utils';
import { testLog } from '../../../support/test-helpers';
import { generateRandomEmail } from '../../../support/test-config';
import {
  AddPageSelectors,
  ModalSelectors,
  PageSelectors,
  ViewActionSelectors,
  waitForReactUpdate,
} from '../../../support/selectors';

describe('Database Container - Link Existing Database in Document', () => {
  const dbName = 'New Database';
  const spaceName = 'General';

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

    cy.signIn(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // 1) Create a standalone database (container exists in the sidebar)
      testLog.step(1, 'Create standalone Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });

      // Rename container to a unique name so the linked database picker is deterministic
      expandSpaceByName(spaceName);
      PageSelectors.itemByName(dbName).should('exist');
      PageSelectors.moreActionsButton(dbName).click({ force: true });
      ViewActionSelectors.renameButton().should('be.visible').click({ force: true });
      ModalSelectors.renameInput().should('be.visible').clear().type(sourceName);
      ModalSelectors.renameSaveButton().click({ force: true });
      waitForReactUpdate(3000);

      // Do not assert sidebar rename propagation here.
      // The rename can arrive asynchronously via websocket and may be delayed
      // relative to this test flow; the linked-database picker below has
      // retries and will still find the renamed source (or first available db).

      // 2) Create a document page
      testLog.step(2, 'Create document page');
      createDocumentPageAndNavigate().then((viewId) => {
        cy.wrap(viewId).as('docViewId');
      });
      waitForReactUpdate(1000);

      // 3) Insert linked grid via slash menu (should NOT create a new container)
      testLog.step(3, 'Insert linked grid via slash menu');
      cy.get<string>('@docViewId').then((docViewId) => {
        insertLinkedDatabaseViaSlash(docViewId, sourceName);
      });
      waitForReactUpdate(1000);

      // 4) Verify sidebar: document has a "View of <db>" child, and no container child
      testLog.step(4, 'Verify document children in sidebar');
      expandSpaceByName(spaceName);
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
              expect(names).not.to.include(sourceName);
            });
          });
      });

      testLog.testEnd('Link existing database in document');
    });
  });
});
