import { Page, APIRequestContext } from '@playwright/test';
import { TestConfig } from './test-config';

/**
 * E2E test utility for authentication with GoTrue admin
 * Migrated from: cypress/support/auth-utils.ts
 */

export interface AuthConfig {
  baseUrl: string;
  gotrueUrl: string;
  adminEmail: string;
  adminPassword: string;
}

export class AuthTestUtils {
  private config: AuthConfig;
  private adminAccessToken?: string;

  constructor(config?: Partial<AuthConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || TestConfig.apiUrl,
      gotrueUrl: config?.gotrueUrl || TestConfig.gotrueUrl,
      adminEmail: config?.adminEmail || TestConfig.adminEmail,
      adminPassword: config?.adminPassword || TestConfig.adminPassword,
    };
  }

  /**
   * Sign in as admin user to get access token
   */
  async signInAsAdmin(request: APIRequestContext): Promise<string> {
    if (this.adminAccessToken) {
      return this.adminAccessToken;
    }

    const url = `${this.config.gotrueUrl}/token?grant_type=password`;

    const response = await request.post(url, {
      data: {
        email: this.config.adminEmail,
        password: this.config.adminPassword,
      },
      headers: {
        'Content-Type': 'application/json',
      },
      failOnStatusCode: false,
    });

    if (response.ok()) {
      const body = await response.json();
      this.adminAccessToken = body.access_token;
      return this.adminAccessToken!;
    }

    throw new Error(`Failed to sign in as admin: ${response.status()} - ${await response.text()}`);
  }

  /**
   * Generate a sign-in action link for a specific email
   */
  async generateActionLink(
    request: APIRequestContext,
    email: string,
    type: 'magiclink' | 'signup' = 'magiclink'
  ): Promise<string> {
    const adminToken = await this.signInAsAdmin(request);

    const response = await request.post(`${this.config.gotrueUrl}/admin/generate_link`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        email,
        type,
        redirect_to: TestConfig.baseUrl,
      },
    });

    if (!response.ok()) {
      throw new Error(`Failed to generate action link: ${response.status()}`);
    }

    const body = await response.json();
    return body.action_link;
  }

  /**
   * Extract sign-in URL from action link
   */
  async extractSignInUrl(request: APIRequestContext, actionLink: string): Promise<string> {
    // GoTrue generates action links using API_EXTERNAL_URL (e.g. http://localhost:9999).
    // When the GoTrue API is called through an nginx proxy (e.g. /gotrue/admin/generate_link),
    // GoTrue prepends the request path prefix to the generated URL, producing URLs like
    // http://localhost:9999/gotrue/verify?... which don't work because GoTrue at :9999
    // doesn't know about the /gotrue prefix. Rewrite the URL to go through the proxy.
    let normalizedLink = actionLink;
    const gotrueUrl = this.config.gotrueUrl; // e.g. http://localhost:3000/gotrue
    try {
      const actionUrl = new URL(actionLink);
      // If the action link host:port differs from our gotrueUrl, rewrite it
      const gotrueUrlObj = new URL(gotrueUrl);
      if (actionUrl.host !== gotrueUrlObj.host) {
        // Replace the origin with gotrueUrl origin and prepend the proxy path prefix.
        // e.g. gotrueUrl = http://localhost:3000/gotrue => prefix = /gotrue
        // action link = http://localhost:9999/verify?token=...
        // normalized  = http://localhost:3000/gotrue/verify?token=...
        // If GoTrue already included the prefix in the path (e.g. /gotrue/verify),
        // don't duplicate it.
        const proxyPrefix = gotrueUrlObj.pathname.replace(/\/+$/, ''); // e.g. "/gotrue"
        const pathAlreadyPrefixed = proxyPrefix && actionUrl.pathname.startsWith(proxyPrefix);
        normalizedLink = gotrueUrlObj.origin + (pathAlreadyPrefixed ? '' : proxyPrefix) + actionUrl.pathname + actionUrl.search;
      }
    } catch {
      // If URL parsing fails, use as-is
    }

    const response = await request.get(normalizedLink, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    const status = response.status();

    // Check if we got a redirect (3xx status)
    if (status >= 300 && status < 400) {
      const locationHeader = response.headers()['location'];
      if (locationHeader) {
        const redirectUrl = new URL(locationHeader, actionLink);
        const pathWithoutSlash = redirectUrl.pathname.substring(1);
        return pathWithoutSlash + redirectUrl.hash;
      }
    }

    // If the response was followed automatically (200), check for tokens in the final URL
    const responseUrl = response.url();
    if (responseUrl && responseUrl.includes('access_token')) {
      const url = new URL(responseUrl);
      const pathWithoutSlash = url.pathname.substring(1);
      return pathWithoutSlash + url.hash;
    }

    // If no redirect, try to parse HTML for an anchor tag
    const html = await response.text();
    const hrefMatch = html.match(/<a[^>]*href=["']([^"']+)["']/);

    if (!hrefMatch || !hrefMatch[1]) {
      throw new Error(
        `Could not extract sign-in URL from action link. Status: ${status}, URL: ${responseUrl}, Body length: ${html.length}, Body preview: ${html.substring(0, 200)}`
      );
    }

    return hrefMatch[1].replace(/&amp;/g, '&');
  }

  /**
   * Generate a complete sign-in URL for a user email
   */
  async generateSignInUrl(request: APIRequestContext, email: string): Promise<string> {
    const actionLink = await this.generateActionLink(request, email);
    return this.extractSignInUrl(request, actionLink);
  }

  /**
   * Sign in a user and set up the browser session
   */
  async signInWithTestUrl(page: Page, request: APIRequestContext, email: string): Promise<void> {
    const callbackLink = await this.generateSignInUrl(request, email);

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

    // Call the verify endpoint to create the user profile
    console.log('Calling verify endpoint to create user profile');

    let verifyResponse: any;
    for (let retries = 3; retries > 0; retries--) {
      verifyResponse = await request.get(`${this.config.baseUrl}/api/user/verify/${accessToken}`, {
        failOnStatusCode: false,
        timeout: 30000,
      });

      console.log(`Verify response status: ${verifyResponse.status()}`);

      if (verifyResponse.status() !== 502 && verifyResponse.status() !== 503) {
        break;
      }

      if (retries > 1) {
        console.log(`Retrying verify endpoint, ${retries - 1} attempts remaining`);
        await page.waitForTimeout(2000);
      }
    }

    // Refresh the token to get session data
    const tokenResponse = await request.post(`${this.config.gotrueUrl}/token?grant_type=refresh_token`, {
      data: { refresh_token: refreshToken },
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    });

    if (!tokenResponse.ok()) {
      throw new Error(`Failed to refresh token: ${tokenResponse.status()}`);
    }

    const tokenData = await tokenResponse.json();

    // Store the tokens in localStorage
    await page.evaluate(
      ({ tokenData, refreshToken }) => {
        localStorage.setItem('af_auth_token', tokenData.access_token);
        localStorage.setItem('af_refresh_token', tokenData.refresh_token || refreshToken);
        if (tokenData.user) {
          localStorage.setItem('af_user_id', tokenData.user.id);
        }
        localStorage.setItem('token', JSON.stringify(tokenData));
      },
      { tokenData, refreshToken }
    );

    // Navigate to the app
    await page.goto('/app');

    // Wait for the app to initialize
    await page.waitForTimeout(5000);

    // Verify we're logged in
    await page.waitForURL(/\/app/, { timeout: 15000 });
  }
}

