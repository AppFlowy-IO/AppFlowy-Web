import { testLog } from './test-helpers';
/// <reference types="cypress" />

export interface AuthConfig {
  baseUrl: string;
  gotrueUrl: string;
  adminEmail: string;
  adminPassword: string;
}

/**
 * E2E test utility for authentication with GoTrue admin
 */
export class AuthTestUtils {
  private config: AuthConfig;
  private adminAccessToken?: string;

  constructor(config?: Partial<AuthConfig>) {
    // Use APPFLOWY_GOTRUE_BASE_URL from environment if available, otherwise construct from APPFLOWY_BASE_URL
    const baseUrl = config?.baseUrl || Cypress.env('APPFLOWY_BASE_URL') || 'http://localhost';
    const gotrueUrl = config?.gotrueUrl || Cypress.env('APPFLOWY_GOTRUE_BASE_URL') || `http://localhost/gotrue`;

    this.config = {
      baseUrl: baseUrl,
      gotrueUrl: gotrueUrl,
      adminEmail: config?.adminEmail || Cypress.env('GOTRUE_ADMIN_EMAIL') || 'admin@example.com',
      adminPassword: config?.adminPassword || Cypress.env('GOTRUE_ADMIN_PASSWORD') || 'password',
    };
  }

  /**
   * Sign in as admin user to get access token
   */
  signInAsAdmin(): Cypress.Chainable<string> {
    if (this.adminAccessToken) {
      return cy.wrap(this.adminAccessToken);
    }

    // Try to sign in with existing admin account
    const url = `${this.config.gotrueUrl}/token?grant_type=password`;

    return cy.request({
      method: 'POST',
      url: url,
      body: {
        email: this.config.adminEmail,
        password: this.config.adminPassword,
      },
      headers: {
        'Content-Type': 'application/json',
      },
      failOnStatusCode: false,
    }).then((response): string => {
      if (response.status === 200) {
        this.adminAccessToken = response.body.access_token as string;
        return this.adminAccessToken as string;
      }
      throw new Error(`Failed to sign in as admin: ${response.status} - ${JSON.stringify(response.body)}`);
    });
  }

  /**
   * Generate a sign-in action link for a specific email
   * Similar to admin_generate_link in Rust
   */
  generateSignInActionLink(email: string): Cypress.Chainable<string> {
    return this.signInAsAdmin().then((adminToken) => {
      return cy.request({
        method: 'POST',
        url: `${this.config.gotrueUrl}/admin/generate_link`,
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: {
          email: email,
          type: 'magiclink',
          redirect_to: Cypress.config('baseUrl'),
        },
      }).then((response) => {
        if (response.status !== 200) {
          throw new Error(`Failed to generate action link: ${response.status}`);
        }
        return response.body.action_link;
      });
    });
  }

  /**
   * Extract sign-in URL from action link HTML
   * Similar to extract_sign_in_url in Rust
   */
  extractSignInUrl(actionLink: string): Cypress.Chainable<string> {
    return cy.request({
      method: 'GET',
      url: actionLink,
      followRedirect: false, // Don't follow redirects automatically
      failOnStatusCode: false, // Don't fail on non-2xx status
    }).then((response) => {
      // Check if we got a redirect (3xx status)
      if (response.status >= 300 && response.status < 400) {
        const locationHeader = (response.headers['location'] || response.headers['Location']) as string | string[] | undefined;
        const locationStr = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
        if (locationStr) {
          // The redirect location contains the sign-in URL with tokens
          // It's in the format: http://localhost:9999/appflowy_web://#access_token=...
          // We need to extract the part after the host (appflowy_web://...)

          // Parse the redirect URL
          const redirectUrl = new URL(locationStr as string, actionLink);
          // The path contains the actual redirect URL (appflowy_web://)
          const pathWithoutSlash = redirectUrl.pathname.substring(1); // Remove leading /
          const signInUrl = pathWithoutSlash + redirectUrl.hash;

          return signInUrl;
        }
      }

      // If no redirect, try to parse HTML for an anchor tag
      const html = response.body;

      // Use regex to extract href from the first anchor tag
      const hrefMatch = html.match(/<a[^>]*href=["']([^"']+)["']/);

      if (!hrefMatch || !hrefMatch[1]) {
        throw new Error('Could not extract sign-in URL from action link');
      }

      const signInUrl = hrefMatch[1];

      // Decode HTML entities if present (e.g., &amp; -> &)
      const decodedUrl = signInUrl.replace(/&amp;/g, '&');

      return decodedUrl;
    });
  }

