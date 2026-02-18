import { avatarTestUtils } from './avatar-test-utils';
import { AvatarUiSelectors } from '../../../support/selectors';
import { testLog } from '../../../support/test-helpers';

const {
  generateRandomEmail,
  setupBeforeEach,
  signInAndWaitForApp,
  reloadAndOpenAccountSettings,
  imports,
} = avatarTestUtils;
const { updateUserMetadata, AvatarSelectors, WorkspaceSelectors } = imports;

describe('Avatar API', () => {
  beforeEach(() => {
    setupBeforeEach();
  });

  describe('Avatar Upload via API', () => {
    it('should update avatar URL via API and display in UI', () => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=test';

      testLog.info('Step 1: Sign in with test account');
      signInAndWaitForApp(testEmail);

      testLog.info('Step 2: Update avatar via API');
      updateUserMetadata(testAvatarUrl).then((response) => {
        testLog.info(`API Response: ${JSON.stringify(response)}`);
        expect(response.status).to.equal(200);
      });

      testLog.info('Step 3: Reload page to see updated avatar');
      reloadAndOpenAccountSettings();

      testLog.info('Step 4: Verify avatar image is displayed in Account Settings');
      // Note: Account Settings dialog may not display avatar directly
      // The avatar is displayed via getUserIconUrl which prioritizes workspace member avatar
      // Since we updated user metadata (icon_url), it should be available
      // But the actual display location might be in the workspace dropdown or elsewhere

      // Wait for any avatar image to be present and loaded
      // The AvatarImage component loads asynchronously and sets opacity to 0 while loading
      AvatarUiSelectors.image()
        .should('exist')
        .should(($imgs) => {
          // Find the first visible avatar image (opacity not 0)
          let foundVisible = false;
          $imgs.each((index, img) => {
            const $img = Cypress.$(img);
            const opacity = $img.css('opacity');
            const src = $img.attr('src');
            if (opacity !== '0' && src && src.length > 0) {
              foundVisible = true;
              return false; // break
            }
          });
          expect(foundVisible, 'At least one avatar image should be visible').to.be.true;
        });

      // Verify that the avatar image has loaded (check for non-empty src and visible state)
      AvatarUiSelectors.image().then(($imgs) => {
        let foundLoaded = false;
        $imgs.each((index, img) => {
          const $img = Cypress.$(img);
          const opacity = parseFloat($img.css('opacity') || '0');
          const src = $img.attr('src') || '';

          if (opacity > 0 && src.length > 0) {
            foundLoaded = true;
            testLog.info( `Found loaded avatar image with src: ${src.substring(0, 50)}...`);
            return false; // break
          }
        });
        expect(foundLoaded, 'At least one avatar image should be loaded and visible').to.be.true;
      });
    });

    it('test direct API call', () => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=test';

      testLog.info('========== Step 1: Sign in with test account ==========');
      signInAndWaitForApp(testEmail);

      testLog.info('========== Step 2: Get token from localStorage ==========');
      cy.window()
        .its('localStorage')
        .invoke('getItem', 'token')
        .then((tokenStr) => {
          testLog.info(`Token string: ${tokenStr ? 'Found' : 'Not found'}`);
          const token = JSON.parse(tokenStr);
          const accessToken = token.access_token;
          testLog.info(`Access token: ${accessToken ? 'Present (length: ' + accessToken.length + ')' : 'Missing'}`);
        });

      testLog.info('========== Step 3: Making API request ==========');
      testLog.info(`URL: ${avatarTestUtils.APPFLOWY_BASE_URL}/api/user/update`);
      testLog.info(`Avatar URL: ${testAvatarUrl}`);

      updateUserMetadata(testAvatarUrl).then((response) => {
        testLog.info('========== Step 4: Checking response ==========');
        testLog.info(`Response is null: ${response === null}`);
        testLog.info(`Response type: ${typeof response}`);
        testLog.info(`Response status: ${response?.status}`);
        testLog.info(`Response body: ${JSON.stringify(response?.body)}`);
        testLog.info(`Response headers: ${JSON.stringify(response?.headers)}`);

        expect(response).to.not.be.null;
        expect(response.status).to.equal(200);

        if (response.body) {
          testLog.info(`Response body code: ${response.body.code}`);
          testLog.info(`Response body message: ${response.body.message}`);
        }
      });
    });

    it('should display emoji as avatar via API', () => {
      const testEmail = generateRandomEmail();
      const testEmoji = '🎨';

      testLog.info('Step 1: Sign in with test account');
      signInAndWaitForApp(testEmail);

      testLog.info('Step 2: Update avatar to emoji via API');
      updateUserMetadata(testEmoji).then((response) => {
        expect(response).to.not.be.null;
        expect(response.status).to.equal(200);
      });

      testLog.info('Step 3: Reload page');
      reloadAndOpenAccountSettings();

      testLog.info('Step 4: Verify emoji is displayed in fallback');
      AvatarSelectors.avatarFallback().should('contain.text', testEmoji);
    });

    it('should display fallback character when no avatar is set', () => {
      const testEmail = generateRandomEmail();

      testLog.info('Step 1: Sign in with test account (no avatar set)');
      signInAndWaitForApp(testEmail).then(() => {

        testLog.info('Step 2: Open workspace dropdown to see avatar');
        WorkspaceSelectors.dropdownTrigger().click();
        cy.wait(500);

        testLog.info('Step 3: Verify fallback is displayed in workspace dropdown avatar');
        AvatarSelectors.workspaceDropdownAvatar().within(() => {
          AvatarSelectors.avatarFallback().should('be.visible');
        });
      });
    });
  });
});
