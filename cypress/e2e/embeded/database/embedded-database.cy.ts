import { v4 as uuidv4 } from 'uuid';

import { getSlashMenuItemName } from '../../../support/i18n-constants';
import { testLog } from '../../../support/test-helpers';
import {
  AddPageSelectors,
  BlockSelectors,
  DatabaseGridSelectors,
  SlashCommandSelectors,
  waitForReactUpdate,
} from '../../../support/selectors';

describe('Embedded Database', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

  const currentViewIdFromUrl = () =>
    cy.location('pathname').then((pathname) => {
      const parts = pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
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

  it('inserts and edits embedded database via slash command', () => {
    const testEmail = generateRandomEmail();
    const cellText = `embed-test-${Date.now()}`;

    testLog.testStart('Embedded database insert and edit');
    testLog.info(`Test email: ${testEmail}`);

    cy.signIn(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      testLog.step(1, 'Create a document page (opens ViewModal)');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Expand modal to full page view
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
      cy.get('[role="dialog"]').find('button').first().click({ force: true });
      waitForReactUpdate(1000);

      currentViewIdFromUrl().then((viewId) => {
        expect(viewId).to.not.equal('');
        cy.wrap(viewId).as('docViewId');
        cy.get(`#editor-${viewId}`, { timeout: 15000 }).should('exist');
      });

      testLog.step(2, 'Open slash menu and insert Grid database');
      cy.get<string>('@docViewId').then((docViewId) => {
        cy.get(`#editor-${docViewId}`).should('exist').click('center', { force: true });
        cy.get(`#editor-${docViewId}`).type('/', { force: true });
      });
      waitForReactUpdate(500);

      SlashCommandSelectors.slashPanel().should('be.visible').within(() => {
        SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('grid')).first().click({ force: true });
      });

      testLog.step(3, 'Verify embedded database block appears');
      cy.get<string>('@docViewId').then((docViewId) => {
        // Verify the grid block type exists in the editor
        cy.get(`#editor-${docViewId}`)
          .find(BlockSelectors.blockSelector('grid'), { timeout: 15000 })
          .should('exist')
          .and('be.visible');
      });

      // Wait for database to fully load
      waitForReactUpdate(2000);

      testLog.step(4, 'Verify database grid is interactive');
      cy.get<string>('@docViewId').then((docViewId) => {
        // Verify the "New row" button exists and is clickable
        cy.get(`#editor-${docViewId}`)
          .find('[data-testid="database-grid"]')
          .contains('New row')
          .should('be.visible');

        // Verify column headers are displayed
        cy.get(`#editor-${docViewId}`)
          .find('[data-testid="database-grid"]')
          .should('contain.text', 'Name')
          .and('contain.text', 'Type');
      });
    });
  });
});
