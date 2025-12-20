import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import { getSlashMenuItemName } from '../../support/i18n-constants';
import { testLog } from '../../support/test-helpers';
import {
  AddPageSelectors,
  DropdownSelectors,
  ModalSelectors,
  PageSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  ViewActionSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

/**
 * Tests for Move Page Restrictions
 *
 * These tests verify that the "Move to" action is disabled for views that should not be movable:
 * - Case 1: Referenced database views (database inside database)
 * - Case 2: Children of database containers
 * - Case 3: Linked database views under documents
 *
 * Mirrors Desktop/Flutter implementation in view_ext.dart canBeDragged().
 */
describe('Move Page Restrictions', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const spaceName = 'General';

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

  const currentDocumentViewIdFromDialog = () =>
    cy
      .get('[role="dialog"]:visible', { timeout: 20000 })
      .last()
      .find('[id^="editor-"]:not([id^="editor-title-"])', { timeout: 20000 })
      .first()
      .invoke('attr', 'id')
      .then((id) => (id ?? '').replace('editor-', ''));

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

  it('should disable Move to for linked database view under document (Case 3)', () => {
    const testEmail = generateRandomEmail();
    const sourceName = `SourceDB_${Date.now()}`;

    testLog.testStart('Move to disabled for linked database view under document');
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

      // Rename container to a unique name
      ensureSpaceExpanded(spaceName);
      PageSelectors.itemByName('New Database').should('exist');
      PageSelectors.moreActionsButton('New Database').click({ force: true });
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

      // Capture the document view id
      currentDocumentViewIdFromDialog().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });
      waitForReactUpdate(1000);

      // 3) Insert linked grid via slash menu
      testLog.step(3, 'Insert linked grid via slash menu');
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

      // 4) Expand the document to see linked view in sidebar
      testLog.step(4, 'Expand document and find linked view');
      ensureSpaceExpanded(spaceName);
      const referencedName = `View of ${sourceName}`;

      cy.get<string>('@docViewId').then((docViewId) => {
        ensurePageExpandedByViewId(docViewId);
        waitForReactUpdate(1000);

        // 5) Open More Actions for the linked database view
        testLog.step(5, 'Open More Actions for linked database view');

        // Find the linked database view (child of the document)
        cy.get(`[data-testid="page-${docViewId}"]`)
          .first()
          .closest('[data-testid="page-item"]')
          .within(() => {
            // Find the linked view by its name
            cy.contains('[data-testid="page-name"]', referencedName)
              .closest('[data-testid="page-item"]')
              .trigger('mouseenter', { force: true })
              .trigger('mouseover', { force: true });
          });

        waitForReactUpdate(500);

        // Click the more actions button for the linked view
        cy.contains('[data-testid="page-name"]', referencedName)
          .closest('[data-testid="page-item"]')
          .find('[data-testid="page-more-actions"]')
          .first()
          .click({ force: true });

        waitForReactUpdate(500);

        // 6) Verify Move to is disabled
        testLog.step(6, 'Verify Move to is disabled');
        DropdownSelectors.content().should('be.visible');
        DropdownSelectors.content().within(() => {
          // Find the "Move to" menu item and verify it's disabled
          // Radix UI sets data-disabled="" (empty string) when disabled
          cy.contains('Move to')
            .closest('[role="menuitem"]')
            .should('have.attr', 'data-disabled');
        });
      });

      testLog.testEnd('Move to disabled for linked database view under document');
    });
  });

  it('should enable Move to for regular document pages', () => {
    const testEmail = generateRandomEmail();

    testLog.testStart('Move to enabled for regular document pages');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Wait for sidebar and find Getting started page
      ensureSpaceExpanded(spaceName);
      waitForReactUpdate(2000);

      // Hover over Getting started page
      PageSelectors.itemByName('Getting started')
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });

      waitForReactUpdate(500);

      // Click more actions
      PageSelectors.moreActionsButton('Getting started').click({ force: true });

      waitForReactUpdate(500);

      // Verify Move to is NOT disabled for regular pages
      // Radix UI sets data-disabled attribute when disabled, so we check it doesn't exist
      DropdownSelectors.content().should('be.visible');
      DropdownSelectors.content().within(() => {
        cy.contains('Move to')
          .closest('[role="menuitem"]')
          .should('not.have.attr', 'data-disabled');
      });

      testLog.testEnd('Move to enabled for regular document pages');
    });
  });

  it('should enable Move to for database containers under document', () => {
    const testEmail = generateRandomEmail();
    const docName = `TestDoc_${Date.now()}`;

    testLog.testStart('Move to enabled for database containers');
    testLog.info(`Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // 1) Create a document page first
      testLog.step(1, 'Create document page');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Capture the document view id
      currentDocumentViewIdFromDialog().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });
      waitForReactUpdate(1000);

      // 2) Insert NEW grid via slash menu (creates container)
      testLog.step(2, 'Insert new grid via slash menu');
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel().should('be.visible').within(() => {
        // This creates a NEW database (with container), not a linked view
        SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('grid')).first().click({ force: true });
      });
      waitForReactUpdate(3000);

      // 3) Expand the document to see the database container in sidebar
      testLog.step(3, 'Expand document and find database container');
      ensureSpaceExpanded(spaceName);

      cy.get<string>('@docViewId').then((docViewId) => {
        ensurePageExpandedByViewId(docViewId);
        waitForReactUpdate(1000);

        // 4) Find the database container (it should be named "Grid" or similar)
        testLog.step(4, 'Open More Actions for database container');

        cy.get(`[data-testid="page-${docViewId}"]`)
          .first()
          .closest('[data-testid="page-item"]')
          .within(() => {
            // The database container should be a child - find it and hover
            cy.get('[data-testid="page-item"]')
              .first()
              .trigger('mouseenter', { force: true })
              .trigger('mouseover', { force: true });
          });

        waitForReactUpdate(500);

        // Click the more actions button for the database container
        cy.get(`[data-testid="page-${docViewId}"]`)
          .first()
          .closest('[data-testid="page-item"]')
          .find('[data-testid="page-item"]')
          .first()
          .find('[data-testid="page-more-actions"]')
          .first()
          .click({ force: true });

        waitForReactUpdate(500);

        // 5) Verify Move to is NOT disabled for database containers
        // Radix UI sets data-disabled attribute when disabled, so we check it doesn't exist
        testLog.step(5, 'Verify Move to is enabled for database container');
        DropdownSelectors.content().should('be.visible');
        DropdownSelectors.content().within(() => {
          cy.contains('Move to')
            .closest('[role="menuitem"]')
            .should('not.have.attr', 'data-disabled');
        });
      });

      testLog.testEnd('Move to enabled for database containers');
    });
  });
});
