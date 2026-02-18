import { DatabaseGridSelectors, byTestId } from './selectors';

/**
 * Wait until the app shell is ready for creating/opening pages.
 */
export const waitForAppReady = (): void => {
  cy.get(`${byTestId('inline-add-page')}, ${byTestId('new-page-button')}`, {
    timeout: 20000,
  }).should('be.visible');
};

/**
 * Wait until a grid database is rendered and has at least one cell.
 */
export const waitForGridReady = (): void => {
  DatabaseGridSelectors.grid().should('exist', { timeout: 30000 });
  DatabaseGridSelectors.cells().should('have.length.at.least', 1, {
    timeout: 30000,
  });
};