  /**
   * Generate a complete sign-in URL for a user email
   * Combines generateSignInActionLink and extractSignInUrl
   */
  generateSignInUrl(email: string): Cypress.Chainable<string> {
    return this.generateSignInActionLink(email).then((actionLink) => {
      return this.extractSignInUrl(actionLink);
    });
  }

  /**
   * Sign in a user using the generated sign-in URL
   * Replicates the logic from APIService.signInWithUrl
   */
  signInWithTestUrl(email: string): Cypress.Chainable<any> {
    return this.generateSignInUrl(email).then((callbackLink) => {
      // Replicate signInWithUrl logic from http_api.ts
      // Extract hash from the callback link
      const hashIndex = callbackLink.indexOf('#');
      if (hashIndex === -1) {
        throw new Error('No hash found in callback link');
      }

      const hash = callbackLink.substring(hashIndex);
      const params = new URLSearchParams(hash.slice(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (!accessToken || !refreshToken) {
        throw new Error('No access token or refresh token found');
      }

      // First, we need to call the verify endpoint to create the user profile
      // This endpoint creates the user in the AppFlowy backend
      testLog.info( 'Calling verify endpoint to create user profile');
      
      // Make the verify call with retry logic for CI environment
      const verifyWithRetry = (retries = 3): Cypress.Chainable<any> => {
        return cy.request({
          method: 'GET',
          url: `${this.config.baseUrl}/api/user/verify/${accessToken}`,
          failOnStatusCode: false,
          timeout: 30000,
        }).then((verifyResponse) => {
          testLog.info( `Verify response status: ${verifyResponse.status}`);
          
          // If we get a 502 or 503 error, retry
          if ((verifyResponse.status === 502 || verifyResponse.status === 503) && retries > 0) {
            testLog.info( `Retrying verify endpoint, ${retries} attempts remaining`);
            return cy.wait(2000).then(() => verifyWithRetry(retries - 1));
          }
          
          return cy.wrap(verifyResponse);
        });
      };
      
      return verifyWithRetry().then((verifyResponse) => {
        
        // Now refresh the token to get session data
        return cy.request({
          method: 'POST',
          url: `${this.config.gotrueUrl}/token?grant_type=refresh_token`,
          body: {
            refresh_token: refreshToken,
          },
          headers: {
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
        }).then((response) => {
          if (response.status !== 200) {
            throw new Error(`Failed to refresh token: ${response.status}`);
          }

          // Store the tokens in localStorage as the app expects
          const tokenData = response.body;
          
          return cy.window().then((win) => {
            // Store the auth data in localStorage
            win.localStorage.setItem('af_auth_token', tokenData.access_token);
            win.localStorage.setItem('af_refresh_token', tokenData.refresh_token || refreshToken);
            if (tokenData.user) {
              win.localStorage.setItem('af_user_id', tokenData.user.id);
            }
            
            // Also store as 'token' for compatibility
            win.localStorage.setItem('token', JSON.stringify(tokenData));

            // Navigate directly to the app
            cy.visit('/app');

            // Wait for the app to initialize
            cy.wait(5000);

            // Verify we're logged in and on the app page
            cy.url().should('not.include', '/login');
            cy.url().should('include', '/app');
          }).then(() => undefined);
        });
      });
    });
  }
}

/**
 * Cypress command to sign in a test user
 */
export function signInTestUser(email: string = 'test@example.com'): Cypress.Chainable {
  const authUtils = new AuthTestUtils();
  return authUtils.signInWithTestUrl(email);
}

// Add custom Cypress commands
declare global {
  namespace Cypress {
    interface Chainable {
      signIn(email?: string): Chainable<any>;
      generateSignInUrl(email: string): Chainable<string>;
    }
  }
}

// Register the commands
Cypress.Commands.add('signIn', (email: string = 'test@example.com') => {
  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(1000);
  const authUtils = new AuthTestUtils();
  return authUtils.signInWithTestUrl(email);
});

Cypress.Commands.add('generateSignInUrl', (email: string) => {
  const authUtils = new AuthTestUtils();
  return authUtils.generateSignInUrl(email);
});
