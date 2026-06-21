import { expect, Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import { AuthSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before } = createBdd();

type SignInMethod = 'password' | 'email OTP' | 'OAuth callback';

type MockLoginState = {
  method: SignInMethod;
  email: string;
  password: string;
  otpCode: string;
  userId: string;
  workspaceId: string;
  initialAccessToken: string;
  initialRefreshToken: string;
  refreshedAccessToken: string;
  refreshedRefreshToken: string;
  verifiedAccessTokens: string[];
  refreshTokenRequests: Array<{ refresh_token?: string }>;
};

const loginStateByPage = new WeakMap<Page, MockLoginState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1280, height: 720 });
});

Given('mocked AppFlowy auth APIs are configured for {string} sign in', async ({ page }, methodValue: string) => {
  const method = parseSignInMethod(methodValue);
  const state = createMockLoginState(method);

  loginStateByPage.set(page, state);
  await mockAuthProviders(page);
  await mockCompletedSessionApis(page, state);
  await mockGoTrueSignInApis(page, state);
});

When('I complete {string} sign in', async ({ page }, methodValue: string) => {
  const method = parseSignInMethod(methodValue);
  const state = getLoginState(page, method);

  switch (method) {
    case 'password':
      await completePasswordSignIn(page, state);
      break;
    case 'email OTP':
      await completeEmailOtpSignIn(page, state);
      break;
    case 'OAuth callback':
      await completeOAuthCallbackSignIn(page, state);
      break;
  }
});

Then('I am redirected to the app', async ({ page }) => {
  await expect(page).toHaveURL(/\/app(?:\/|$)/, { timeout: 15000 });
});

Then('the saved auth token is the refreshed token for {string} sign in', async ({ page }, methodValue: string) => {
  const method = parseSignInMethod(methodValue);
  const state = getLoginState(page, method);
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('token');

    return raw ? JSON.parse(raw) as { access_token?: string; refresh_token?: string; user?: { id?: string; email?: string } } : null;
  });

  expect(state.verifiedAccessTokens).toEqual([state.initialAccessToken]);
  expect(state.refreshTokenRequests).toEqual([{ refresh_token: state.initialRefreshToken }]);
  expect(token?.access_token).toBe(state.refreshedAccessToken);
  expect(token?.refresh_token).toBe(state.refreshedRefreshToken);
  expect(token?.user?.id).toBe(state.userId);
  expect(token?.user?.email).toBe(state.email);
});

function parseSignInMethod(value: string): SignInMethod {
  if (value === 'password' || value === 'email OTP' || value === 'OAuth callback') {
    return value;
  }

  throw new Error(`Unsupported sign-in method: ${value}`);
}

function getLoginState(page: Page, method: SignInMethod): MockLoginState {
  const state = loginStateByPage.get(page);

  if (!state) {
    throw new Error('Mock login state has not been configured');
  }

  if (state.method !== method) {
    throw new Error(`Expected mock login method ${state.method}, got ${method}`);
  }

  return state;
}

function createMockLoginState(method: SignInMethod): MockLoginState {
  const email = generateRandomEmail();
  const userId = uuidv4();

  return {
    method,
    email,
    password: 'SecurePassword123!',
    otpCode: '123456',
    userId,
    workspaceId: uuidv4(),
    initialAccessToken: `${methodTokenPrefix(method)}-initial-access-${uuidv4()}`,
    initialRefreshToken: `${methodTokenPrefix(method)}-initial-refresh-${uuidv4()}`,
    refreshedAccessToken: `${methodTokenPrefix(method)}-refreshed-access-${uuidv4()}`,
    refreshedRefreshToken: `${methodTokenPrefix(method)}-refreshed-refresh-${uuidv4()}`,
    verifiedAccessTokens: [],
    refreshTokenRequests: [],
  };
}

function methodTokenPrefix(method: SignInMethod) {
  return method.toLowerCase().replace(/\s+/g, '-');
}

async function mockAuthProviders(page: Page) {
  await page.route('**/api/server-info/auth-providers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          count: 3,
          providers: ['email', 'password', 'google'],
          signup_disabled: false,
          mailer_autoconfirm: true,
        },
        message: 'success',
      }),
    })
  );
}

