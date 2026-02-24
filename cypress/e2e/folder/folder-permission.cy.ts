import { TestTool, expandPageByName } from '../../support/page-utils';
import { BreadcrumbSelectors, PageSelectors, SpaceSelectors, SidebarSelectors, TrashSelectors, byTestId } from '../../support/selectors';
import { logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

// Snapshot accounts from backup/README.md
const OWNER_EMAIL = 'cc_group_owner@appflowy.io';
const MEMBER_1_EMAIL = 'cc_group_mem_1@appflowy.io';
const MEMBER_2_EMAIL = 'cc_group_mem_2@appflowy.io';
const GUEST_EMAIL = 'cc_group_guest@appflowy.io';

/**
 * Asserts that a space with the given name exists in the sidebar.
 */
function assertSpaceVisible(spaceName: string) {
  SpaceSelectors.names().should('contain.text', spaceName);
}

/**
 * Asserts that a space with the given name does NOT exist in the sidebar.
 */
function assertSpaceNotVisible(spaceName: string) {
  SpaceSelectors.names().should('not.contain.text', spaceName);
}

/**
 * Asserts the exact set of direct children (page names) under a given space.
 * Checks both inclusion and exact count of direct children.
 */
function assertSpaceHasExactChildren(spaceName: string, expectedChildren: string[]) {
  // Space DOM: space-item > [space-expanded, renderItem div, renderChildren div]
  // renderChildren div contains direct page-item children
  SpaceSelectors.itemByName(spaceName)
    .children()
    .last() // the renderChildren container div
    .children(byTestId('page-item'))
    .should('have.length', expectedChildren.length)
    .each(($pageItem, index) => {
      const name = Cypress.$($pageItem).find(byTestId('page-name')).text().trim();
      expect(expectedChildren).to.include(name, `Unexpected child "${name}" in space "${spaceName}"`);
    });
}

/**
 * Asserts the exact set of direct children under a given page (after expanding).
 * Page DOM: page-item > [renderItem div, renderChildren div]
 * renderChildren div contains direct page-item children
 */
function assertPageHasExactChildren(pageName: string, expectedChildren: string[]) {
  PageSelectors.itemByName(pageName)
    .children()
    .last() // the renderChildren container div
    .children(byTestId('page-item'))
    .should('have.length', expectedChildren.length)
    .each(($pageItem) => {
      const name = Cypress.$($pageItem).find(byTestId('page-name')).text().trim();
      expect(expectedChildren).to.include(name, `Unexpected child "${name}" under page "${pageName}"`);
    });
}

/**
 * Gets the set of trash item names visible in the trash view.
 */
function getTrashNames(): Cypress.Chainable<string[]> {
  return cy.get('body').then(($body) => {
    const rows = $body.find(byTestId('trash-table-row'));

    if (rows.length === 0) {
      return [] as string[];
    }

    return Array.from(rows).map((row) => {
      const cells = Cypress.$(row).find('td');
      return cells.first().text().trim();
    });
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('Folder API & Trash Permission Tests (Snapshot Accounts)', () => {
  before(() => {
    logAppFlowyEnvironment();
  });

  // ---------------------------------------------------------------------------
  // Owner folder structure tests
  // ---------------------------------------------------------------------------
  describe('Owner folder visibility', () => {
    beforeEach(() => {
      cy.signIn(OWNER_EMAIL);
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
    });

    it('should see exact spaces, General children, and Getting started children', () => {
      testLog.step(1, 'Verify owner sees exactly 5 spaces');
      assertSpaceVisible('General');
      assertSpaceVisible('Shared');
      assertSpaceVisible('Owner-shared-space');
      assertSpaceVisible('member-1-public-space');
      assertSpaceVisible('Owner-private-space');
      SpaceSelectors.items().should('have.length', 5);

      testLog.step(2, 'Expand General and verify children');
      TestTool.expandSpaceByName('General');
      cy.wait(1000);
      assertSpaceHasExactChildren('General', ['Document 1', 'Getting started', 'To-dos']);

      testLog.step(3, 'Expand Getting started and verify children');
      expandPageByName('Getting started');
      assertPageHasExactChildren('Getting started', ['Desktop guide', 'Mobile guide', 'Web guide']);
    });

    it('should see deep nesting under Document 1 and correct breadcrumbs', () => {
      testLog.step(1, 'Expand General → Document 1');
      TestTool.expandSpaceByName('General');
      cy.wait(1000);
      expandPageByName('Document 1');

      testLog.step(2, 'Verify exact Document 1 children');
      assertPageHasExactChildren('Document 1', ['Document 1-1', 'Database 1-2']);

      testLog.step(3, 'Expand Document 1-1 and verify children');
      expandPageByName('Document 1-1');
      assertPageHasExactChildren('Document 1-1', ['Document 1-1-1', 'Document 1-1-2']);

      testLog.step(4, 'Expand Document 1-1-1 and verify children');
      expandPageByName('Document 1-1-1');
      assertPageHasExactChildren('Document 1-1-1', ['Document 1-1-1-1', 'Document 1-1-1-2']);

      testLog.step(5, 'Click Document 1-1-1-1 and verify breadcrumbs');
      PageSelectors.nameContaining('Document 1-1-1-1').first().click();
      cy.wait(2000);

      // Breadcrumb collapses when path > 3 items: shows first + "..." + last 2
      // Full path: General > Document 1 > Document 1-1 > Document 1-1-1 > Document 1-1-1-1
      // Visible:   General > ... > Document 1-1-1 > Document 1-1-1-1
      BreadcrumbSelectors.navigation().should('be.visible');
      BreadcrumbSelectors.navigation().within(() => {
        cy.get(byTestId('breadcrumb-item-general')).should('exist');
        cy.get(byTestId('breadcrumb-item-document-1-1-1')).should('exist');
        cy.get(byTestId('breadcrumb-item-document-1-1-1-1')).should('exist');
        cy.get(byTestId('breadcrumb-item-document-1')).should('not.exist');
        cy.get(byTestId('breadcrumb-item-document-1-1')).should('not.exist');
      });
    });

    it('should see exact Owner-shared-space hierarchy', () => {
      testLog.step(1, 'Expand Owner-shared-space');
      TestTool.expandSpaceByName('Owner-shared-space');
      cy.wait(1000);

      testLog.step(2, 'Verify exact space children');
      assertSpaceHasExactChildren('Owner-shared-space', ['Shared grid', 'Shared document 2']);

      testLog.step(3, 'Expand Shared document 2 and verify children');
      expandPageByName('Shared document 2');
      assertPageHasExactChildren('Shared document 2', ['Shared document 2-1', 'Shared document 2-2']);
    });

    it('should see exact Owner-private-space hierarchy', () => {
      testLog.step(1, 'Expand Owner-private-space');
      TestTool.expandSpaceByName('Owner-private-space');
      cy.wait(1000);

      testLog.step(2, 'Verify exact space children');
      assertSpaceHasExactChildren('Owner-private-space', ['Private database 1', 'Prviate document 1']);

      testLog.step(3, 'Expand Prviate document 1 and verify children');
      expandPageByName('Prviate document 1');
      assertPageHasExactChildren('Prviate document 1', ['Private document 1-1', 'Private gallery 1-2']);
    });
  });

  // ---------------------------------------------------------------------------
  // Member 1 folder visibility + trash
  // ---------------------------------------------------------------------------
  describe('Member 1 visibility', () => {
    beforeEach(() => {
      cy.signIn(MEMBER_1_EMAIL);
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
    });

    it('should see expected spaces with own children, but NOT Owner-private-space', () => {
      testLog.step(1, 'Verify member1 sees exactly 5 spaces');
      assertSpaceVisible('General');
      assertSpaceVisible('Shared');
      assertSpaceVisible('Owner-shared-space');
      assertSpaceVisible('member-1-public-space');
      assertSpaceVisible('Member-1-private-space');
      assertSpaceNotVisible('Owner-private-space');
      SpaceSelectors.items().should('have.length', 5);

      testLog.step(2, 'Expand member-1-public-space and verify children');
      TestTool.expandSpaceByName('member-1-public-space');
      cy.wait(1000);
      assertSpaceHasExactChildren('member-1-public-space', ['mem-1-public-document1']);

      testLog.step(3, 'Expand Member-1-private-space and verify children');
      TestTool.expandSpaceByName('Member-1-private-space');
      cy.wait(1000);
      assertSpaceHasExactChildren('Member-1-private-space', ['Mem-private document 2', 'Mem-private document 1']);
    });

    it('should see shared and own trash but NOT owner private trash', () => {
      testLog.step(1, 'Navigate to trash');
      TrashSelectors.sidebarTrashButton().click();
      cy.wait(2000);

      testLog.step(2, 'Verify trash contents');
      TrashSelectors.table().should('be.visible');

      getTrashNames().then((names) => {
        testLog.info(`Member1 trash: ${names.join(', ')}`);
        expect(names).to.include('Shared document 1');
        expect(names).to.include('mem-1-public-document2');
        expect(names).to.include('Mem-private document 3');
        expect(names).to.not.include('Private document 2');
        expect(names).to.have.length(3);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Member 2 visibility + trash
  // ---------------------------------------------------------------------------
  describe('Member 2 visibility', () => {
    beforeEach(() => {
      cy.signIn(MEMBER_2_EMAIL);
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
    });

    it('should see exactly the expected spaces, NOT private ones', () => {
      testLog.step(1, 'Verify visible spaces');
      assertSpaceVisible('General');
      assertSpaceVisible('Shared');
      assertSpaceVisible('Owner-shared-space');
      assertSpaceVisible('member-1-public-space');
      assertSpaceNotVisible('Owner-private-space');
      assertSpaceNotVisible('Member-1-private-space');
      SpaceSelectors.items().should('have.length', 4);
    });

    it('should see only shared trash items', () => {
      testLog.step(1, 'Navigate to trash');
      TrashSelectors.sidebarTrashButton().click();
      cy.wait(2000);

      testLog.step(2, 'Verify trash contents');
      TrashSelectors.table().should('be.visible');

      getTrashNames().then((names) => {
        testLog.info(`Member2 trash: ${names.join(', ')}`);
        expect(names).to.include('Shared document 1');
        expect(names).to.include('mem-1-public-document2');
        expect(names).to.not.include('Private document 2');
        expect(names).to.not.include('Mem-private document 3');
        expect(names).to.have.length(2);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Owner trash visibility
  // ---------------------------------------------------------------------------
  describe('Owner trash visibility', () => {
    beforeEach(() => {
      cy.signIn(OWNER_EMAIL);
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
    });

    it('should see exactly the expected items in trash', () => {
      testLog.step(1, 'Navigate to trash');
      TrashSelectors.sidebarTrashButton().click();
      cy.wait(2000);

      testLog.step(2, 'Verify trash contents');
      TrashSelectors.table().should('be.visible');

      getTrashNames().then((names) => {
        testLog.info(`Owner trash: ${names.join(', ')}`);
        expect(names).to.include('Shared document 1');
        expect(names).to.include('Private document 2');
        expect(names).to.include('mem-1-public-document2');
        expect(names).to.not.include('Mem-private document 3');
        expect(names).to.have.length(3);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Guest visibility
  // ---------------------------------------------------------------------------
  describe('Guest visibility', () => {
    beforeEach(() => {
      cy.signIn(GUEST_EMAIL);
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
    });

    it('should not see trash button in sidebar', () => {
      testLog.step(1, 'Verify trash button is NOT visible for guest');
      cy.get('body').then(($body) => {
        expect($body.find(byTestId('sidebar-trash-button')).length).to.equal(0);
      });
    });
  });
});
