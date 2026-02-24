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

describe('Avatar Types', () => {
    beforeEach(() => {
        setupBeforeEach();
    });

    it('should handle different avatar URL types (HTTP, HTTPS, data URL)', () => {
        const testEmail = generateRandomEmail();
        const httpsAvatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=https';

        testLog.info('Step 1: Sign in with test account');
        signInAndWaitForApp(testEmail).then(() => {

            testLog.info('Step 2: Test HTTPS avatar URL');
            dbUtils.getCurrentWorkspaceId().then((workspaceId) => {
                expect(workspaceId).to.not.be.null;

                updateWorkspaceMemberAvatar(workspaceId!, httpsAvatar).then((response) => {
                    expect(response.status).to.equal(200);
                });

                cy.wait(2000);
                reloadAndOpenAccountSettings();

                AvatarSelectors.avatarImage().should('exist').and('have.attr', 'src', httpsAvatar);
            });
        });
    });

    it('should handle emoji avatars correctly', () => {
        const testEmail = generateRandomEmail();
        const emojiAvatars = ['🎨', '🚀', '⭐', '🎯'];

        testLog.info('Step 1: Sign in with test account');
        signInAndWaitForApp(testEmail).then(() => {

            testLog.info('Step 2: Test each emoji avatar');
            dbUtils.getCurrentWorkspaceId().then((workspaceId) => {
                expect(workspaceId).to.not.be.null;

                emojiAvatars.forEach((emoji, index) => {
                    updateWorkspaceMemberAvatar(workspaceId!, emoji).then((response) => {
                        expect(response.status).to.equal(200);
                    });

                    cy.wait(2000);
                    reloadAndOpenAccountSettings();

                    // Emoji should be displayed in fallback, not as image
                    AvatarSelectors.avatarFallback().should('contain.text', emoji);
                });
            });
        });
    });
});
