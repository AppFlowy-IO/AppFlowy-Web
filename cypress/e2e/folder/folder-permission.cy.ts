import { AuthTestUtils } from '../../support/auth-utils';
import { TestTool } from '../../support/page-utils';
import { PageSelectors, SpaceSelectors, SidebarSelectors, TrashSelectors, byTestId } from '../../support/selectors';
import { logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

// Snapshot accounts from backup/README.md
const OWNER_EMAIL = 'cc_group_owner@appflowy.io';
const MEMBER_1_EMAIL = 'cc_group_mem_1@appflowy.io';
const MEMBER_2_EMAIL = 'cc_group_mem_2@appflowy.io';
const GUEST_EMAIL = 'cc_group_guest@appflowy.io';

/**
 * Signs in with the given email and waits for the app to be ready.
 */
function signIn(email: string) {
  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(1000);
  const authUtils = new AuthTestUtils();
  authUtils.signInWithTestUrl(email);
  SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
  cy.wait(2000);
}

/**
 * Expands a page (not a space) in the sidebar by clicking its toggle icon.
 * Finds the page-item containing the page name and clicks the expand toggle.
 */
function expandPageByName(pageName: string) {
  testLog.info(`Expanding page "${pageName}"`);
  PageSelectors.itemByName(pageName).within(() => {
    cy.get(byTestId('outline-toggle-expand')).first().click({ force: true });
  });
  cy.wait(1000);
}

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
      const name = $pageItem.find(byTestId('page-name')).first().text().trim();
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
      const name = $pageItem.find(byTestId('page-name')).first().text().trim();
      expect(expectedChildren).to.include(name, `Unexpected child "${name}" under page "${pageName}"`);
    });
}

/**
 * Gets the set of trash item names visible in the trash view.
 */
