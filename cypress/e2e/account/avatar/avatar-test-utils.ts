import { v4 as uuidv4 } from 'uuid';

import { APP_EVENTS } from '../../../../src/application/constants';

import { updateUserMetadata, updateWorkspaceMemberAvatar } from '../../../support/api-utils';
import { AuthTestUtils } from '../../../support/auth-utils';
import { AvatarSelectors } from '../../../support/avatar-selectors';
import { dbUtils } from '../../../support/db-utils';
import { WorkspaceSelectors } from '../../../support/selectors';
import { TestConfig } from '../../../support/test-config';
import { setupCommonExceptionHandlers } from '../../../support/exception-handlers';

/**
 * Shared utilities and setup for avatar tests
 */
export const avatarTestUtils = {
  generateRandomEmail: () => `${uuidv4()}@appflowy.io`,
  APPFLOWY_BASE_URL: TestConfig.apiUrl,

  /**
   * Common beforeEach setup for avatar tests
   */
  setupBeforeEach: () => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  },

  /**
   * Common imports for avatar tests
   */
  imports: {
    APP_EVENTS,
    updateUserMetadata,
    updateWorkspaceMemberAvatar,
    AuthTestUtils,
    AvatarSelectors,
    dbUtils,
    WorkspaceSelectors,
  },
};

