import { expect, Page, Route, test } from '@playwright/test';

const restriction = 'Signup is not allowed for this email address. Contact your administrator to request access.';
const restrictionMessage = 'Sign-up is not allowed for this email address. Contact your administrator to request access.';

// Exercise the production login route and callback. Only the Cloud/GoTrue
// boundaries are fixtures; these tests never create an account or a session.
async function mockServices(page: Page, catalog?: (route: Route) => Promise<void>) {
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());

    if (pathname === '/api/error-messages' && catalog) return catalog(route);
    if (pathname === '/api/server-info/auth-providers') {
      return route.fulfill({ json: { code: 0, data: { providers: ['google'] } } });
    }

    if (pathname === '/api/server-info') {
      return route.fulfill({ json: { code: 0, data: { version: '0.19.0', self_hosted: false } } });
    }

    return route.fulfill({ status: 404, json: { code: 404 } });
  });
  await page.route('**/gotrue/**', (route) => route.fulfill({ status: 503 }));
}

function callbackUrl(baseURL: string, description: string) {
  const url = new URL('/auth/callback', baseURL);

  url.hash = new URLSearchParams({ error: 'access_denied', error_code: '', error_description: description }).toString();
  return url.toString();
}

test('Google signup restriction explains how to request access and lets the user return to login', async ({ page }) => {
  await mockServices(page);
  await page.route('**/gotrue/authorize?**', async (route) => {
    const request = new URL(route.request().url());
    const redirect = new URL(request.searchParams.get('redirect_to')!);

    expect(request.searchParams.get('provider')).toBe('google');
    redirect.hash = new URLSearchParams({ error: 'access_denied', error_code: '', error_description: restriction }).toString();
    await route.fulfill({ status: 302, headers: { location: redirect.toString() } });
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  const dialog = page.getByRole('dialog');

  await expect(dialog.getByText(restrictionMessage, { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('Error -1');
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to Home' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('an open callback error updates when the server catalog finishes loading', async ({ page, baseURL }) => {
  const serverMessage = 'Your administrator needs to approve this email address before you can sign up.';
  let releaseCatalog!: () => void;
  const catalogReady = new Promise<void>((resolve) => { releaseCatalog = resolve; });

  await mockServices(page, async (route) => {
    await catalogReady;
    await route.fulfill({ json: { code: 0, data: {
      schema_version: 1, locale: 'en', reasons: { SIGN_UP_RESTRICTED: serverMessage }, codes: {},
    } } });
  });
  try {
    await page.goto(callbackUrl(baseURL!, restriction));
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByText(restrictionMessage, { exact: true })).toBeVisible();
    releaseCatalog();
    await expect(dialog.getByText(serverMessage, { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText('Error -1');
  } finally {
    releaseCatalog();
  }
});

test('unknown OAuth errors keep diagnostics out of the login dialog', async ({ page, baseURL }) => {
  const diagnostic = `${restriction} SQLSTATE 23505: /private/auth/secret`;

  await mockServices(page);
  await page.goto(callbackUrl(baseURL!, diagnostic));

  const dialog = page.getByRole('dialog');

  await expect(dialog).toContainText('Error -1: Something went wrong. Contact support if this keeps happening.');
  await expect(dialog).not.toContainText('SQLSTATE');
  await expect(dialog).not.toContainText('/private/auth');
});
