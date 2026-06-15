import { Page } from '@playwright/test';

export interface AuthConfig {
  baseUrl: string;
  gotrueUrl: string;
  adminEmail: string;
  adminPassword: string;
}

const defaultConfig: AuthConfig = {
  baseUrl: process.env.APPFLOWY_BASE_URL || 'http://localhost:8000',
  gotrueUrl: 'http://localhost:9999',
  adminEmail: process.env.GOTRUE_ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.GOTRUE_ADMIN_PASSWORD || 'password',
};

export function generateRandomEmail(): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `test_${rand}_${Date.now()}@test.com`;
}

/**
 * Full sign-in flow: creates user, gets tokens, sets localStorage, navigates to /app
 */
export async function signInAndNavigate(page: Page, config?: Partial<AuthConfig>): Promise<void> {
  const cfg = { ...defaultConfig, ...config };
  const email = generateRandomEmail();

  // 1. Get admin token
  let res = await fetch(`${cfg.gotrueUrl}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.adminEmail, password: cfg.adminPassword }),
  });
  if (!res.ok) throw new Error(`Admin sign-in failed: ${res.status}`);
  const adminData = await res.json();

  // 2. Generate action link
  res = await fetch(`${cfg.gotrueUrl}/admin/generate_link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminData.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, type: 'magiclink', redirect_to: 'http://localhost:3000' }),
  });
  if (!res.ok) throw new Error(`Generate link failed: ${res.status}`);
  const linkData = await res.json();

  // 3. Follow action link redirect to get tokens
  res = await fetch(linkData.action_link, { redirect: 'manual' });
  const location = res.headers.get('location');
  let callbackLink: string;
  if (location) {
    const redirectUrl = new URL(location, linkData.action_link);
    callbackLink = redirectUrl.pathname.substring(1) + redirectUrl.hash;
  } else {
    const html = await res.text();
    const match = html.match(/<a[^>]*href=["']([^"']+)["']/);
    if (!match?.[1]) throw new Error('Could not extract sign-in URL');
    callbackLink = match[1].replace(/&amp;/g, '&');
  }

  // 4. Parse tokens from hash
  const hashIndex = callbackLink.indexOf('#');
  if (hashIndex === -1) throw new Error('No hash in callback link');
  const params = new URLSearchParams(callbackLink.substring(hashIndex + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) throw new Error('Missing tokens');

  // 5. Verify user (create profile)
  for (let i = 0; i < 3; i++) {
    const verifyRes = await fetch(`${cfg.baseUrl}/api/user/verify/${accessToken}`);
    if (verifyRes.ok || (verifyRes.status !== 502 && verifyRes.status !== 503)) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  // 6. Refresh token
  res = await fetch(`${cfg.gotrueUrl}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const tokenData = await res.json();

  // 7. Set test mode and localStorage, then navigate
  await page.addInitScript(() => {
    (window as any).Cypress = true;
  });

  await page.goto('http://localhost:3000');
  await page.evaluate((data) => {
    localStorage.setItem('af_auth_token', data.access_token);
    localStorage.setItem('af_refresh_token', data.refresh_token || data.originalRefresh);
    if (data.user) localStorage.setItem('af_user_id', data.user.id);
    localStorage.setItem('token', JSON.stringify(data));
  }, { ...tokenData, originalRefresh: refreshToken });

  await page.goto('http://localhost:3000/app');
  await page.waitForURL(/\/app/, { timeout: 30000 });
}

/**
 * Create a new document page by clicking the '+' button on the first space
 */
export async function createNewDocumentPage(page: Page): Promise<void> {
  // Click the '+' button on the first space (General)
  const addBtn = page.locator('[data-testid="inline-add-page"]').first();
  await addBtn.click();

  // Click "Document" in the dropdown menu
  const docOption = page.getByRole('menuitem', { name: 'Document' });
  await docOption.click();

  // Wait for navigation to the new page
  await page.waitForTimeout(2000);

  // Wait for editor to be ready
  await page.locator('[data-testid="editor-content"]').waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Insert a video block via the slash command menu
 */
export async function insertVideoBlockViaSlash(page: Page): Promise<void> {
  // Click at the beginning of the editor to ensure focus
  const editor = page.locator('[data-testid="editor-content"]');
  await editor.click({ force: true, position: { x: 100, y: 10 } });
  await page.waitForTimeout(300);

  // Type /video to open slash menu
  await page.keyboard.type('/video');
  await page.waitForTimeout(800);

  // Click the video option
  const videoOption = page.locator('[data-testid="slash-menu-video"]');
  await videoOption.waitFor({ state: 'visible', timeout: 5000 });
  await videoOption.click();
  await page.waitForTimeout(500);
}

/**
 * Enter a URL in the embed link input and submit
 */
export async function enterEmbedUrl(page: Page, url: string): Promise<void> {
  // The embed popover should have an input field
  const embedInput = page.locator('.embed-block input').first();
  await embedInput.waitFor({ state: 'visible', timeout: 5000 });
  await embedInput.fill(url);
  await page.waitForTimeout(300);
}

/**
 * Submit the embed link by pressing Enter
 */
export async function submitEmbedLink(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
}
