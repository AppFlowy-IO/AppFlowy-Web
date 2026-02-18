import { v4 as uuidv4 } from 'uuid';
import { TestConfig, generateRandomEmail } from '../../support/test-config';
import { AuthSelectors } from '../../support/selectors';
import { goToPasswordStep, visitAuthPath, visitLoginPage } from '../../support/auth-flow-helpers';

describe('Password Login Flow', () => {
  const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

  beforeEach(() => {
    // Handle uncaught exceptions
    cy.on('uncaught:exception', () => false);
    cy.viewport(1280, 720);
  });

  describe('Basic Login Flow', () => {
    it('should display login page elements correctly', () => {
      cy.log('[TEST START] Testing login page elements');

      // Visit login page
      visitLoginPage(3000); // Give page time to fully load

      // Check for login page elements
      cy.log('[STEP 1] Checking for login page title');
      cy.contains('Welcome to AppFlowy').should('be.visible');

      // Check for email input - using multiple selector strategies
      cy.log('[STEP 2] Looking for email input field');

      // Try finding by placeholder text first
      cy.get('input[placeholder*="email"]', { timeout: 10000 }).should('exist');

      cy.log('[STEP 3] Test completed - Login page loaded successfully');
    });

    it('should allow entering email and navigating to password page', () => {
      const testEmail = generateRandomEmail();

      cy.log(`[TEST START] Testing email entry with: ${testEmail}`);

      // Visit login page
      visitLoginPage(3000);

      // Find and fill email input
      cy.log('[STEP 1] Finding email input by placeholder');
      cy.get('input[placeholder*="email" i]', { timeout: 10000 })
        .should('be.visible')
        .type(testEmail)
        .should('have.value', testEmail);

      // Look for password button
      cy.log('[STEP 2] Looking for password sign-in button');
      cy.contains('button', 'password', { matchCase: false })
        .should('be.visible')
        .click();

      // Verify navigation to password page
      cy.log('[STEP 3] Verifying navigation to password page');
      cy.wait(2000);
      cy.url().should('include', 'enterPassword');

      cy.log('[STEP 4] Test completed successfully');
    });
  });

  describe('Successful Authentication', () => {
    const mockSuccessfulLogin = (testEmail: string, mockUserId: string, mockAccessToken: string, mockRefreshToken: string) => {
      cy.intercept('GET', '**/api/user/verify/**', {
        statusCode: 200,
        body: {
          code: 0,
          data: {
            is_new: false,
          },
          message: 'success',
        },
      }).as('verifyUser');

      cy.intercept({
        method: 'POST',
        url: /\/token\?grant_type=refresh_token/,
      }, {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }).as('refreshToken');

      cy.intercept('GET', '**/api/user/profile*', {
        statusCode: 200,
        body: {
          code: 0,
          data: {
            uid: 1,
            uuid: mockUserId,
            email: testEmail,
            name: 'Test User',
            metadata: {
              timezone: {
                default_timezone: 'UTC',
                timezone: 'UTC',
              },
            },
            encryption_sign: null,
            latest_workspace_id: uuidv4(),
            updated_at: Date.now(),
          },
          message: 'success',
        },
      }).as('getUserProfile');

      cy.intercept('GET', '**/api/user/workspace*', {
        statusCode: 200,
        body: {
          code: 0,
          data: [],
          message: 'success',
        },
      }).as('getUserWorkspaces');
    };

    it('should successfully login with email and password', () => {
      const testEmail = generateRandomEmail();
      const testPassword = 'SecurePassword123!';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();

      cy.log(`[TEST START] Testing password login with email: ${testEmail}`);

      // Mock the password authentication endpoint
      cy.intercept('POST', `${gotrueUrl}/token?grant_type=password`, {
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
      }).as('passwordLogin');

      mockSuccessfulLogin(testEmail, mockUserId, mockAccessToken, mockRefreshToken);

      // Visit login page
      cy.log('[STEP 1] Visiting login page');
      visitLoginPage();

      // Enter email
      cy.log('[STEP 2] Entering email address');
      goToPasswordStep(testEmail, { waitMs: 1000, assertEmailInUrl: true });

      // Enter password
      cy.log('[STEP 5] Entering password');
      AuthSelectors.passwordInput().should('be.visible').type(testPassword);
      cy.wait(500);

      // Submit password
      cy.log('[STEP 6] Submitting password for authentication');
      AuthSelectors.passwordSubmitButton().should('be.visible').click();

      // Wait for API calls
      cy.log('[STEP 7] Waiting for authentication API calls');
      cy.wait('@passwordLogin').then((interception) => {
        cy.log(`[API] Password login response: ${JSON.stringify(interception.response?.body)}`);
        expect(interception.response?.statusCode).to.equal(200);
      });

      // Verify successful login
      cy.log('[STEP 8] Verifying successful login');
      cy.url({ timeout: 10000 }).should('include', '/app');

      cy.log('[STEP 9] Password login test completed successfully');
    });

    it('should handle login with mock API using flexible selectors', () => {
      const testEmail = generateRandomEmail();
      const testPassword = 'TestPassword123!';
      const mockAccessToken = 'mock-token-' + uuidv4();
      const mockRefreshToken = 'refresh-' + mockAccessToken;
      const mockUserId = uuidv4();

      cy.log(`[TEST START] Testing full password login flow`);

      // Mock the authentication endpoint
      cy.intercept('POST', '**/token?grant_type=password', {
        statusCode: 200,
        body: {
          access_token: mockAccessToken,
          refresh_token: mockRefreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: mockUserId, email: testEmail },
        },
      }).as('passwordAuth');

      mockSuccessfulLogin(testEmail, mockUserId, mockAccessToken, mockRefreshToken);

      // Navigate directly to password page
      visitAuthPath(`/login?action=enterPassword&email=${encodeURIComponent(testEmail)}`, { waitMs: 3000 });

      // Look for password input
      cy.log('[STEP 1] Finding password input field');
      cy.get('input[type="password"]', { timeout: 10000 })
        .should('be.visible')
        .type(testPassword);

      // Find and click submit button
      cy.log('[STEP 2] Finding submit button');
      cy.contains('button', 'Continue', { matchCase: false })
        .should('be.visible')
        .click();

      // Wait for authentication
      cy.log('[STEP 3] Waiting for authentication');
      cy.wait('@passwordAuth');

      // Verify successful login
      cy.log('[STEP 4] Verifying successful authentication');
      cy.url({ timeout: 10000 }).should('include', '/app');

      cy.log('[STEP 5] Test completed successfully');
    });
  });

  describe('Error Handling', () => {
    it('should show error for invalid email format', () => {
      const invalidEmail = 'not-an-email';

      cy.log('[TEST START] Testing invalid email validation');

      // Visit login page
      visitLoginPage(3000);

      // Enter invalid email
      cy.log('[STEP 1] Entering invalid email');
      cy.get('input[placeholder*="email" i]', { timeout: 10000 })
        .type(invalidEmail);

      // Try to proceed with password login
      cy.log('[STEP 2] Clicking password button');
      cy.contains('button', 'password', { matchCase: false }).click();

      // Check for error message
      cy.log('[STEP 3] Checking for validation error');
      cy.contains('Please enter a valid email address', { timeout: 5000 }).should('be.visible');

      cy.log('[STEP 4] Test completed - Validation working correctly');
    });

    it('should handle incorrect password error', () => {
      const testEmail = 'test@appflowy.io';
      const wrongPassword = 'WrongPassword123!';

      cy.log('[TEST START] Testing incorrect password handling');

      // Mock failed authentication
      cy.intercept('POST', `${gotrueUrl}/token?grant_type=password`, {
        statusCode: 401,
        body: {
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
          msg: 'Incorrect password. Please try again.',
        },
      }).as('failedAuth');

      // Navigate to login
      cy.log('[STEP 1] Navigating to login page');
      visitLoginPage();

      // Enter email and go to password page
      cy.log('[STEP 2] Entering email and navigating to password page');
      goToPasswordStep(testEmail);

      // Enter wrong password
      cy.log('[STEP 3] Entering incorrect password');
      AuthSelectors.passwordInput().type(wrongPassword);
      AuthSelectors.passwordSubmitButton().click();

      // Wait for failed API call
      cy.log('[STEP 4] Waiting for authentication to fail');
      cy.wait('@failedAuth');

      // Verify error message is displayed
      cy.log('[STEP 5] Verifying error message is displayed');
      cy.contains('Invalid login credentials').should('be.visible');

      // Verify still on password page
      cy.log('[STEP 6] Verifying still on password page');
      cy.url().should('include', 'action=enterPassword');

      cy.log('[STEP 7] Incorrect password test completed successfully');
    });

    it('should handle network errors gracefully', () => {
      const testEmail = 'network-error@appflowy.io';
      const testPassword = 'TestPassword123!';

      cy.log(`[TEST START] Testing network error handling`);

      // Mock network error
      cy.intercept('POST', `${gotrueUrl}/token?grant_type=password`, {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
        },
      }).as('networkError');

      // Navigate to login
      cy.log('[STEP 1] Navigating to login page');
      visitLoginPage();

      // Enter credentials
      cy.log('[STEP 2] Entering email and navigating to password page');
      goToPasswordStep(testEmail);

      // Enter password and submit
      cy.log('[STEP 3] Entering password and submitting');
      AuthSelectors.passwordInput().type(testPassword);
      AuthSelectors.passwordSubmitButton().click();

      // Wait for network error
      cy.log('[STEP 4] Waiting for network error');
      cy.wait('@networkError');

      // Verify error handling
      cy.log('[STEP 5] Verifying error is handled gracefully');
      cy.url().should('include', 'action=enterPassword');

      // Verify user can retry
      cy.log('[STEP 6] Verifying retry is possible');
      AuthSelectors.passwordInput().should('be.visible');
      AuthSelectors.passwordSubmitButton().should('be.visible');

      cy.log('[STEP 7] Network error test completed successfully');
    });
  });

  describe('Login Flow Navigation', () => {
    it('should navigate between login steps correctly', () => {
      const testEmail = 'navigation-test@appflowy.io';

      cy.log(`[TEST START] Testing login flow navigation`);

      // Visit login page
      cy.log('[STEP 1] Visiting login page');
      visitLoginPage();

      // Enter email
      cy.log('[STEP 2] Entering email');
      goToPasswordStep(testEmail);

      // Verify on password page
      cy.log('[STEP 4] Verifying on password page');
      cy.url().should('include', 'action=enterPassword');
      cy.contains('Enter password').should('be.visible');

      // Navigate back to login
      cy.log('[STEP 5] Navigating back to login page');
      cy.contains('Back to login').click();
      cy.wait(1000);

      // Verify back on main login page
      cy.log('[STEP 6] Verifying back on main login page');
      cy.url().should('not.include', 'action=');
      AuthSelectors.emailInput().should('be.visible');

      cy.log('[STEP 7] Navigation test completed successfully');
    });
  });
});
