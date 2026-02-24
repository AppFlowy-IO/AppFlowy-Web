import { avatarTestUtils } from './avatar-test-utils';
import { testLog } from '../../../support/test-helpers';

const {
  generateRandomEmail,
  setupBeforeEach,
  signInAndWaitForApp,
  openAccountSettings,
  imports,
} = avatarTestUtils;
const { updateUserMetadata, updateWorkspaceMemberAvatar, AvatarSelectors, dbUtils } = imports;

describe('Avatar Priority', () => {
  beforeEach(() => {
    setupBeforeEach();
  });

  it('should prioritize workspace avatar over user metadata avatar', () => {
    const testEmail = generateRandomEmail();
    const userMetadataAvatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=user-metadata';
    const workspaceAvatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=workspace';

    testLog.info('Step 1: Sign in with test account');
    signInAndWaitForApp(testEmail).then(() => {

      testLog.info('Step 2: Set user metadata avatar');
      updateUserMetadata(userMetadataAvatar).then((response) => {
        expect(response.status).to.equal(200);
      });

      cy.wait(2000);

      testLog.info('Step 3: Set workspace member avatar');
      dbUtils.getCurrentWorkspaceId().then((workspaceId) => {
        expect(workspaceId).to.not.be.null;

        updateWorkspaceMemberAvatar(workspaceId!, workspaceAvatar).then((response) => {
          expect(response.status).to.equal(200);
        });

        cy.wait(2000);
        cy.reload();
        cy.wait(3000);

        testLog.info('Step 4: Verify workspace avatar is displayed (priority)');
        openAccountSettings();

        // Workspace avatar should be displayed, not user metadata avatar
        AvatarSelectors.avatarImage().should('exist').and('have.attr', 'src', workspaceAvatar);
      });
    });
  });
});
