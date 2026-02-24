import { APP_EVENTS } from '../../../../src/application/constants';

import { updateUserMetadata, updateWorkspaceMemberAvatar } from '../../../support/api-utils';
import { AvatarSelectors } from '../../../support/avatar-selectors';
import { dbUtils } from '../../../support/db-utils';
import { AccountSelectors, WorkspaceSelectors } from '../../../support/selectors';
import { generateRandomEmail, getTestEnvironment } from '../../../support/test-config';

const appflowyEnv = getTestEnvironment();

const signInAndWaitForApp = (testEmail: string, waitMs: number = 3000): Cypress.Chainable<void> => {
  return cy.signIn(testEmail).then(() => {
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.wait(waitMs);
  });
};

const openAccountSettings = (): void => {
  WorkspaceSelectors.dropdownTrigger().click();
  cy.wait(1000);
  AccountSelectors.settingsButton().should('be.visible').click();
  AvatarSelectors.accountSettingsDialog().should('be.visible');
};

const reloadAndOpenAccountSettings = (): void => {
  cy.reload();
  cy.wait(3000);
  openAccountSettings();
};

/**
 * Shared utilities and setup for avatar tests
 */
export const avatarTestUtils = {
  generateRandomEmail,
  APPFLOWY_BASE_URL: appflowyEnv.appflowyBaseUrl,
  signInAndWaitForApp,
  openAccountSettings,
  reloadAndOpenAccountSettings,

  /**
   * Common beforeEach setup for avatar tests
   */
  setupBeforeEach: () => {
    // Suppress known transient errors
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return false;
      }

      return true;
    });
    cy.viewport(1280, 720);
  },

  /**
   * Common imports for avatar tests
   */
  imports: {
    APP_EVENTS,
    updateUserMetadata,
    updateWorkspaceMemberAvatar,
    AvatarSelectors,
    dbUtils,
    WorkspaceSelectors,
  },
};
