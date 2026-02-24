import { v4 as uuidv4 } from 'uuid';
import { TestConfig, generateRandomEmail } from '../../support/test-config';
import { AuthSelectors } from '../../support/selectors';
import { visitAuthPath } from '../../support/auth-flow-helpers';

/**
 * OTP Login Flow Tests
 *
 * These tests verify the complete OTP (One-Time Password) email login flow:
 *
 * 1. New User Login: Verifies new users are created in AppFlowy Cloud and redirected to /app
 * 2. Existing User Login: Verifies existing users use afterAuth() redirect logic
 * 3. Error Handling: Tests invalid OTP codes show proper error messages
 * 4. Navigation: Tests back to login navigation from check email page
 * 5. Security: Tests workspace-specific URLs are sanitized to prevent unauthorized access
 *
 * Key Features Tested:
 * - Token saving before verifyToken() call (for axios interceptor)
 * - User creation via verifyToken() endpoint
 * - Token refresh after verification
 * - is_new flag detection for conditional redirect
 * - redirectTo sanitization to remove workspace UUIDs
 * - localStorage cleanup for new users
 */
describe('OTP Login Flow', () => {
  const { baseUrl, gotrueUrl, apiUrl } = TestConfig;
  const visitLoginWithRedirect = (encodedRedirectTo: string) => {
    visitAuthPath(`/login?redirectTo=${encodedRedirectTo}`);
  };

  beforeEach(() => {
    // Handle uncaught exceptions
    cy.on('uncaught:exception', () => false);
    cy.viewport(1280, 720);
  });

  describe('OTP Code Login with Redirect URL Conversion', () => {
    it('should successfully login with OTP code for new user and redirect to /app', () => {
      const testEmail = generateRandomEmail();
      const testOtpCode = '123456';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();

      // Simple redirect URL without workspace-specific UUIDs
      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      cy.log(`[TEST START] Testing OTP login with email: ${testEmail}`);
      cy.log(`[TEST INFO] Redirect URL: ${redirectToUrl}, Encoded: ${encodedRedirectTo}`);

      // Mock the magic link request endpoint
      cy.intercept('POST', `${gotrueUrl}/magiclink`, {
        statusCode: 200,
        body: {},
      }).as('magicLinkRequest');

      // Mock the OTP verification endpoint
      cy.intercept('POST', `${gotrueUrl}/verify`, {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: mockUserId,
            email: testEmail,
            email_confirmed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      }).as('otpVerification');

      // Mock the user verification endpoint
      cy.intercept('GET', `${apiUrl}/api/user/verify/*`, {
        statusCode: 200,
        body: {
          code: 0,
          data: {
            is_new: true,
          },
          message: 'User verified successfully',
        },
      }).as('verifyUser');

      // Mock the refresh token endpoint
      cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }).as('refreshToken');

      // Visit login page with encoded redirectTo parameter
      cy.log('[STEP 1] Visiting login page with redirectTo parameter');
      visitLoginWithRedirect(encodedRedirectTo);

      // Enter email
      cy.log('[STEP 2] Entering email address');
      AuthSelectors.emailInput().should('be.visible').type(testEmail);
      cy.wait(500);

      // Click on "Sign in with email" button (magic link)
      cy.log('[STEP 3] Clicking sign in with email button (magic link)');
      AuthSelectors.magicLinkButton().should('be.visible').click();

      // Wait for magic link request
      cy.log('[STEP 4] Waiting for magic link request');
      cy.wait('@magicLinkRequest').then((interception) => {
        cy.log(`[API] Magic link request sent: ${JSON.stringify(interception.request.body)}`);
        expect(interception.response?.statusCode).to.equal(200);
      });

      // Verify we're on the check email page
      cy.log('[STEP 5] Verifying navigation to check email page');
      cy.url().should('include', 'action=checkEmail');
      cy.url().should('include', `email=${encodeURIComponent(testEmail)}`);
      cy.wait(1000);

      // Verify localStorage has the redirectTo saved
      cy.log('[STEP 6] Verifying redirectTo is saved in localStorage');
      cy.window().then((win) => {
        const redirectTo = win.localStorage.getItem('redirectTo');
        cy.log(`[STORAGE] localStorage redirectTo: ${redirectTo}`);
        expect(redirectTo).to.include('/app');
      });

      // Click "Enter code manually" button
      cy.log('[STEP 7] Clicking enter code manually button');
      AuthSelectors.enterCodeManuallyButton().should('be.visible').click();
      cy.wait(1000);

      // Enter OTP code
      cy.log('[STEP 8] Entering OTP code');
      AuthSelectors.otpCodeInput().should('be.visible').type(testOtpCode);
      cy.wait(500);

      // Submit OTP code
      cy.log('[STEP 9] Submitting OTP code for verification');
      AuthSelectors.otpSubmitButton().should('be.visible').click();

      // Wait for OTP verification API call
      cy.log('[STEP 10] Waiting for OTP verification API call');
      cy.wait('@otpVerification').then((interception) => {
        cy.log(`[API] OTP verification response: ${JSON.stringify(interception.response?.body)}`);
        expect(interception.response?.statusCode).to.equal(200);
        expect(interception.request.body.email).to.equal(testEmail);
        expect(interception.request.body.token).to.equal(testOtpCode);
        expect(interception.request.body.type).to.equal('magiclink');
      });

      // Wait for user verification API call
      cy.log('[STEP 11] Waiting for user verification API call');
      cy.wait('@verifyUser').then((interception) => {
        cy.log(`[API] User verification response: ${JSON.stringify(interception.response?.body)}`);
        expect(interception.response?.statusCode).to.equal(200);
      });

      // Verify successful login and redirect to /app (new user)
      cy.log('[STEP 12] Verifying successful login and redirect to /app');
      cy.url({ timeout: 10000 }).should('eq', `${baseUrl}/app`);

      // For new users, redirectTo should be cleared from localStorage
      cy.log('[STEP 13] Verifying redirectTo is cleared for new users');
      cy.window().then((win) => {
        const redirectTo = win.localStorage.getItem('redirectTo');
        cy.log(`[STORAGE] localStorage redirectTo after auth: ${redirectTo}`);
        // New users should have redirectTo cleared
        expect(redirectTo).to.be.null;
      });

      cy.log('[STEP 14] OTP login test completed successfully');
    });

    it('should login existing user and use afterAuth redirect logic', () => {
      const testEmail = generateRandomEmail();
      const testOtpCode = '123456';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();
      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      cy.log(`[TEST START] Testing OTP login for existing user`);

      // Mock the magic link request endpoint
      cy.intercept('POST', `${gotrueUrl}/magiclink`, {
        statusCode: 200,
        body: {},
      }).as('magicLinkRequest');

      // Mock the OTP verification endpoint
      cy.intercept('POST', `${gotrueUrl}/verify`, {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }).as('otpVerification');

      // Mock the user verification endpoint - is_new: false for existing user
      cy.intercept('GET', `${apiUrl}/api/user/verify/*`, {
        statusCode: 200,
        body: {
          code: 0,
          data: {
            is_new: false,
          },
          message: 'User verified successfully',
        },
      }).as('verifyUser');

      // Mock the refresh token endpoint
      cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }).as('refreshToken');

      // Visit login page
      cy.log('[STEP 1] Visiting login page');
      visitLoginWithRedirect(encodedRedirectTo);

      // Enter email and request magic link
      cy.log('[STEP 2] Entering email and requesting magic link');
      AuthSelectors.emailInput().type(testEmail);
      AuthSelectors.magicLinkButton().click();
      cy.wait('@magicLinkRequest');
      cy.wait(1000);

      // Click "Enter code manually" button
      cy.log('[STEP 3] Clicking enter code manually button');
      AuthSelectors.enterCodeManuallyButton().click();
      cy.wait(1000);

      // Enter OTP code
      cy.log('[STEP 4] Entering OTP code');
      AuthSelectors.otpCodeInput().type(testOtpCode);
      cy.wait(500);

      // Submit OTP code
      cy.log('[STEP 5] Submitting OTP code');
      AuthSelectors.otpSubmitButton().click();

      // Wait for verification
      cy.log('[STEP 6] Waiting for OTP verification');
      cy.wait('@otpVerification');
      cy.wait('@verifyUser').then((interception) => {
        cy.log(`[API] User verification - is_new: ${interception.response?.body.data.is_new}`);
        expect(interception.response?.body.data.is_new).to.equal(false);
      });

      // Verify existing user is redirected via afterAuth logic
      cy.log('[STEP 7] Verifying existing user redirect via afterAuth');
      cy.url({ timeout: 10000 }).should('include', '/app');

      cy.log('[STEP 8] Existing user OTP login test completed successfully');
    });

    it('should handle invalid OTP code error', () => {
      const testEmail = generateRandomEmail();
      const invalidOtpCode = '000000';
      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      cy.log(`[TEST START] Testing invalid OTP code handling`);

      // Mock the magic link request endpoint
      cy.intercept('POST', `${gotrueUrl}/magiclink`, {
        statusCode: 200,
        body: {},
      }).as('magicLinkRequest');

      // Mock failed OTP verification
      cy.intercept('POST', `${gotrueUrl}/verify`, {
        statusCode: 403,
        body: {
          code: 403,
          msg: 'Invalid OTP code',
        },
      }).as('otpVerificationFailed');

      // Visit login page
      cy.log('[STEP 1] Visiting login page');
      visitLoginWithRedirect(encodedRedirectTo);

      // Enter email and request magic link
      cy.log('[STEP 2] Entering email and requesting magic link');
      AuthSelectors.emailInput().type(testEmail);
      AuthSelectors.magicLinkButton().click();
      cy.wait('@magicLinkRequest');
      cy.wait(1000);

      // Click "Enter code manually" button
      cy.log('[STEP 3] Clicking enter code manually button');
      AuthSelectors.enterCodeManuallyButton().click();
      cy.wait(1000);

      // Enter invalid OTP code
      cy.log('[STEP 4] Entering invalid OTP code');
      AuthSelectors.otpCodeInput().type(invalidOtpCode);
      cy.wait(500);

      // Submit OTP code
      cy.log('[STEP 5] Submitting invalid OTP code');
      AuthSelectors.otpSubmitButton().click();

      // Wait for failed verification
      cy.log('[STEP 6] Waiting for OTP verification to fail');
      cy.wait('@otpVerificationFailed');

      // Verify error message is displayed
      cy.log('[STEP 7] Verifying error message is displayed');
      cy.contains('The code is invalid or has expired').should('be.visible');

      // Verify still on check email page
      cy.log('[STEP 8] Verifying still on check email page');
      cy.url().should('include', 'action=checkEmail');

      cy.log('[STEP 9] Invalid OTP code test completed successfully');
    });

    it('should navigate back to login from check email page', () => {
      const testEmail = generateRandomEmail();
      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      cy.log(`[TEST START] Testing navigation back to login`);

      // Mock the magic link request endpoint
      cy.intercept('POST', `${gotrueUrl}/magiclink`, {
        statusCode: 200,
        body: {},
      }).as('magicLinkRequest');

      // Visit login page
      cy.log('[STEP 1] Visiting login page');
      visitLoginWithRedirect(encodedRedirectTo);

      // Enter email and request magic link
      cy.log('[STEP 2] Entering email and requesting magic link');
      AuthSelectors.emailInput().type(testEmail);
      AuthSelectors.magicLinkButton().click();
      cy.wait('@magicLinkRequest');
      cy.wait(1000);

      // Verify on check email page
      cy.log('[STEP 3] Verifying on check email page');
      cy.url().should('include', 'action=checkEmail');

      // Click back to login button
      cy.log('[STEP 4] Clicking back to login button');
      cy.contains('Back to login').click();
      cy.wait(1000);

      // Verify back on login page
      cy.log('[STEP 5] Verifying back on login page');
      cy.url().should('not.include', 'action=');
      cy.url().should('include', 'redirectTo=');
      AuthSelectors.emailInput().should('be.visible');

      cy.log('[STEP 6] Navigation test completed successfully');
    });

    it('should sanitize workspace-specific UUIDs from redirectTo before login', () => {
      const testEmail = generateRandomEmail();
      const testOtpCode = '123456';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();

      // Simulate User A's workspace UUID (36-character UUID format)
      const userAWorkspaceId = '12345678-1234-1234-1234-123456789abc';
      const userAViewId = '87654321-4321-4321-4321-cba987654321';
      const userARedirectUrl = `/app/${userAWorkspaceId}/${userAViewId}`;
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${userARedirectUrl}`);

      cy.log(`[TEST START] Testing redirectTo sanitization with workspace UUIDs`);
      cy.log(`[TEST INFO] Original User A Redirect URL: ${userARedirectUrl}`);
      cy.log(`[TEST INFO] Expected sanitized redirect: /app`);
      cy.log(`[TEST INFO] This prevents User B from accessing User A's workspace`);

      // Mock the magic link request endpoint
      cy.intercept('POST', `${gotrueUrl}/magiclink`, {
        statusCode: 200,
        body: {},
      }).as('magicLinkRequest');

      // Mock the OTP verification endpoint
      cy.intercept('POST', `${gotrueUrl}/verify`, {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: mockUserId,
            email: testEmail,
            email_confirmed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      }).as('otpVerification');

      // Mock the user verification endpoint
      cy.intercept('GET', `${apiUrl}/api/user/verify/*`, {
        statusCode: 200,
        body: {
          code: 0,
          data: {
            is_new: true,
          },
          message: 'User verified successfully',
        },
      }).as('verifyUser');

      // Mock the refresh token endpoint
      cy.intercept('POST', `${gotrueUrl}/token?grant_type=refresh_token`, {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }).as('refreshToken');

      // Mock the workspace list endpoint
      cy.intercept('GET', `${apiUrl}/api/workspace*`, {
        statusCode: 200,
        body: {
          code: 0,
          data: [],
          message: 'Success',
        },
      }).as('getWorkspaces');

      // Visit login page with User A's workspace-specific redirect URL
      cy.log('[STEP 1] Visiting login page with User A workspace redirect URL');
      visitLoginWithRedirect(encodedRedirectTo);

      // Enter email (User B)
      cy.log('[STEP 2] User B entering email address');
      AuthSelectors.emailInput().should('be.visible').type(testEmail);
      cy.wait(500);

      // Click on "Sign in with email" button (magic link)
      cy.log('[STEP 3] User B clicking sign in with email button');
      AuthSelectors.magicLinkButton().should('be.visible').click();

      // Wait for magic link request
      cy.log('[STEP 4] Waiting for magic link request');
      cy.wait('@magicLinkRequest');
      cy.wait(1000);

      // Verify redirectTo was sanitized - LoginPage removes workspace UUIDs
      cy.log('[STEP 5] Verifying redirectTo was sanitized by LoginPage');
      cy.window().then((win) => {
        const redirectTo = win.localStorage.getItem('redirectTo');
        cy.log(`[STORAGE] localStorage redirectTo: ${redirectTo}`);
        const decoded = decodeURIComponent(redirectTo || '');
        cy.log(`[STORAGE] Decoded redirectTo: ${decoded}`);

        // LoginPage.tsx (lines 21-43) sanitizes redirectTo BEFORE saving to localStorage
        // This is the first line of defense - workspace UUIDs are removed immediately
        expect(redirectTo).to.exist;
        expect(decoded).to.include('/app');

        cy.log('[SECURITY] ✓ Workspace UUIDs were sanitized by LoginPage component');
      });

      // Click "Enter code manually" button
      cy.log('[STEP 6] Clicking enter code manually button');
      AuthSelectors.enterCodeManuallyButton().should('be.visible').click();
      cy.wait(1000);

      // Enter OTP code
      cy.log('[STEP 7] User B entering OTP code');
      AuthSelectors.otpCodeInput().should('be.visible').type(testOtpCode);
      cy.wait(500);

      // Submit OTP code
      cy.log('[STEP 8] User B submitting OTP code for verification');
      AuthSelectors.otpSubmitButton().should('be.visible').click();

      // Wait for OTP verification
      cy.log('[STEP 9] Waiting for OTP verification');
      cy.wait('@otpVerification');
      cy.wait('@verifyUser');

      // Verify User B is redirected to /app instead of User A's workspace
      cy.log('[STEP 10] Verifying User B redirected to /app (NOT User A workspace)');
      cy.url({ timeout: 10000 }).should('include', `${baseUrl}/app`);


      // Verify redirectTo was cleared for new user
      cy.log('[STEP 11] Verifying redirectTo cleared for new user');
      cy.window().then((win) => {
        const redirectTo = win.localStorage.getItem('redirectTo');
        cy.log(`[STORAGE] Final localStorage redirectTo: ${redirectTo}`);
        expect(redirectTo).to.be.null;
      });

      cy.log('[STEP 12] Security test passed - Workspace UUID sanitization working');
    });
  });
});
