import { Browser, BrowserContext, LaunchOptions } from '@playwright/test';

import { GalleryConfig, GalleryFixture, GalleryPerson, refreshGallerySession } from './permission-gallery-seed';

/**
 * Browser sessions of the permission gallery: the browser flags, network guard and session setup
 * that the screenshot spec (permission-gallery.capture.spec.ts) and the video spec
 * (permission-videos.capture.spec.ts) share, so both run with the same isolation.
 */

/**
 * Chromium for both specs. Besides the app's own requests (see `guardGalleryNetwork`), Chromium
 * opens connections by itself (update checks, Google services). Its proxy is therefore a closed
 * loopback port: 9, which only root could listen on. Chromium never proxies loopback addresses, so
 * the stack is reached directly, while anything else fails to connect. This is a flag rather than
 * Playwright's `proxy` option, which would send loopback through the proxy as well.
 */
export function galleryLaunchOptions(extra: Pick<LaunchOptions, 'slowMo'> = {}): LaunchOptions {
  return {
    executablePath: process.env.APPFLOWY_TEST_CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--proxy-server=http://127.0.0.1:9'],
    ...extra,
  };
}

/** `origin` (an http origin of the stack) in `scheme`, as a regular expression source. */
function originSource(origin: string, scheme: 'http' | 'ws') {
  return origin.replace(/^http/, scheme).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * The URLs the app may not use: anything outside the stack's three origins, and the paths the dev
 * server proxies to developer ports. `scheme` is http for requests and ws for WebSockets.
 */
function outsideStack(cfg: GalleryConfig, scheme: 'http' | 'ws') {
  const [web, cloud, gotrue] = [cfg.web, cfg.cloud, cfg.gotrue].map((origin) => originSource(origin, scheme));
  const devProxy = '(?:api|ws|gotrue|s3|billing)(?:[/?#]|$)';

  return new RegExp(`^(?!${cloud}/|${gotrue}/|${web}/(?!${devProxy}))`);
}

/**
 * Abort the app's requests outside the gallery stack's three origins. `route` does not see
 * WebSockets, so a WebSocket outside the stack is closed before it connects. The WebSocket rule
 * is a pattern, not a function: with a function, Playwright hands every WebSocket to the test
 * process and relays those no handler takes through it, message by message; with a pattern, the
 * sockets it does not match connect directly.
 */
export async function guardGalleryNetwork(context: BrowserContext, cfg: GalleryConfig) {
  const requests = outsideStack(cfg, 'http');

  await context.route('**/*', async (route) => {
    if (requests.test(route.request().url())) {
      await route.abort();
      return;
    }

    await route.continue();
  });
  await context.routeWebSocket(outsideStack(cfg, 'ws'), (socket) => socket.close());
}

/**
 * The live connection of a browser session. While `muted`, what the server pushes (including
 * permission change hints) is held back, so the app only learns of a change when it asks itself.
 */
export type GalleryRealtime = { muted: boolean };

export interface GalleryContextOptions {
  viewport: { width: number; height: number };
  realtime?: GalleryRealtime;
  /** Open without a stored session, so the person signs in on the login screen. */
  signedOut?: boolean;
  /** Record a video of every page of the context (Playwright's recordVideo). */
  recordVideo?: { dir: string; size: { width: number; height: number } };
}

/**
 * A browser context for one person, before any page is open: requests outside the stack are
 * aborted, the app's runtime config points at the stack, and (unless `signedOut`) a fresh GoTrue
 * password grant is stored as the app's session, as in the permission lifecycle harness.
 */
export async function newGalleryContext(
  browser: Browser,
  cfg: GalleryConfig,
  fixture: GalleryFixture,
  person: GalleryPerson,
  options: GalleryContextOptions
) {
  const auth = options.signedOut ? null : (await refreshGallerySession(cfg, fixture.people[person])).auth;
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: 1,
    ...(options.recordVideo ? { recordVideo: options.recordVideo } : {}),
  });

  await guardGalleryNetwork(context, cfg);
  const realtime = options.realtime;

  if (realtime) {
    // Relay the app's Cloud socket both ways, except that server pushes are dropped while muted.
    await context.routeWebSocket(
      new RegExp(`^${originSource(cfg.cloud, 'ws')}/`),
      (socket) => {
        const server = socket.connectToServer();

        socket.onMessage((message) => server.send(message));
        server.onMessage((message) => {
          if (!realtime.muted) socket.send(message);
        });
      }
    );
  }

  await context.addInitScript(
    ({ auth, cloud, gotrue }) => {
      (window as Window & { __APP_CONFIG__?: Record<string, string> }).__APP_CONFIG__ = {
        APPFLOWY_BASE_URL: cloud,
        APPFLOWY_GOTRUE_BASE_URL: gotrue,
        APPFLOWY_WS_BASE_URL: `${cloud.replace(/^http/, 'ws')}/ws/v2`,
      };
      if (auth) localStorage.setItem('token', JSON.stringify(auth));
    },
    { auth, cloud: cfg.cloud, gotrue: cfg.gotrue }
  );
  return context;
}
