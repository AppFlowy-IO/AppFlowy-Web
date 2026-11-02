import { chromium, type Browser, type BrowserContextOptions, type FullConfig, type LaunchOptions } from '@playwright/test';

import { AuthSelectors } from '../support/selectors';
import { installRuntimeTestConfig } from '../support/test-config';

type AnonymousContextOptions = Pick<BrowserContextOptions,
  'viewport' | 'userAgent' | 'locale' | 'bypassCSP' | 'ignoreHTTPSErrors' | 'colorScheme'>;

interface BootstrapOptions {
  timeoutMs?: number;
  launchOptions?: LaunchOptions;
  contextOptions?: AnonymousContextOptions;
  launch?: (options: LaunchOptions) => Promise<Browser>;
}

/**
 * HTTP readiness does not wait for Vite's first module transform. Prime that
 * graph in a disposable anonymous browser before the functional tests start;
 * their original navigation and assertion deadlines remain unchanged.
 */
export async function waitForInteropFrontend(origin: string, options: BootstrapOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120000;
  const deadline = Date.now() + timeoutMs;
  let stage = 'browser launch';
  const expired = () => new Error(`Interop frontend bootstrap exceeded ${timeoutMs}ms during ${stage}`);
  const remaining = () => {
    const value = deadline - Date.now();

    if (value <= 0) throw expired();
    return value;
  };

  let browser: Browser | undefined;
  let failure: { error: unknown } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const launch = options.launch ?? ((settings: LaunchOptions) => chromium.launch(settings));
    // Launch has its own SDK timeout so a late result cannot orphan a browser
    // before this function acquires ownership of it.
    const activeBrowser = await launch({ ...options.launchOptions, timeout: remaining() });

    browser = activeBrowser;
    const prepare = async () => {
      stage = 'anonymous context';
      const context = await activeBrowser.newContext({ ...options.contextOptions, baseURL: origin });

      stage = 'explicit runtime configuration';
      await installRuntimeTestConfig(context, { required: true });
      await context.addInitScript(() => {
        (window as Window & { Cypress?: boolean }).Cypress = true;
      });
      const page = await context.newPage();

      stage = 'login module navigation';
      await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: remaining() });
      stage = 'login UI';
      await AuthSelectors.emailInput(page).waitFor({ state: 'visible', timeout: remaining() });
      await AuthSelectors.passwordSignInButton(page).waitFor({ state: 'visible', timeout: remaining() });
    };

    await Promise.race([
      prepare(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(expired()), remaining());
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    failure = { error: new Error(`Interop frontend bootstrap failed during ${stage}: ${message}`, { cause: error }) };
  } finally {
    clearTimeout(timer);
  }

  // Closing this owned browser also closes its contexts. Never hand its cookies
  // or local storage to either of the two compatibility test flows.
  try {
    await browser?.close();
  } catch (error) {
    if (failure) throw new AggregateError([failure.error, error], 'Interop bootstrap and browser cleanup failed');
    throw error;
  }

  if (failure) throw failure.error;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const use = config.projects[0]?.use;

  if (!use?.baseURL) throw new Error('Interop bootstrap requires the configured frontend URL');
  const started = Date.now();

  await waitForInteropFrontend(use.baseURL, {
    launchOptions: {
      ...use.launchOptions,
      headless: use.headless ?? use.launchOptions?.headless ?? true,
      channel: use.channel ?? use.launchOptions?.channel,
    },
    contextOptions: {
      viewport: use.viewport,
      userAgent: use.userAgent,
      locale: use.locale,
      bypassCSP: use.bypassCSP,
      ignoreHTTPSErrors: use.ignoreHTTPSErrors,
      colorScheme: use.colorScheme,
    },
  });
  console.log(`Interop frontend ready: anonymous login UI after ${Date.now() - started}ms`);
}