async function mockCompletedSessionApis(page: Page, state: MockLoginState) {
  await page.route('**/api/user/verify/**', (route) => {
    state.verifiedAccessTokens.push(decodeURIComponent(route.request().url().split('/api/user/verify/')[1] || ''));

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: { is_new: false },
        message: 'success',
      }),
    });
  });

  await page.route(/\/api\/user\/profile(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          uid: 1,
          uuid: state.userId,
          email: state.email,
          name: 'Mock User',
          metadata: { timezone: { default_timezone: 'UTC', timezone: 'UTC' } },
          encryption_sign: null,
          latest_workspace_id: state.workspaceId,
          updated_at: Date.now(),
        },
        message: 'success',
      }),
    })
  );

  await page.route(/\/api\/user\/workspace(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          user_profile: { uuid: state.userId },
          visiting_workspace: createWorkspacePayload(state.workspaceId),
          workspaces: [createWorkspacePayload(state.workspaceId)],
        },
        message: 'success',
      }),
    })
  );

  await page.route(/\/api\/server-info(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: { enable_page_history: true, ai_enabled: false },
        message: 'success',
      }),
    })
  );
}

async function mockGoTrueSignInApis(page: Page, state: MockLoginState) {
  await page.route(/\/token\?grant_type=password$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createGoTrueToken(state, 'initial')),
    })
  );

  await page.route(/\/verify$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createGoTrueToken(state, 'initial')),
    })
  );

  await page.route(/\/magiclink$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );

  await page.route(/\/token\?grant_type=refresh_token$/, async (route) => {
    state.refreshTokenRequests.push(readPostData(route));

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createGoTrueToken(state, 'refreshed')),
    });
  });
}

async function completePasswordSignIn(page: Page, state: MockLoginState) {
  await page.goto(`/login?redirectTo=${encodeURIComponent('/app')}`, { waitUntil: 'domcontentloaded' });
  await expect(AuthSelectors.emailInput(page)).toBeVisible();
  await AuthSelectors.emailInput(page).fill(state.email);
  await AuthSelectors.passwordSignInButton(page).click();
  await expect(page).toHaveURL(/action=enterPassword/);
  await AuthSelectors.passwordInput(page).fill(state.password);

  const refreshResponse = page.waitForResponse(/\/token\?grant_type=refresh_token$/);

  await AuthSelectors.passwordSubmitButton(page).click();
  await refreshResponse;
}

async function completeEmailOtpSignIn(page: Page, state: MockLoginState) {
  await page.goto(`/login?redirectTo=${encodeURIComponent('/app')}`, { waitUntil: 'domcontentloaded' });
  await expect(AuthSelectors.emailInput(page)).toBeVisible();
  await AuthSelectors.emailInput(page).fill(state.email);

  const magicLinkResponse = page.waitForResponse(/\/magiclink$/);

  await AuthSelectors.magicLinkButton(page).click();
  await magicLinkResponse;
  await expect(page).toHaveURL(/action=checkEmail/);
  await AuthSelectors.enterCodeManuallyButton(page).click();
  await AuthSelectors.otpCodeInput(page).fill(state.otpCode);

  const refreshResponse = page.waitForResponse(/\/token\?grant_type=refresh_token$/);

  await AuthSelectors.otpSubmitButton(page).click();
  await refreshResponse;
}

async function completeOAuthCallbackSignIn(page: Page, state: MockLoginState) {
  const refreshResponse = page.waitForResponse(/\/token\?grant_type=refresh_token$/);

  await page.goto(
    `/auth/callback#access_token=${encodeURIComponent(state.initialAccessToken)}&refresh_token=${encodeURIComponent(state.initialRefreshToken)}`,
    { waitUntil: 'domcontentloaded' }
  );
  await refreshResponse;
}

function createGoTrueToken(state: MockLoginState, variant: 'initial' | 'refreshed') {
  return {
    access_token: variant === 'initial' ? state.initialAccessToken : state.refreshedAccessToken,
    refresh_token: variant === 'initial' ? state.initialRefreshToken : state.refreshedRefreshToken,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: state.userId,
      email: state.email,
    },
  };
}

function createWorkspacePayload(workspaceId: string) {
  return {
    workspace_id: workspaceId,
    owner_uid: 1,
    owner_name: 'Mock User',
    workspace_name: 'Mock Workspace',
    icon: '',
    created_at: new Date().toISOString(),
    member_count: 1,
    database_storage_id: uuidv4(),
  };
}

function readPostData(route: Route) {
  try {
    return route.request().postDataJSON() as { refresh_token?: string };
  } catch {
    return {};
  }
}
