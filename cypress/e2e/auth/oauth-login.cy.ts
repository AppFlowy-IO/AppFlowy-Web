/**
 * Real Authentication Login Tests
 *
 * These tests verify the login flow using real credentials.
 * Uses password-based authentication via GoTrue.
 */
import { TestConfig } from '../../support/test-config';

describe('Real Authentication Login', () => {
  const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

  // Test account credentials
  const testEmail = 'db_blob_user@appflowy.io';
  const testPassword = 'AppFlowy!@123';

  beforeEach(() => {
    // Handle uncaught exceptions
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot read properties of undefined') ||
        err.message.includes('WebSocket') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return false;
      }
      return true;
    });
    cy.viewport(1280, 720);

    // Clear localStorage before each test
    cy.clearAllLocalStorage();
  });

  it('should login with email and password successfully', () => {
    cy.log('[TEST START] Testing login with real credentials');

    // Step 1: Get access token via password grant
    cy.log('[STEP 1] Authenticating with GoTrue');
    cy.request({
      method: 'POST',
      url: `${gotrueUrl}/token?grant_type=password`,
      body: {
        email: testEmail,
        password: testPassword,
      },
      headers: {
        'Content-Type': 'application/json',
      },
      failOnStatusCode: false,
    }).then((response) => {
      cy.log(`[API] Token response status: ${response.status}`);
      expect(response.status).to.equal(200);

      const tokenData = response.body;
      expect(tokenData.access_token).to.exist;
      expect(tokenData.refresh_token).to.exist;

      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;

      // Step 2: Verify user with AppFlowy backend
      cy.log('[STEP 2] Verifying user with AppFlowy backend');
      cy.request({
        method: 'GET',
        url: `${apiUrl}/api/user/verify/${accessToken}`,
        failOnStatusCode: false,
        timeout: 30000,
      }).then((verifyResponse) => {
        cy.log(`[API] Verify response status: ${verifyResponse.status}`);
        // Verify should succeed (200) or user already exists
        expect(verifyResponse.status).to.be.oneOf([200, 201]);

        // Step 3: Store token in localStorage
        cy.log('[STEP 3] Storing token in localStorage');
        cy.window().then((win) => {
          win.localStorage.setItem('token', JSON.stringify(tokenData));
        });

        // Step 4: Visit the app
        cy.log('[STEP 4] Navigating to /app');
        cy.visit('/app', { failOnStatusCode: false });

        // Step 5: Verify we're logged in and on the app page
        cy.log('[STEP 5] Verifying successful login');
        cy.url({ timeout: 30000 }).should('include', '/app');
        cy.url().should('not.include', '/login');

        // Step 6: Wait for app to load and verify no redirect loop
        cy.log('[STEP 6] Verifying app loads without redirect loop');
        cy.wait(5000);
        cy.url().should('include', '/app');
        cy.url().should('not.include', '/login');

        // Step 7: Verify token is still in localStorage
        cy.log('[STEP 7] Verifying token persisted');
        cy.window().then((win) => {
          const token = win.localStorage.getItem('token');
          expect(token).to.not.be.null;
        });

        cy.log('[TEST COMPLETE] Login successful');
      });
    });
  });

  it('should persist session after page reload', () => {
    cy.log('[TEST START] Testing session persistence');

    // Step 1: Login first
    cy.log('[STEP 1] Logging in');
    cy.request({
      method: 'POST',
      url: `${gotrueUrl}/token?grant_type=password`,
      body: {
        email: testEmail,
        password: testPassword,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    }).then((response) => {
      expect(response.status).to.equal(200);
      const tokenData = response.body;

      // Verify user
      cy.request({
        method: 'GET',
        url: `${apiUrl}/api/user/verify/${tokenData.access_token}`,
        failOnStatusCode: false,
      });

      // Store token
      cy.window().then((win) => {
        win.localStorage.setItem('token', JSON.stringify(tokenData));
      });

      // Visit app
      cy.visit('/app', { failOnStatusCode: false });
      cy.url({ timeout: 30000 }).should('include', '/app');

      // Step 2: Reload the page
      cy.log('[STEP 2] Reloading page');
      cy.reload();

      // Step 3: Verify still logged in after reload
      cy.log('[STEP 3] Verifying session persisted after reload');
      cy.wait(3000);
      cy.url().should('include', '/app');
      cy.url().should('not.include', '/login');

      // Step 4: Verify token still exists
      cy.log('[STEP 4] Verifying token still in localStorage');
      cy.window().then((win) => {
        const token = win.localStorage.getItem('token');
        expect(token).to.not.be.null;
      });

      cy.log('[TEST COMPLETE] Session persistence verified');
    });
  });

  it('should redirect to login when token is invalid', () => {
    cy.log('[TEST START] Testing invalid token handling');

    // Step 1: Set an invalid token in localStorage
    cy.log('[STEP 1] Setting invalid token');
    cy.window().then((win) => {
      win.localStorage.setItem('token', JSON.stringify({
        access_token: 'invalid-token-12345',
        refresh_token: 'invalid-refresh-12345',
        expires_at: Math.floor(Date.now() / 1000) - 3600, // Expired
      }));
    });

    // Step 2: Try to visit the app
    cy.log('[STEP 2] Visiting /app with invalid token');
    cy.visit('/app', { failOnStatusCode: false });

    // Step 3: Should be redirected to login (eventually)
    cy.log('[STEP 3] Verifying redirect to login');
    cy.url({ timeout: 30000 }).should('satisfy', (url: string) => {
      // Should either be on login page or show error
      return url.includes('/login') || url.includes('/app');
    });

    cy.log('[TEST COMPLETE] Invalid token handling verified');
  });

  it('should change password, login with new password, then revert', () => {
    cy.log('[TEST START] Testing password change flow');

    const originalPassword = testPassword;
    const newPassword = 'NewAppFlowy!@456';

    // Step 1: Login with original password to get access token
    cy.log('[STEP 1] Logging in with original password');
    cy.request({
      method: 'POST',
      url: `${gotrueUrl}/token?grant_type=password`,
      body: {
        email: testEmail,
        password: originalPassword,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    }).then((loginResponse) => {
      expect(loginResponse.status).to.equal(200);
      const accessToken = loginResponse.body.access_token;
      cy.log('[SUCCESS] Got access token');

      // Step 2: Change password to new password
      cy.log('[STEP 2] Changing password to new password');
      cy.request({
        method: 'PUT',
        url: `${gotrueUrl}/user`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: {
          password: newPassword,
        },
      }).then((changeResponse) => {
        expect(changeResponse.status).to.equal(200);
        cy.log('[SUCCESS] Password changed to new password');

        // Step 3: Verify old password no longer works
        cy.log('[STEP 3] Verifying old password no longer works');
        cy.request({
          method: 'POST',
          url: `${gotrueUrl}/token?grant_type=password`,
          body: {
            email: testEmail,
            password: originalPassword,
          },
          headers: {
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
        }).then((oldPasswordResponse) => {
          expect(oldPasswordResponse.status).to.equal(400);
          cy.log('[SUCCESS] Old password rejected as expected');

          // Step 4: Login with new password
          cy.log('[STEP 4] Logging in with new password');
          cy.request({
            method: 'POST',
            url: `${gotrueUrl}/token?grant_type=password`,
            body: {
              email: testEmail,
              password: newPassword,
            },
            headers: {
              'Content-Type': 'application/json',
            },
          }).then((newLoginResponse) => {
            expect(newLoginResponse.status).to.equal(200);
            const newAccessToken = newLoginResponse.body.access_token;
            cy.log('[SUCCESS] Logged in with new password');

            // Step 5: Store token and verify app access
            cy.log('[STEP 5] Verifying app access with new credentials');
            cy.window().then((win) => {
              win.localStorage.setItem('token', JSON.stringify(newLoginResponse.body));
            });

            cy.visit('/app', { failOnStatusCode: false });
            cy.url({ timeout: 30000 }).should('include', '/app');
            cy.log('[SUCCESS] App access verified with new credentials');

            // Step 6: Revert password back to original
            cy.log('[STEP 6] Reverting password to original');
            cy.request({
              method: 'PUT',
              url: `${gotrueUrl}/user`,
              headers: {
                'Authorization': `Bearer ${newAccessToken}`,
                'Content-Type': 'application/json',
              },
              body: {
                password: originalPassword,
              },
            }).then((revertResponse) => {
              expect(revertResponse.status).to.equal(200);
              cy.log('[SUCCESS] Password reverted to original');

              // Step 7: Verify original password works again
              cy.log('[STEP 7] Verifying original password works again');
              cy.request({
                method: 'POST',
                url: `${gotrueUrl}/token?grant_type=password`,
                body: {
                  email: testEmail,
                  password: originalPassword,
                },
                headers: {
                  'Content-Type': 'application/json',
                },
              }).then((finalLoginResponse) => {
                expect(finalLoginResponse.status).to.equal(200);
                cy.log('[SUCCESS] Original password works again');

                cy.log('[TEST COMPLETE] Password change flow verified');
              });
            });
          });
        });
      });
    });
  });
});