/**
 * Convenience function to sign in a test user
 */
export async function signInTestUser(
  page: Page,
  request: APIRequestContext,
  email: string = 'test@example.com'
): Promise<void> {
  const authUtils = new AuthTestUtils();
  await authUtils.signInWithTestUrl(page, request, email);
}

/**
 * Create a user account without signing in via the browser.
 * Uses GoTrue admin generate_link to create the user, then calls
 * the verify endpoint to ensure the user profile exists.
 */
export async function createUserAccount(
  request: APIRequestContext,
  email: string
): Promise<void> {
  const authUtils = new AuthTestUtils();
  const callbackLink = await authUtils.generateSignInUrl(request, email);

  const hashIndex = callbackLink.indexOf('#');
  if (hashIndex === -1) return;

  const hash = callbackLink.substring(hashIndex);
  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');

  if (!accessToken) return;

  // Call verify endpoint to create the user profile in the backend
  await request.get(`${TestConfig.apiUrl}/api/user/verify/${accessToken}`, {
    failOnStatusCode: false,
    timeout: 30000,
  });
}

export async function createConfirmedPasswordUser(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<void> {
  const response = await request.post(`${TestConfig.gotrueUrl}/signup`, {
    data: {
      email,
      password,
    },
    headers: {
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
  });

  if (!response.ok()) {
    throw new Error(`Failed to sign up password user: ${response.status()} - ${await response.text()}`);
  }

  const body = await response.json();

  if (body?.confirmation_sent_at && !body?.access_token) {
    const authUtils = new AuthTestUtils();
    const actionLink = await authUtils.generateActionLink(request, email, 'signup');
    await authUtils.extractSignInUrl(request, actionLink);
  }
}
