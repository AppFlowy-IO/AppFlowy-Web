/**
 * Opt-in real YouTube download check (requires a desktop display and installed Playwright Chromium):
 *   RUN_YOUTUBE_DOWNLOAD_LIVE_TEST=1 node scripts/test-youtube-browser-download.mjs
 * Optional: VIDEO_ID=aqz-KE-bpKQ. No account, ASR request, or document write is performed.
 * Only static test HTML/JavaScript is served locally; media downloads in the browser.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

if (process.env.RUN_YOUTUBE_DOWNLOAD_LIVE_TEST !== '1') {
  console.log('Skipped: set RUN_YOUTUBE_DOWNLOAD_LIVE_TEST=1 to test a real browser download.');
  process.exit(0);
}

const videoId = process.env.VIDEO_ID || 'W2zbKF5z1cs';
if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
  console.error(JSON.stringify({ success: false, code: 'invalidVideoId' }));
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
let temporaryDirectory;
let server;
let browserProcess;
let browser;
let cleanupPromise;
let stage = 'dependencies';

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (browser) await Promise.race([browser.close().catch(() => {}), delay(3000)]);
    if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
      browserProcess.kill('SIGTERM');
      await Promise.race([once(browserProcess, 'exit').catch(() => {}), delay(3000)]);
      if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
        browserProcess.kill('SIGKILL');
        await Promise.race([once(browserProcess, 'exit').catch(() => {}), delay(1000)]);
      }
    }
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  })();
  return cleanupPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.error(JSON.stringify({ success: false, code: 'interrupted' }));
    void cleanup().finally(() => process.exit(1));
  });
}

async function reserveDebugPort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

const testSource = `
import { downloadYoutubeAudioInBrowser } from './src/application/integrations/youtube-browser-download';
const videoId = ${JSON.stringify(videoId)};
let playback;
let extensionError;
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.protocol !== 'appflowy-youtube-v1' || data.direction !== 'extension') return;
  if (['unavailable', 'blocked', 'timeout', 'failed', 'too-large'].includes(data.error)) extensionError = data.error;
  if (data.playback?.videoId === videoId) {
    // Retain only completeness assertions, never signed URLs or proof tokens.
    playback = {
      duration: data.playback.duration,
      audioSizes: data.playback.formats.filter(f => f.mimeType?.startsWith('audio/')).map(f => ({
        type: f.mimeType.split(';')[0], size: Number(f.contentLength),
      })),
    };
  }
});
async function htmlDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const finish = (duration) => {
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('invalidAudioDuration'));
    };
    const timer = setTimeout(() => finish(null), 15000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}
document.querySelector('button').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const file = await downloadYoutubeAudioInBrowser({
      url: 'https://www.youtube.com/watch?v=' + videoId,
      signal: controller.signal,
      maxBytes: 32 * 1024 * 1024,
    });
    const duration = await htmlDuration(file);
    const completeBytes = playback?.audioSizes.some(f => f.type === file.type && f.size === file.size);
    const completeDuration = playback && Math.abs(duration - playback.duration) <= 2;
    window.liveTestResult = {
      success: file instanceof File && file.size > 0 && !!completeBytes && !!completeDuration,
      code: !completeBytes ? 'incompleteAudioBytes' : !completeDuration ? 'incompleteAudioDuration' : 'complete',
      bytes: file.size, mimeType: file.type, duration, expectedDuration: playback?.duration,
      completeBytes: !!completeBytes, completeDuration: !!completeDuration,
    };
  } catch (error) {
    const allowed = ['youtubeDownloadFailed', 'youtubeDownloadBlocked', 'youtubeExtensionRequired',
      'fileTooLarge', 'noAudio', 'unableReadDuration'];
    window.liveTestResult = {
      success: false,
      code: allowed.includes(error?.code) ? error.code : error?.name === 'AbortError' ? 'cancelled' : 'testFailed',
      ...(extensionError ? { extensionCode: extensionError } : {}),
    };
  } finally { clearTimeout(timeout); }
});
window.liveTestReady = true;
`;

try {
  const { chromium } = require('@playwright/test');
  // Resolve esbuild through its existing Vite dependency, including pnpm's layout.
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  stage = 'bundle';
  const { outputFiles } = await build({
    absWorkingDir: root,
    stdin: { contents: testSource, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome120', logLevel: 'silent',
  });
  const javascript = outputFiles[0].contents;
  const html = '<!doctype html><meta charset="utf-8"><title>YouTube audio live test</title>' +
    '<button type="button">Test YouTube audio download</button><script src="/test.js"></script>';
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'appflowy-youtube-live-'));
  const extensionPath = join(temporaryDirectory, 'extension');
  await cp(join(root, 'extensions/youtube-transcript'), extensionPath, {
    recursive: true, filter: (source) => basename(source) !== '_metadata',
  });
  let unexpectedLocalRequests = 0;
  server = http.createServer((request, response) => {
    // This server has no upstream fetch, upload, proxy, or media endpoint.
    const body = request.url === '/' ? html : request.url === '/test.js' ? javascript : undefined;
    if (request.url === '/favicon.ico' && request.method === 'GET') {
      response.writeHead(204).end();
    } else if (body !== undefined && ['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(200, {
        'Content-Type': request.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      }).end(request.method === 'HEAD' ? undefined : body);
    } else {
      unexpectedLocalRequests++;
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const debugPort = await reserveDebugPort();
  stage = 'browserLaunch';
  // A normal headed browser is necessary: automated profiles can fail YouTube's own playback.
  // Fixed nonzero CDP port; no headless, enable-automation, autoplay override, or existing profile.
  browserProcess = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(temporaryDirectory, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-quic',
    `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, 'about:blank',
  ], { stdio: 'ignore' });
  let spawnFailed = false;
  browserProcess.on('error', () => { spawnFailed = true; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnFailed || browserProcess.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* The freshly launched browser may still be starting. */ }
    await delay(200);
  }
  if (!ready) throw new Error('browserLaunch');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 15000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  let mediaRequests = 0;
  let unexpectedAppRequests = 0;
  let appFlowyServerRequests = 0;
  const helperTabs = new Set();
  context.on('page', (tab) => { helperTabs.add(tab); tab.on('close', () => helperTabs.delete(tab)); });
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host === 'appflowy.cloud' || host.endsWith('.appflowy.cloud') ||
      host === 'appflowy.io' || host.endsWith('.appflowy.io')) appFlowyServerRequests++;
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.protocol === 'https:' && url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback') {
      mediaRequests++;
      return route.continue();
    }
    unexpectedAppRequests++;
    return route.abort();
  });
  stage = 'download';
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.liveTestReady === true);
  const webdriver = await page.evaluate(() => navigator.webdriver);
  if (webdriver) { stage = 'automatedBrowser'; throw new Error('automatedBrowser'); }
  await page.getByRole('button', { name: 'Test YouTube audio download' }).click();
  await page.waitForFunction(() => Boolean(window.liveTestResult), null, { timeout: 200000 });
  const result = await page.evaluate(() => window.liveTestResult);
  // The helper's tab must be released whether playback succeeds or fails.
  for (let attempt = 0; helperTabs.size && attempt < 20; attempt++) await delay(100);
  const networkVerified = mediaRequests > 0 && unexpectedAppRequests === 0 &&
    appFlowyServerRequests === 0 && unexpectedLocalRequests === 0;
  const success = result.success && networkVerified && helperTabs.size === 0;
  console.log(JSON.stringify({
    ...result, success, videoId, webdriver, mediaRequests, networkVerified,
    unexpectedAppRequests, appFlowyServerRequests, unexpectedLocalRequests, remainingHelperTabs: helperTabs.size,
  }, null, 2));
  if (!success) process.exitCode = 1;
} catch {
  // Never print provider error messages, signed media URLs, or playback tokens.
  console.error(JSON.stringify({ success: false, code: stage }));
  process.exitCode = 1;
} finally {
  await cleanup().catch(() => {
    console.error(JSON.stringify({ success: false, code: 'cleanupFailed' }));
    process.exitCode = 1;
  });
}
