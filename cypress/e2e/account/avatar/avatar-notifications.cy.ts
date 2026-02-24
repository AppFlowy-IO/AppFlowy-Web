import { avatarTestUtils } from './avatar-test-utils';
import { testLog } from '../../../support/test-helpers';

const {
  generateRandomEmail,
  setupBeforeEach,
  signInAndWaitForApp,
  reloadAndOpenAccountSettings,
  imports,
} = avatarTestUtils;
const { APP_EVENTS, updateWorkspaceMemberAvatar, AvatarSelectors, dbUtils } = imports;

describe('Avatar Notifications', () => {
  beforeEach(() => {
    setupBeforeEach();
  });

  describe('Workspace Member Profile Notifications', () => {
    it('should update avatar when workspace member profile notification is received', () => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=notification-test';

      testLog.info('Step 1: Sign in with test account');
      signInAndWaitForApp(testEmail).then(() => {

        testLog.info('Step 2: Get user UUID and workspace ID');
        dbUtils.getCurrentWorkspaceId().then((workspaceId) => {
          expect(workspaceId).to.not.be.null;

          dbUtils.getCurrentUserUuid().then((userUuid) => {
            expect(userUuid).to.not.be.null;

            testLog.info('Step 3: Simulate workspace member profile changed notification');
            cy.window().then((win) => {
              const emitter = (win as typeof window & {
                __APPFLOWY_EVENT_EMITTER__?: { emit: (...args: unknown[]) => void };
              }).__APPFLOWY_EVENT_EMITTER__;

              expect(emitter, 'Event emitter should be available').to.exist;

              // Simulate notification with avatar URL update
              emitter?.emit(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, {
                userUuid: userUuid,
                name: 'Test User',
                avatarUrl: testAvatarUrl,
              });
            });

            cy.wait(2000);

            testLog.info('Step 4: Verify avatar is updated in database');
            dbUtils.getWorkspaceMemberProfile(workspaceId!, userUuid!).then((profile) => {
              expect(profile).to.not.be.null;
              expect(profile?.avatar_url).to.equal(testAvatarUrl);
            });

            testLog.info('Step 5: Reload page and verify avatar persists');
            reloadAndOpenAccountSettings();

            testLog.info('Step 6: Verify avatar image uses updated URL');
            AvatarSelectors.avatarImage().should('exist').and('have.attr', 'src', testAvatarUrl);
          });
        });
      });
    });

    it('should preserve existing avatar when notification omits avatar field', () => {
      const testEmail = generateRandomEmail();
      const existingAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=existing';

      testLog.info('Step 1: Sign in with test account');
      signInAndWaitForApp(testEmail).then(() => {

        testLog.info('Step 2: Set initial avatar via API');
        dbUtils.getCurrentWorkspaceId().then((workspaceId) => {
          expect(workspaceId).to.not.be.null;

          updateWorkspaceMemberAvatar(workspaceId!, existingAvatarUrl).then((response) => {
            expect(response.status).to.equal(200);
          });

          cy.wait(2000);

          testLog.info('Step 3: Get user UUID and workspace ID');
          dbUtils.getCurrentUserUuid().then((userUuid) => {
            expect(userUuid).to.not.be.null;

            testLog.info('Step 4: Verify initial avatar is set');
            dbUtils.getWorkspaceMemberProfile(workspaceId!, userUuid!).then((profile) => {
              expect(profile?.avatar_url).to.equal(existingAvatarUrl);
            });

            testLog.info('Step 5: Simulate notification without avatar field');
            cy.window().then((win) => {
              const emitter = (win as typeof window & {
                __APPFLOWY_EVENT_EMITTER__?: { emit: (...args: unknown[]) => void };
              }).__APPFLOWY_EVENT_EMITTER__;

              // Simulate notification that only updates name, not avatar
              emitter?.emit(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, {
                userUuid: userUuid,
                name: 'Updated Name',
                // avatarUrl is undefined - should preserve existing
              });
            });

            cy.wait(2000);

            testLog.info('Step 6: Verify avatar is preserved');
            dbUtils.getWorkspaceMemberProfile(workspaceId!, userUuid!).then((profile) => {
              expect(profile?.avatar_url).to.equal(existingAvatarUrl);
              expect(profile?.name).to.equal('Updated Name');
            });
          });
        });
      });
    });

    it('should clear avatar when notification sends empty string', () => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=to-clear';

      testLog.info('Step 1: Sign in with test account');
      signInAndWaitForApp(testEmail).then(() => {

        testLog.info('Step 2: Set initial avatar');
        dbUtils.getCurrentWorkspaceId().then((workspaceId) => {
          expect(workspaceId).to.not.be.null;

          updateWorkspaceMemberAvatar(workspaceId!, testAvatarUrl).then((response) => {
            expect(response.status).to.equal(200);
          });

          cy.wait(2000);

          dbUtils.getCurrentUserUuid().then((userUuid) => {
            expect(userUuid).to.not.be.null;

            testLog.info('Step 3: Simulate notification with empty avatar');
            cy.window().then((win) => {
              const emitter = (win as typeof window & {
                __APPFLOWY_EVENT_EMITTER__?: { emit: (...args: unknown[]) => void };
              }).__APPFLOWY_EVENT_EMITTER__;

              // Simulate notification that clears avatar
              emitter?.emit(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, {
                userUuid: userUuid,
                name: 'Test User',
                avatarUrl: '', // Empty string should clear avatar
              });
            });

            cy.wait(2000);

            testLog.info('Step 4: Verify avatar is cleared');
            dbUtils.getWorkspaceMemberProfile(workspaceId!, userUuid!).then((profile) => {
              expect(profile?.avatar_url).to.be.null;
            });
          });
        });
      });
    });
  });
});
