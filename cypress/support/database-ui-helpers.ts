import { AddPageSelectors, DatabaseGridSelectors, byTestId, waitForReactUpdate } from './selectors';

export type DatabaseViewType = 'Grid' | 'Board' | 'Calendar';

interface CreateDatabaseViewOptions {
  appReadyWaitMs?: number;
  createWaitMs?: number;
  verify?: () => void;
}

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

/**
 * Create a database view from the add-page menu.
 */
export const createDatabaseView = (viewType: DatabaseViewType, createWaitMs: number = 5000): void => {
  AddPageSelectors.inlineAddButton().first().click({ force: true });
  waitForReactUpdate(1000);
  cy.get('[role="menuitem"]').contains(viewType).click({ force: true });
  cy.wait(createWaitMs);
};

/**
 * Sign in, wait for app shell, then create a database view.
 */
export const signInAndCreateDatabaseView = (
  testEmail: string,
  viewType: DatabaseViewType,
  options?: CreateDatabaseViewOptions
): Cypress.Chainable<void> => {
  const appReadyWaitMs = options?.appReadyWaitMs ?? 3000;
  const createWaitMs = options?.createWaitMs ?? 5000;

  return cy.signIn(testEmail).then(() => {
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.wait(appReadyWaitMs);
    createDatabaseView(viewType, createWaitMs);
    options?.verify?.();
  });
};
