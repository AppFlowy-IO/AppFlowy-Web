import { v4 as uuidv4 } from 'uuid';
import { TestConfig, generateRandomEmail } from '../../support/test-config';
import { visitAuthPath, visitLoginPage } from '../../support/auth-flow-helpers';

/**
 * Sign Up Password selectors - using flexible selectors with fallbacks
 */
const SignUpSelectors = {
  emailInput: (options?: Partial<Cypress.Loggable & Cypress.Timeoutable>) =>
    cy.get('[data-testid="signup-email-input"], input[placeholder*="email" i]', { timeout: 10000, ...options }).first(),
  passwordInput: (options?: Partial<Cypress.Loggable & Cypress.Timeoutable>) =>
    cy.get('[data-testid="signup-password-input"], input[type="password"]', { timeout: 10000, ...options }).first(),
  confirmPasswordInput: (options?: Partial<Cypress.Loggable & Cypress.Timeoutable>) =>
    cy.get('[data-testid="signup-confirm-password-input"], input[type="password"]', { timeout: 10000, ...options }).last(),
  submitButton: (options?: Partial<Cypress.Loggable & Cypress.Timeoutable>) =>
    cy.get('[data-testid="signup-submit-button"], button:contains("Sign Up")', { timeout: 10000, ...options }).first(),
  backToLoginButton: (options?: Partial<Cypress.Loggable & Cypress.Timeoutable>) =>
    cy.get('[data-testid="signup-back-to-login-button"]', { timeout: 10000, ...options }),
  createAccountButton: (options?: Partial<Cypress.Loggable & Cypress.Timeoutable>) =>
    cy.get('[data-testid="login-create-account-button"]', { timeout: 10000, ...options }),
};

