import { AuthSelectors } from './selectors';

interface VisitAuthPathOptions {
  waitMs?: number;
}

interface GoToPasswordStepOptions {
  waitMs?: number;
  assertEmailInUrl?: boolean;
}

/**
 * Visit an auth route and wait for the UI to stabilize.
 */
export const visitAuthPath = (path: string, options?: VisitAuthPathOptions): void => {
  const waitMs = options?.waitMs ?? 2000;
  cy.visit(path, { failOnStatusCode: false });
  cy.wait(waitMs);
};

/**
 * Visit the default login page.
 */
export const visitLoginPage = (waitMs: number = 2000): void => {
  visitAuthPath('/login', { waitMs });
};

/**
 * Assert core login page elements are visible.
 */
export const assertLoginPageReady = (): void => {
  cy.contains('Welcome to AppFlowy').should('be.visible');
  AuthSelectors.emailInput().should('be.visible');
  AuthSelectors.passwordSignInButton().should('be.visible');
};

/**
 * From login page, enter email and navigate to password step.
 */
export const goToPasswordStep = (email: string, options?: GoToPasswordStepOptions): void => {
  const waitMs = options?.waitMs ?? 1000;
  const assertEmailInUrl = options?.assertEmailInUrl ?? false;

  AuthSelectors.emailInput().should('be.visible').type(email);
  AuthSelectors.passwordSignInButton().should('be.visible').click();
  cy.wait(waitMs);
  cy.url().should('include', 'action=enterPassword');
  if (assertEmailInUrl) {
    cy.url().should('include', `email=${encodeURIComponent(email)}`);
  }
};

/**
 * Sign in with shared command and wait until app page is loaded.
 */
export const signInAndWaitForApp = (email: string, waitMs: number = 3000): Cypress.Chainable<void> => {
  return cy.signIn(email).then(() => {
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.wait(waitMs);
  });
};
