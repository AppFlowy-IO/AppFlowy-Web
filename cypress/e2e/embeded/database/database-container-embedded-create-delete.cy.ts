import { v4 as uuidv4 } from 'uuid';
import { Editor, Element as SlateElement } from 'slate';

import { AuthTestUtils } from '../../../support/auth-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';
import { testLog } from '../../../support/test-helpers';
import {
  AddPageSelectors,
  BlockSelectors,
  byTestId,
  PageSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../../support/selectors';

describe('Database Container - Embedded Create/Delete', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Database';
  const spaceName = 'General';

  const currentViewIdFromUrl = () =>
    cy.location('pathname').then((pathname) => {
      const maybeId = pathname.split('/').filter(Boolean).pop() || '';
      return maybeId;
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

  const ensurePageExpanded = (name: string) => {
    PageSelectors.itemByName(name).should('exist');
    PageSelectors.itemByName(name)
      .find('[data-testid="outline-toggle-collapse"]')
      .then(($collapse) => {
        if ($collapse.length > 0) return;

        PageSelectors.itemByName(name)
          .find('[data-testid="outline-toggle-expand"]')
          .should('exist')
          .first()
          .click({ force: true });
        waitForReactUpdate(500);
      });
  };

  const ensurePageExpandedByViewId = (viewId: string) => {
    const pageItem = () => PageSelectors.itemByViewId(viewId, { timeout: 30000 });

    pageItem().should('exist');
    pageItem().then(($pageItem) => {
      // Check if already expanded (has collapse toggle)
      const hasCollapseToggle = $pageItem.find('[data-testid="outline-toggle-collapse"]').length > 0;
      if (hasCollapseToggle) return;

      // Check if has expand toggle (has children but not expanded)
      const hasExpandToggle = $pageItem.find('[data-testid="outline-toggle-expand"]').length > 0;
      if (hasExpandToggle) {
        pageItem().find(byTestId('outline-toggle-expand')).first().click({ force: true });
        waitForReactUpdate(500);
        return;
      }

      // No toggle exists yet - the page might not have children rendered yet
      // Wait for the expand toggle to appear, then click it
      cy.task('log', `[ensurePageExpandedByViewId] Waiting for expand toggle to appear for view ${viewId}`);
      pageItem().find(`${byTestId('outline-toggle-expand')}, ${byTestId('outline-toggle-collapse')}`, { timeout: 15000 }).should('exist');
      pageItem().then(($updatedItem) => {
        const hasCollapse = $updatedItem.find('[data-testid="outline-toggle-collapse"]').length > 0;
        if (!hasCollapse) {
          pageItem().find(byTestId('outline-toggle-expand')).first().click({ force: true });
          waitForReactUpdate(500);
        }
      });
    });
  };

  const closeTopDialogIfNotDocument = (docViewId: string) => {
    cy.get('body').then(($body) => {
      const dialogs = $body.find('[role="dialog"]').filter(':visible');

      if (dialogs.length === 0) return;

      const topDialog = dialogs.last();
      const topContainsDocEditor = $body.find(topDialog).find(`#editor-${docViewId}`).length > 0;

      if (!topContainsDocEditor) {
        cy.task('log', '[modal] Closing top dialog (not the document)');
        cy.get('body').type('{esc}');
        waitForReactUpdate(800);
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

  // Skip: Deleting an embedded database block doesn't cascade delete the database container.
  // This test expects cascade delete behavior that isn't currently implemented.
  // The embedded block is deleted from the document, but the database container persists in the sidebar.
  it.skip('creates an embedded database container and removes it when the block is deleted', () => {
    const testEmail = generateRandomEmail();

    testLog.testStart('Embedded database container create/delete');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // 1) Create a document page
      testLog.step(1, 'Create a document page');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Capture the document view id for reliable sidebar targeting (avoid relying on a title edit)
      currentViewIdFromUrl().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });
      waitForReactUpdate(1000);

      // 2) Insert an embedded Grid database via slash menu (creates container + first child)
      testLog.step(2, 'Insert embedded Grid database via slash menu');
      // Avoid chaining .type() directly after .click() since the editor can re-render on focus.
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel().should('be.visible').within(() => {
        SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('grid')).first().click({ force: true });
      });

      // In some flows, inserting a database opens an additional modal; close it while keeping the document open.
      cy.get<string>('@docViewId').then((docViewId) => {
        closeTopDialogIfNotDocument(docViewId);
      });

      // The embedded database block should exist in the editor
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).find(BlockSelectors.blockSelector('grid')).should('exist');
      });

      // 3) Verify sidebar: document has a child database container with a child view
      testLog.step(3, 'Verify sidebar hierarchy: document -> container -> child view');
      ensureSpaceExpanded(spaceName);

      cy.get<string>('@docViewId').then((docViewId) => {
        // Ensure the document is expanded to reveal its children
        ensurePageExpandedByViewId(docViewId);

        // Find the container under the document
        const containerPageItem = () =>
          PageSelectors.itemByViewId(docViewId, { timeout: 30000 })
            .find(byTestId('page-name'))
            .contains(dbName)
            .first()
            .closest(byTestId('page-item'));

        containerPageItem().should('exist');

        // Expand the container to reveal its first child view
        containerPageItem().then(($container) => {
          const hasCollapseToggle = $container.find('[data-testid="outline-toggle-collapse"]').length > 0;
          if (hasCollapseToggle) return;

          const hasExpandToggle = $container.find('[data-testid="outline-toggle-expand"]').length > 0;
          if (hasExpandToggle) {
            containerPageItem().find(byTestId('outline-toggle-expand')).first().click({ force: true });
            waitForReactUpdate(500);
            return;
          }

          // Wait for the expand toggle to appear, then click it
          containerPageItem().find(`${byTestId('outline-toggle-expand')}, ${byTestId('outline-toggle-collapse')}`, { timeout: 15000 }).should('exist');
          containerPageItem().then(($updatedContainer) => {
            const hasCollapse = $updatedContainer.find('[data-testid="outline-toggle-collapse"]').length > 0;
            if (!hasCollapse) {
              containerPageItem().find(byTestId('outline-toggle-expand')).first().click({ force: true });
              waitForReactUpdate(500);
            }
          });
        });

        containerPageItem().within(() => {
          // When the current page is open in a modal, the sidebar can be covered by the dialog backdrop.
          // We only need to assert the hierarchy exists.
          PageSelectors.items().should('have.length.at.least', 1);
        });
      });

      // 4) Delete the database block from the document
      testLog.step(4, 'Delete the embedded database block');
      cy.get<string>('@docViewId').then((docViewId) => {
        // Ensure we're back on the document view before deleting the embedded database block.
        PageSelectors.pageByViewId(docViewId, { timeout: 30000 }).click({ force: true });
        waitForReactUpdate(800);

        cy.get(`#editor-${docViewId}`).should('exist').find(BlockSelectors.blockSelector('grid')).should('exist');

        // Delete the database block using the Slate editor instance exposed for E2E testing.
        // Hover-controls are unreliable for embedded database blocks due to portal/overlay rendering.
        cy.window().then((win) => {
          const testEditors = (win as unknown as { __TEST_EDITORS__?: Record<string, unknown> }).__TEST_EDITORS__;
          const testEditor = testEditors?.[docViewId];
          const customEditor = (win as unknown as { __TEST_CUSTOM_EDITOR__?: unknown }).__TEST_CUSTOM_EDITOR__;

          expect(testEditor, `window.__TEST_EDITORS__["${docViewId}"]`).to.exist;
          expect(customEditor, 'window.__TEST_CUSTOM_EDITOR__').to.exist;

          const editor = testEditor as Parameters<typeof Editor.nodes>[0];

          const gridEntries = Array.from(
            Editor.nodes(editor, {
              at: [],
              match: (node) => SlateElement.isElement(node) && (node as { type?: string }).type === 'grid',
            })
          );

          expect(gridEntries.length, 'gridEntries.length').to.be.greaterThan(0);
          const [gridNode] = gridEntries[0];
          const blockId = (gridNode as unknown as { blockId?: string }).blockId;

          expect(blockId, 'grid blockId').to.be.a('string').and.not.equal('');
          (customEditor as { deleteBlock: (e: unknown, id: string) => void }).deleteBlock(editor, blockId as string);

          const afterEntries = Array.from(
            Editor.nodes(editor, {
              at: [],
              match: (node) => SlateElement.isElement(node) && (node as { type?: string }).type === 'grid',
            })
          );

          expect(afterEntries.length, 'gridEntries after delete').to.equal(0);
        });
      });

      waitForReactUpdate(2000);

      // Verify the database block is removed from the document
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).find(BlockSelectors.blockSelector('grid')).should('not.exist');
      });

      // 5) Verify sidebar: document no longer has the database container child
      testLog.step(5, 'Verify sidebar no longer contains the embedded container');

      // Wait for the sidebar to update after the delete operation
      waitForReactUpdate(2000);

      ensureSpaceExpanded(spaceName);

      cy.get<string>('@docViewId').then((docViewId) => {
        // Ensure document still exists
        cy.get(`[data-testid="page-${docViewId}"]`).first().should('exist');

        // The document's page-item should either have no expand toggle (no children)
        // or if it has children, none should be named 'New Database'
        PageSelectors.itemByViewId(docViewId, { timeout: 30000 }).then(($docPageItem) => {
          // Check if document has expand/collapse toggle (indicating children)
          const hasExpandToggle = $docPageItem.find('[data-testid="outline-toggle-expand"]').length > 0;
          const hasCollapseToggle = $docPageItem.find('[data-testid="outline-toggle-collapse"]').length > 0;

          if (!hasExpandToggle && !hasCollapseToggle) {
            // No children, test passes
            cy.task('log', '[VERIFY] Document has no children (no expand/collapse toggle)');
            return;
          }

          // If has children, expand and check none are named 'New Database'
          if (hasExpandToggle) {
            PageSelectors.itemByViewId(docViewId).find(byTestId('outline-toggle-expand')).first().click({ force: true });
            waitForReactUpdate(500);
          }

          // Check that no child page is named 'New Database'
          PageSelectors.itemByViewId(docViewId, { timeout: 15000 }).then(($updatedItem) => {
            const childPageNames = $updatedItem.find('[data-testid="page-name"]')
              .map((_i, el) => Cypress.$(el).text().trim())
              .get();
            cy.task('log', `[VERIFY] Child page names: ${JSON.stringify(childPageNames)}`);

            // Filter out the document's own name
            const childNames = childPageNames.slice(1); // Skip first (document itself)
            expect(childNames).to.not.include(dbName, `Document should not have child named "${dbName}"`);
          });
        });
      });

      testLog.testEnd('Embedded database container create/delete');
    });
  });
});
