import { avatarTestUtils } from './avatar-test-utils';
import { testLog } from '../../../support/test-helpers';

const {
  generateRandomEmail,
  setupBeforeEach,
  signInAndWaitForApp,
  reloadAndOpenAccountSettings,
  imports,
} = avatarTestUtils;
const { updateWorkspaceMemberAvatar, AvatarSelectors, dbUtils } = imports;

describe('Avatar Persistence', () => {
  beforeEach(() => {
    setupBeforeEach();
  });

  it('should persist avatar across page reloads', () => {
    const testEmail = generateRandomEmail();
    const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=persist';

    testLog.info('Step 1: Sign in with test account');
    signInAndWaitForApp(testEmail).then(() => {

      testLog.info('Step 2: Set avatar via workspace member profile API');
      dbUtils.getCurrentWorkspaceId().then((workspaceId) => {
        expect(workspaceId).to.not.be.null;

        updateWorkspaceMemberAvatar(workspaceId!, testAvatarUrl).then((response) => {
          expect(response.status).to.equal(200);
        });

        cy.wait(2000);

        testLog.info('Step 3: Reload page and verify avatar persisted');
        reloadAndOpenAccountSettings();

        AvatarSelectors.avatarImage().should('exist').and('have.attr', 'src', testAvatarUrl);

        testLog.info('Step 4: Reload again to verify persistence');
        reloadAndOpenAccountSettings();

        AvatarSelectors.avatarImage().should('exist').and('have.attr', 'src', testAvatarUrl);
      });
    });
  });
});
