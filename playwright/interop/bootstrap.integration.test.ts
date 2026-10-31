/** @jest-environment node */
import { createServer } from 'node:http';
import type { Socket } from 'node:net';

import { afterEach, expect, jest, test } from '@jest/globals';
import { chromium, type Browser, type LaunchOptions } from '@playwright/test';

import { installRuntimeTestConfig } from '../support/test-config';
import { waitForInteropFrontend } from './global-setup';

jest.setTimeout(15000);

const runtimeKeys = ['APPFLOWY_BASE_URL', 'APPFLOWY_GOTRUE_BASE_URL', 'APPFLOWY_WS_BASE_URL'] as const;
const previousRuntime = runtimeKeys.map((key) => process.env[key]);
const browsers: Browser[] = [];

afterEach(async () => {
  for (const browser of browsers.splice(0)) {
    if (browser.isConnected()) await browser.close();
  }

  runtimeKeys.forEach((key, index) => {
    const value = previousRuntime[index];

    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

// HTML is immediately ready, while a cold module takes longer than a normal
// navigation guard. No Cloud, account, workspace or real application is used.
async function slowModuleServer(delayMs: number) {
  let compiled = false;
  let htmlRequests = 0;
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/login') {
      htmlRequests++;
      response.setHeader('Content-Type', 'text/html');
      response.end('<div id="root"></div><script type="module" src="/main.js"></script>');
      return;
    }

    if (request.url === '/main.js') {
      const finish = () => {
        compiled = true;
        response.setHeader('Content-Type', 'text/javascript');
        response.end(`
          const config = window.__APP_CONFIG__;
          if (window.Cypress && config && ['APPFLOWY_BASE_URL', 'APPFLOWY_GOTRUE_BASE_URL', 'APPFLOWY_WS_BASE_URL']
            .every(key => typeof config[key] === 'string' && config[key].length)) {
            document.getElementById('root').innerHTML = '<input data-testid="login-email-input"/><button data-testid="login-password-button">Password</button>';
            localStorage.setItem('bootstrap-context', 'owned');
          }
        `);
      };

      if (compiled) finish();
      else {
        const timer = setTimeout(() => { timers.delete(timer); finish(); }, delayMs);

        timers.add(timer);
        response.once('close', () => { clearTimeout(timer); timers.delete(timer); });
      }

      return;
    }

    response.writeHead(404).end();
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (address === null || typeof address === 'string') throw new Error('Missing test server address');
  const origin = `http://127.0.0.1:${address.port}`;

  process.env.APPFLOWY_BASE_URL = origin;
  process.env.APPFLOWY_GOTRUE_BASE_URL = `${origin}/gotrue`;
  process.env.APPFLOWY_WS_BASE_URL = `${origin.replace('http:', 'ws:')}/ws`;
  return {
    origin,
    get htmlRequests() { return htmlRequests; },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function captureBrowser(cleanupError?: Error) {
  let owned: Browser | undefined;

  return {
    get browser() { return owned; },
    async launch(options: LaunchOptions) {
      const browser = await chromium.launch(options);

      owned = browser;
      browsers.push(browser);
      if (cleanupError) {
        const close = browser.close.bind(browser);

        browser.close = async () => { await close(); throw cleanupError; };
      }

      return browser;
    },
  };
}

async function anonymousPage(browser: Browser, origin: string) {
  const context = await browser.newContext({ baseURL: origin });

  await installRuntimeTestConfig(context, { required: true });
  await context.addInitScript(() => { (window as Window & { Cypress?: boolean }).Cypress = true; });
  return context.newPage();
}

test('HTTP-ready cold modules fail the same short guard until browser bootstrap finishes', async () => {
  const fixture = await slowModuleServer(1500);
  const navigationTimeout = 250;

  try {
    const response = await fetch(`${fixture.origin}/login`);

    expect(response.status).toBe(200);
    await response.text();
    const cold = await chromium.launch();

    browsers.push(cold);
    const coldPage = await anonymousPage(cold, fixture.origin);

    await expect(coldPage.goto('/login', { waitUntil: 'domcontentloaded', timeout: navigationTimeout }))
      .rejects.toThrow(/Timeout/);
    await cold.close();

    const startup = captureBrowser();

    await waitForInteropFrontend(fixture.origin, { timeoutMs: 5000, launch: startup.launch });
    expect(startup.browser?.isConnected()).toBe(false);

    const functional = await chromium.launch();

    browsers.push(functional);
    const page = await anonymousPage(functional, fixture.origin);

    expect(await page.context().storageState()).toEqual({ cookies: [], origins: [] });
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
    await expect(page.getByTestId('login-email-input').isVisible()).resolves.toBe(true);
    await expect(page.getByTestId('login-password-button').isVisible()).resolves.toBe(true);
  } finally {
    await fixture.close();
  }
});

test('a stalled module exhausts one startup deadline and closes the owned browser', async () => {
  const fixture = await slowModuleServer(10000);
  const startup = captureBrowser();
  const started = Date.now();

  try {
    await expect(waitForInteropFrontend(fixture.origin, { timeoutMs: 1500, launch: startup.launch }))
      .rejects.toThrow(/exceeded/);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(startup.browser?.isConnected()).toBe(false);
  } finally {
    await fixture.close();
  }
});

test('missing explicit test services fail before page navigation and close the browser', async () => {
  const fixture = await slowModuleServer(0);

  delete process.env.APPFLOWY_WS_BASE_URL;
  const startup = captureBrowser();

  try {
    await expect(waitForInteropFrontend(fixture.origin, { timeoutMs: 5000, launch: startup.launch }))
      .rejects.toThrow(/APPFLOWY_WS_BASE_URL must be explicit/);
    expect(fixture.htmlRequests).toBe(0);
    expect(startup.browser?.isConnected()).toBe(false);
  } finally {
    await fixture.close();
  }
});

test('cleanup failure cannot turn readiness into success', async () => {
  const fixture = await slowModuleServer(0);
  const cleanupError = new Error('controlled browser cleanup failure');
  const startup = captureBrowser(cleanupError);

  try {
    await expect(waitForInteropFrontend(fixture.origin, { timeoutMs: 5000, launch: startup.launch }))
      .rejects.toBe(cleanupError);
    expect(startup.browser?.isConnected()).toBe(false);
  } finally {
    await fixture.close();
  }
});

test('a startup timeout remains visible when cleanup also fails', async () => {
  const fixture = await slowModuleServer(10000);
  const cleanupError = new Error('controlled browser cleanup failure');
  const startup = captureBrowser(cleanupError);

  try {
    let failure: unknown;

    try {
      await waitForInteropFrontend(fixture.origin, { timeoutMs: 1500, launch: startup.launch });
    } catch (error) { failure = error; }

    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error('Expected both failures');
    expect(failure.errors[0].message).toMatch(/exceeded/);
    expect(failure.errors[1]).toBe(cleanupError);
    expect(startup.browser?.isConnected()).toBe(false);
  } finally {
    await fixture.close();
  }
});