describe('Password Sign Up Flow', () => {
  const { gotrueUrl } = TestConfig;

  const visitSignUpPage = () => {
    visitAuthPath('/login?action=signUpPassword', { waitMs: 0 });
    SignUpSelectors.emailInput().should('be.visible');
  };

  beforeEach(() => {
    // Handle uncaught exceptions
    cy.on('uncaught:exception', () => false);
    cy.viewport(1280, 720);
  });

  describe('Sign Up Page Elements', () => {
    it('should display sign-up page elements correctly', () => {
      cy.log('[TEST START] Testing sign-up page elements');

      // Visit sign-up page directly
      visitSignUpPage();

      // Check for email input
      cy.log('[STEP 1] Checking for email input');
      SignUpSelectors.emailInput().should('be.visible');

      // Check for password inputs
      cy.log('[STEP 2] Checking for password inputs');
      SignUpSelectors.passwordInput().should('be.visible');
      SignUpSelectors.confirmPasswordInput().should('be.visible');

      // Check for submit button (should be disabled initially)
      cy.log('[STEP 3] Checking for submit button');
      SignUpSelectors.submitButton().should('be.visible').should('be.disabled');

      // Check for "Already have an account? Login" link
      cy.log('[STEP 4] Checking for back to login link');
      SignUpSelectors.backToLoginButton().should('be.visible');

      cy.log('[STEP 5] Test completed - Sign up page loaded successfully');
    });

    it('should navigate from login page to sign-up page', () => {
      cy.log('[TEST START] Testing navigation from login to sign-up');

      // Visit login page
      visitLoginPage(0);

      // Check for "Create account" link on login page
      cy.log('[STEP 1] Checking for Create account link');
      SignUpSelectors.createAccountButton().should('be.visible');

      // Click on Create account
      cy.log('[STEP 2] Clicking Create account button');
      SignUpSelectors.createAccountButton().click();

      // Verify navigation to sign-up page
      cy.log('[STEP 3] Verifying navigation to sign-up page');
      cy.url().should('include', 'action=signUpPassword');
      SignUpSelectors.emailInput().should('be.visible');

      cy.log('[STEP 4] Test completed - Navigation successful');
    });

    it('should navigate back to login page from sign-up page', () => {
      cy.log('[TEST START] Testing navigation back to login');

      // Visit sign-up page
      visitSignUpPage();

      // Click on Login link
      cy.log('[STEP 1] Clicking Login button');
      SignUpSelectors.backToLoginButton().click();

      // Verify navigation to login page
      cy.log('[STEP 2] Verifying navigation to login page');
      cy.url().should('not.include', 'action=signUpPassword');
      SignUpSelectors.createAccountButton().should('be.visible');

      cy.log('[STEP 3] Test completed - Navigation successful');
    });
  });

  describe('Form Validation', () => {
    it('should show error for invalid email format', () => {
      const invalidEmail = 'not-an-email';

      cy.log('[TEST START] Testing invalid email validation');

      // Visit sign-up page
      visitSignUpPage();

      // Enter invalid email
      cy.log('[STEP 1] Entering invalid email');
      SignUpSelectors.emailInput().type(invalidEmail);

      // Enter valid password
      cy.log('[STEP 2] Entering valid password');
      SignUpSelectors.passwordInput().type('ValidPass1!');
      SignUpSelectors.confirmPasswordInput().type('ValidPass1!');

      // Button should still be disabled due to invalid email validation on submit
      cy.log('[STEP 3] Verifying form validation');
      // Force click to trigger validation
      SignUpSelectors.submitButton().click({ force: true });

      // Check for error message
      cy.log('[STEP 4] Checking for validation error');
      cy.contains('Please enter a valid email address').should('be.visible');

      cy.log('[STEP 5] Test completed - Email validation working');
    });

    it('should show error for weak password - missing uppercase', () => {
      const testEmail = generateRandomEmail();

      cy.log('[TEST START] Testing password validation - missing uppercase');

      // Visit sign-up page
      visitSignUpPage();

      // Enter valid email
      cy.log('[STEP 1] Entering valid email');
      SignUpSelectors.emailInput().type(testEmail);

      // Enter password without uppercase
      cy.log('[STEP 2] Entering password without uppercase');
      SignUpSelectors.passwordInput().type('weakpass1!');
      SignUpSelectors.passwordInput().blur();

      // Check for error message
      cy.log('[STEP 3] Checking for password error');
      cy.contains(/uppercase/i).should('be.visible');

      cy.log('[STEP 4] Test completed - Password uppercase validation working');
    });

    it('should show error for weak password - missing special character', () => {
      const testEmail = generateRandomEmail();

      cy.log('[TEST START] Testing password validation - missing special char');

      // Visit sign-up page
      visitSignUpPage();

      // Enter valid email
      cy.log('[STEP 1] Entering valid email');
      SignUpSelectors.emailInput().type(testEmail);

      // Enter password without special character
      cy.log('[STEP 2] Entering password without special character');
      SignUpSelectors.passwordInput().type('WeakPass1');
      SignUpSelectors.passwordInput().blur();

      // Check for error message
      cy.log('[STEP 3] Checking for password error');
      cy.contains(/special/i).should('be.visible');

      cy.log('[STEP 4] Test completed - Password special char validation working');
    });

    it('should show error for password too short', () => {
      const testEmail = generateRandomEmail();

      cy.log('[TEST START] Testing password validation - too short');

      // Visit sign-up page
      visitSignUpPage();

      // Enter valid email
      cy.log('[STEP 1] Entering valid email');
      SignUpSelectors.emailInput().type(testEmail);

      // Enter short password
      cy.log('[STEP 2] Entering short password');
      SignUpSelectors.passwordInput().type('Ab1!');
      SignUpSelectors.passwordInput().blur();

      // Check for error message
      cy.log('[STEP 3] Checking for password length error');
      cy.contains(/6 characters/i).should('be.visible');

      cy.log('[STEP 4] Test completed - Password length validation working');
    });

    it('should show error when passwords do not match', () => {
      const testEmail = generateRandomEmail();
      const password = 'ValidPass1!';
      const differentPassword = 'DifferentPass1!';

      cy.log('[TEST START] Testing password match validation');

      // Visit sign-up page
      visitSignUpPage();

      // Enter valid email
      cy.log('[STEP 1] Entering valid email');
      SignUpSelectors.emailInput().type(testEmail);

      // Enter password
      cy.log('[STEP 2] Entering password');
      SignUpSelectors.passwordInput().type(password);

      // Enter different confirm password
      cy.log('[STEP 3] Entering different confirm password');
      SignUpSelectors.confirmPasswordInput().type(differentPassword);
      SignUpSelectors.confirmPasswordInput().blur();

      // Check for error message
      cy.log('[STEP 4] Checking for password match error');
      cy.contains(/match/i).should('be.visible');

      cy.log('[STEP 5] Test completed - Password match validation working');
    });

    it('should enable submit button when all fields are valid', () => {
      const testEmail = generateRandomEmail();
      const validPassword = 'ValidPass1!';

      cy.log('[TEST START] Testing form enables submit when valid');

      // Visit sign-up page
      visitSignUpPage();

      // Submit should be disabled initially
      cy.log('[STEP 1] Verifying submit is disabled initially');
      SignUpSelectors.submitButton().should('be.disabled');

      // Enter valid email
      cy.log('[STEP 2] Entering valid email');
      SignUpSelectors.emailInput().type(testEmail);

      // Enter valid password
      cy.log('[STEP 3] Entering valid password');
      SignUpSelectors.passwordInput().type(validPassword);

      // Enter matching confirm password
      cy.log('[STEP 4] Entering matching confirm password');
      SignUpSelectors.confirmPasswordInput().type(validPassword);

      // Submit should now be enabled
      cy.log('[STEP 5] Verifying submit is enabled');
      SignUpSelectors.submitButton().should('not.be.disabled');

      cy.log('[STEP 6] Test completed - Form validation working correctly');
    });
  });

  describe('Successful Sign Up', () => {
    const mockSuccessfulSignUp = (testEmail: string, mockUserId: string) => {
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();

      cy.intercept('POST', `${gotrueUrl}/signup`, {
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
      }).as('signUp');

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

      cy.intercept('POST', '**/api/user/update', {
        statusCode: 200,
        body: {
          code: 0,
          data: null,
          message: 'success',
        },
      }).as('updateUserProfile');

      cy.intercept('GET', '**/api/user/verify/**', {
        statusCode: 200,
        body: {
          code: 0,
          data: {
            is_new: true,
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
    };

    it('should successfully sign up with valid credentials', () => {
      const testEmail = generateRandomEmail();
      const validPassword = 'ValidPass1!';
      const mockUserId = uuidv4();

      cy.log(`[TEST START] Testing successful sign up with email: ${testEmail}`);

      mockSuccessfulSignUp(testEmail, mockUserId);

      // Visit sign-up page
      cy.log('[STEP 1] Visiting sign-up page');
      visitSignUpPage();

      // Enter valid email
      cy.log('[STEP 2] Entering email');
      SignUpSelectors.emailInput().type(testEmail);

      // Enter valid password
      cy.log('[STEP 3] Entering password');
      SignUpSelectors.passwordInput().type(validPassword);

      // Enter matching confirm password
      cy.log('[STEP 4] Entering confirm password');
      SignUpSelectors.confirmPasswordInput().type(validPassword);

      // Click submit
      cy.log('[STEP 5] Clicking submit button');
      SignUpSelectors.submitButton().should('not.be.disabled').click();

      // Wait for API call
      cy.log('[STEP 6] Waiting for sign-up API call');
      cy.wait('@signUp').then((interception) => {
        cy.log(`[API] Sign up response: ${JSON.stringify(interception.response?.body)}`);
        expect(interception.response?.statusCode).to.equal(200);
        expect(interception.request?.body).to.include({
          email: testEmail,
          password: validPassword,
        });
      });

      // Verify redirect to app
      cy.log('[STEP 7] Verifying redirect to app');
      cy.url({ timeout: 15000 }).should('match', /\/app(?:\?|$)/);

      cy.log('[STEP 8] Sign up test completed successfully');
    });
  });

  describe('Error Handling', () => {
    it('should handle email already registered error (422)', () => {
      const testEmail = 'existing@appflowy.io';
      const validPassword = 'ValidPass1!';

      cy.log('[TEST START] Testing email already registered error');

      // Mock the sign-up endpoint with 422 error
      cy.intercept('POST', `${gotrueUrl}/signup`, {
        statusCode: 422,
        body: {
          error: 'user_already_exists',
          error_description: 'User already registered',
          msg: 'This email is already registered',
        },
      }).as('signUpError');

      // Visit sign-up page
      cy.log('[STEP 1] Visiting sign-up page');
      visitSignUpPage();

      // Fill form
      cy.log('[STEP 2] Filling sign-up form');
      SignUpSelectors.emailInput().type(testEmail);
      SignUpSelectors.passwordInput().type(validPassword);
      SignUpSelectors.confirmPasswordInput().type(validPassword);

      // Submit
      cy.log('[STEP 3] Submitting form');
      SignUpSelectors.submitButton().click();

      // Wait for API error
      cy.log('[STEP 4] Waiting for error response');
      cy.wait('@signUpError');

      // Verify error message
      cy.log('[STEP 5] Verifying error message');
      cy.contains('already registered', { matchCase: false }).should('be.visible');

      // Verify still on sign-up page
      cy.log('[STEP 6] Verifying still on sign-up page');
      cy.url().should('include', 'action=signUpPassword');

      cy.log('[STEP 7] Test completed - Email exists error handled');
    });

    it('should handle rate limit error (429)', () => {
      const testEmail = generateRandomEmail();
      const validPassword = 'ValidPass1!';

      cy.log('[TEST START] Testing rate limit error');

      // Mock the sign-up endpoint with 429 error
      cy.intercept('POST', `${gotrueUrl}/signup`, {
        statusCode: 429,
        body: {
          error: 'rate_limit_exceeded',
          error_description: 'Too many requests',
          msg: 'Too many requests, please try again later.',
        },
      }).as('signUpRateLimit');

      // Visit sign-up page
      cy.log('[STEP 1] Visiting sign-up page');
      visitSignUpPage();

      // Fill form
      cy.log('[STEP 2] Filling sign-up form');
      SignUpSelectors.emailInput().type(testEmail);
      SignUpSelectors.passwordInput().type(validPassword);
      SignUpSelectors.confirmPasswordInput().type(validPassword);

      // Submit
      cy.log('[STEP 3] Submitting form');
      SignUpSelectors.submitButton().click();

      // Wait for API error
      cy.log('[STEP 4] Waiting for rate limit response');
      cy.wait('@signUpRateLimit');

      // Verify toast error message (rate limit shows as toast)
      cy.log('[STEP 5] Verifying toast error message');
      cy.contains('Too many requests', { matchCase: false, timeout: 5000 }).should('be.visible');

      cy.log('[STEP 6] Test completed - Rate limit error handled');
    });

    it('should handle network/server errors gracefully', () => {
      const testEmail = generateRandomEmail();
      const validPassword = 'ValidPass1!';

      cy.log('[TEST START] Testing network error handling');

      // Mock the sign-up endpoint with 500 error
      cy.intercept('POST', `${gotrueUrl}/signup`, {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
        },
      }).as('signUpNetworkError');

      // Visit sign-up page
      cy.log('[STEP 1] Visiting sign-up page');
      visitSignUpPage();

      // Fill form
      cy.log('[STEP 2] Filling sign-up form');
      SignUpSelectors.emailInput().type(testEmail);
      SignUpSelectors.passwordInput().type(validPassword);
      SignUpSelectors.confirmPasswordInput().type(validPassword);

      // Submit
      cy.log('[STEP 3] Submitting form');
      SignUpSelectors.submitButton().click();

      // Wait for API error
      cy.log('[STEP 4] Waiting for network error response');
      cy.wait('@signUpNetworkError');

      // Verify still on sign-up page (user can retry)
      cy.log('[STEP 5] Verifying still on sign-up page');
      cy.url().should('include', 'action=signUpPassword');

      // Verify form is still accessible for retry
      cy.log('[STEP 6] Verifying form is still accessible');
      SignUpSelectors.emailInput().should('be.visible');
      SignUpSelectors.submitButton().should('be.visible');

      cy.log('[STEP 7] Test completed - Network error handled gracefully');
    });
  });
});
