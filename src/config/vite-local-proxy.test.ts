/** @jest-environment node */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ProxyRoutes = Record<string, { target: string; changeOrigin?: boolean; ws?: boolean }>;

async function loadProxies(command = 'serve', apiTarget?: string): Promise<ProxyRoutes> {
  const script = `
    import { loadConfigFromFile } from 'vite';
    import path from 'node:path';
    delete process.env.APPFLOWY_DEV_API_PROXY_TARGET;
    delete process.env.APPFLOWY_DEV_WS_PROXY_TARGET;
    delete process.env.APPFLOWY_DEV_BILLING_PROXY_TARGET;
    const target = ${JSON.stringify(apiTarget ?? null)};
    if (target) process.env.APPFLOWY_DEV_API_PROXY_TARGET = target;
    // Reproduce starting Vite before the gateway is listening.
    globalThis.fetch = async () => { throw new Error('Gateway is not running yet'); };
    const loaded = await loadConfigFromFile(
      { command: ${JSON.stringify(command)}, mode: 'development' },
      path.resolve('vite.config.ts')
    );
    console.log(JSON.stringify(loaded.config.server.proxy));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
  });

  return JSON.parse(stdout);
}

// Vite uses the first matching route, with a leading ^ denoting a regexp.
function targetFor(routes: ProxyRoutes, url: string): string | undefined {
  return Object.entries(routes).find(([context]) =>
    context.startsWith('^') ? new RegExp(context).test(url) : url.startsWith(context)
  )?.[1].target;
}

describe('local development service routing', () => {
  it('keeps workspace usage on the gateway even when Vite starts before it', async () => {
    const routes = await loadProxies();

    expect(targetFor(routes, '/api/workspace/workspace-1/usage-and-limit')).toBe('http://localhost:8100');
    expect(targetFor(routes, '/api/workspace/workspace-1/usage-and-limit?refresh=true')).toBe('http://localhost:8100');
    expect(targetFor(routes, '/api/user/profile')).toBe('http://localhost:8000');
    expect(targetFor(routes, '/api/workspace/workspace-1/view/view-1')).toBe('http://localhost:8000');
    expect(targetFor(routes, '/ws/v2')).toBe('http://localhost:8000');
    expect(targetFor(routes, '/billing/api/v1/personal-subscription-status')).toBe('http://localhost:4242');
  });

  it('honors an explicitly configured API target for workspace usage', async () => {
    const routes = await loadProxies('serve', 'http://localhost:8200');

    expect(targetFor(routes, '/api/workspace/workspace-1/usage-and-limit')).toBe('http://localhost:8200');
    expect(targetFor(routes, '/api/user/profile')).toBe('http://localhost:8200');
  });

  it('does not install local API routing in production builds', async () => {
    const routes = await loadProxies('build');

    expect(targetFor(routes, '/api/workspace/workspace-1/usage-and-limit')).toBeUndefined();
    expect(targetFor(routes, '/billing/api/v1/pricing')).toBeUndefined();
    expect(targetFor(routes, '/ws/v2')).toBeUndefined();
  });
});
