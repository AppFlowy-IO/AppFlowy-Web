import { v4 as uuidv4 } from 'uuid';
import { Editor, Element as SlateElement } from 'slate';

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
    // Wait for either toggle to appear (page has children)
    pageItem().then(($pageItem) => {
      const collapseToggle = $pageItem.find('[data-testid="outline-toggle-collapse"]');
      if (collapseToggle.length > 0) {
        // Already expanded
        return;
      }

      const expandToggle = $pageItem.find('[data-testid="outline-toggle-expand"]');
      if (expandToggle.length > 0) {
        cy.wrap(expandToggle.first()).click({ force: true });
        waitForReactUpdate(500);
      }
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

  it('creates an embedded database container and removes it when the block is deleted', () => {
    const testEmail = generateRandomEmail();

    testLog.testStart('Embedded database container create/delete');
    testLog.info(`Test email: ${testEmail}`);

    cy.signIn(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // 1) Create a document page
      testLog.step(1, 'Create a document page');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // When creating a Document via inline add button, it opens in a ViewModal.
      // Click the expand button (first button in modal header) to navigate to full page view.
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
      cy.get('[role="dialog"]').find('button').first().click({ force: true });
      waitForReactUpdate(1000);

      // Now the URL should reflect the new document
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

      // Wait for sidebar to update after database creation
      waitForReactUpdate(3000);

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

        // Expand the container to reveal its first child view (if it has a toggle)
        containerPageItem().then(($container) => {
          const collapseToggle = $container.find('[data-testid="outline-toggle-collapse"]');
          if (collapseToggle.length > 0) {
            // Already expanded
            return;
          }

          const expandToggle = $container.find('[data-testid="outline-toggle-expand"]');
          if (expandToggle.length > 0) {
            cy.wrap(expandToggle.first()).click({ force: true });
            waitForReactUpdate(500);
          }
        });

        // Verify the container has children (database container should have at least one child view)
        containerPageItem().then(($container) => {
          const childItems = $container.find('[data-testid="page-item"]');
          // Database containers should have at least one child view
          expect(childItems.length).to.be.at.least(1);
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

      // Wait for the server-side cascade deletion to complete AND for the
      // getAppView cache (5 s TTL) to expire so the next fetch returns fresh data.
      waitForReactUpdate(6000);

      // 5) Verify sidebar: document no longer has the database container child
      testLog.step(5, 'Verify sidebar no longer contains the embedded container');
      ensureSpaceExpanded(spaceName);

      cy.get<string>('@docViewId').then((docViewId) => {
        const pageItem = () =>
          cy.get(`[data-testid="page-${docViewId}"]`).first().closest('[data-testid="page-item"]');

        pageItem().should('exist');

        // Collapse and re-expand the document to force a fresh API fetch.
        // The websocket VIEW_REMOVED event may not fire for cascade deletions,
        // so we must manually invalidate the cached sidebar children.
        pageItem().then(($item) => {
          const collapseToggle = $item.find('[data-testid="outline-toggle-collapse"]');

          if (collapseToggle.length > 0) {
            cy.wrap(collapseToggle.first()).click({ force: true });
            waitForReactUpdate(500);
          }
        });

        // Re-expand: triggers loadViewChildren with a fresh (uncached) API call
        // that should no longer include the deleted database container.
        pageItem().then(($item) => {
          const expandToggle = $item.find('[data-testid="outline-toggle-expand"]');

          if (expandToggle.length > 0) {
            cy.wrap(expandToggle.first()).click({ force: true });
            waitForReactUpdate(1000);
          }
        });

        // After fresh fetch, the document should have no child named "New Database".
        // If the document now has no children at all (no expand toggle), the assertion
        // passes trivially.  Otherwise check within the page-item.
        pageItem().within(() => {
          PageSelectors.names({ timeout: 15000 }).should('not.contain.text', dbName);
        });
      });

      testLog.testEnd('Embedded database container create/delete');
    });
  });
});