function getTrashNames(): Cypress.Chainable<string[]> {
  return cy.get('body').then(($body) => {
    if ($body.find(byTestId('trash-table-row')).length === 0) {
      return [] as string[];
    }

    return TrashSelectors.rows().then(($rows) => {
      return Array.from($rows).map((row) => {
        const cells = Cypress.$(row).find('td');
        return cells.first().text().trim();
      });
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
      signIn(OWNER_EMAIL);
    });

    it('should see exactly the expected spaces', () => {
      testLog.step(1, 'Verify owner sees all spaces');
      assertSpaceVisible('General');
      assertSpaceVisible('Shared');
      assertSpaceVisible('Owner-shared-space');
      assertSpaceVisible('member-1-public-space');
      assertSpaceVisible('Owner-private-space');

      testLog.step(2, 'Verify exact space count');
      SpaceSelectors.items().should('have.length', 5);
    });

    it('should see exact General space children at depth 1', () => {
      testLog.step(1, 'Expand General space');
      TestTool.expandSpaceByName('General');
      cy.wait(1000);

      testLog.step(2, 'Verify exact General children');
      assertSpaceHasExactChildren('General', ['Document 1', 'Getting started', 'To-dos']);
    });

    it('should see exact Document 1 children after expanding', () => {
      testLog.step(1, 'Expand General space');
      TestTool.expandSpaceByName('General');
      cy.wait(1000);

      testLog.step(2, 'Expand Document 1');
      expandPageByName('Document 1');

      testLog.step(3, 'Verify exact Document 1 children');
      assertPageHasExactChildren('Document 1', ['Document 1-1', 'Database 1-2']);
    });

    it('should see exact deeply nested hierarchy under Document 1-1', () => {
      testLog.step(1, 'Expand General → Document 1 → Document 1-1');
      TestTool.expandSpaceByName('General');
      cy.wait(500);
      expandPageByName('Document 1');
      expandPageByName('Document 1-1');

      testLog.step(2, 'Verify exact Document 1-1 children');
      assertPageHasExactChildren('Document 1-1', ['Document 1-1-1', 'Document 1-1-2']);

      testLog.step(3, 'Expand Document 1-1-1');
      expandPageByName('Document 1-1-1');

      testLog.step(4, 'Verify exact Document 1-1-1 children');
      assertPageHasExactChildren('Document 1-1-1', ['Document 1-1-1-1', 'Document 1-1-1-2']);
    });

    it('should see exact Getting started children', () => {
      testLog.step(1, 'Expand General → Getting started');
      TestTool.expandSpaceByName('General');
      cy.wait(500);
      expandPageByName('Getting started');

      testLog.step(2, 'Verify exact Getting started children');
      assertPageHasExactChildren('Getting started', ['Desktop guide', 'Mobile guide', 'Web guide']);
    });

    it('should see exact Owner-shared-space children', () => {
      testLog.step(1, 'Expand Owner-shared-space');
      TestTool.expandSpaceByName('Owner-shared-space');
      cy.wait(1000);

      testLog.step(2, 'Verify exact children');
      assertSpaceHasExactChildren('Owner-shared-space', ['Shared grid', 'Shared document 2']);
    });

    it('should see exact Shared document 2 children after expanding', () => {
      testLog.step(1, 'Expand Owner-shared-space → Shared document 2');
      TestTool.expandSpaceByName('Owner-shared-space');
      cy.wait(500);
      expandPageByName('Shared document 2');

      testLog.step(2, 'Verify exact children');
      assertPageHasExactChildren('Shared document 2', ['Shared document 2-1', 'Shared document 2-2']);
    });

    it('should see exact Owner-private-space children', () => {
      testLog.step(1, 'Expand Owner-private-space');
      TestTool.expandSpaceByName('Owner-private-space');
      cy.wait(1000);

      testLog.step(2, 'Verify exact children');
      assertSpaceHasExactChildren('Owner-private-space', ['Private database 1', 'Prviate document 1']);
    });

    it('should see exact Prviate document 1 children after expanding', () => {
      testLog.step(1, 'Expand Owner-private-space → Prviate document 1');
      TestTool.expandSpaceByName('Owner-private-space');
      cy.wait(500);
      expandPageByName('Prviate document 1');

      testLog.step(2, 'Verify exact children');
      assertPageHasExactChildren('Prviate document 1', ['Private document 1-1', 'Private gallery 1-2']);
    });
  });

  // ---------------------------------------------------------------------------
  // Member 1 folder structure tests
  // ---------------------------------------------------------------------------
  describe('Member 1 folder visibility', () => {
    beforeEach(() => {
      signIn(MEMBER_1_EMAIL);
    });

    it('should see exactly the expected spaces, but NOT Owner-private-space', () => {
      testLog.step(1, 'Verify member1 spaces');
      assertSpaceVisible('General');
      assertSpaceVisible('Shared');
      assertSpaceVisible('Owner-shared-space');
      assertSpaceVisible('member-1-public-space');
      assertSpaceVisible('Member-1-private-space');

      testLog.step(2, 'Verify Owner-private-space is NOT visible');
      assertSpaceNotVisible('Owner-private-space');

      testLog.step(3, 'Verify exact space count');
      SpaceSelectors.items().should('have.length', 5);
    });

    it('should see exact General space children', () => {
      TestTool.expandSpaceByName('General');
      cy.wait(1000);
      assertSpaceHasExactChildren('General', ['Document 1', 'Getting started', 'To-dos']);
    });

    it('should see exact member-1-public-space children', () => {
      TestTool.expandSpaceByName('member-1-public-space');
      cy.wait(1000);
      assertSpaceHasExactChildren('member-1-public-space', ['mem-1-public-document1']);
    });

    it('should see exact Member-1-private-space children', () => {
      TestTool.expandSpaceByName('Member-1-private-space');
      cy.wait(1000);
      assertSpaceHasExactChildren('Member-1-private-space', ['Mem-private document 2', 'Mem-private document 1']);
    });

    it('should see exact Owner-shared-space children', () => {
      TestTool.expandSpaceByName('Owner-shared-space');
      cy.wait(1000);
      assertSpaceHasExactChildren('Owner-shared-space', ['Shared grid', 'Shared document 2']);
    });
  });

  // ---------------------------------------------------------------------------
  // Member 2 folder structure tests
  // ---------------------------------------------------------------------------
  describe('Member 2 folder visibility', () => {
    beforeEach(() => {
      signIn(MEMBER_2_EMAIL);
    });

    it('should see exactly the expected spaces, NOT private ones', () => {
      testLog.step(1, 'Verify visible spaces');
      assertSpaceVisible('General');
      assertSpaceVisible('Shared');
      assertSpaceVisible('Owner-shared-space');
      assertSpaceVisible('member-1-public-space');

      testLog.step(2, 'Verify private spaces are hidden');
      assertSpaceNotVisible('Owner-private-space');
      assertSpaceNotVisible('Member-1-private-space');

      testLog.step(3, 'Verify exact space count');
      SpaceSelectors.items().should('have.length', 4);
    });
  });

  // ---------------------------------------------------------------------------
  // Owner trash visibility
  // ---------------------------------------------------------------------------
  describe('Owner trash visibility', () => {
    beforeEach(() => {
      signIn(OWNER_EMAIL);
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
        expect(names).to.have.length(3);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Member 1 trash visibility
  // ---------------------------------------------------------------------------
  describe('Member 1 trash visibility', () => {
    beforeEach(() => {
      signIn(MEMBER_1_EMAIL);
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
  // Member 2 trash visibility
  // ---------------------------------------------------------------------------
  describe('Member 2 trash visibility', () => {
    beforeEach(() => {
      signIn(MEMBER_2_EMAIL);
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
  // Guest visibility
  // ---------------------------------------------------------------------------
  describe('Guest visibility', () => {
    beforeEach(() => {
      signIn(GUEST_EMAIL);
    });

    it('should not see trash button in sidebar', () => {
      testLog.step(1, 'Verify trash button is NOT visible for guest');
      cy.get('body').then(($body) => {
        expect($body.find(byTestId('sidebar-trash-button')).length).to.equal(0);
      });
    });
  });
});
