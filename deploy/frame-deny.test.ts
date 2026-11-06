/** @jest-environment node */

/**
 * The anti-framing headers of FRAME_DENY_PATHS are set by each host on its
 * own: deploy/routes.ts (the SSR image, tested in routes.test.ts), the
 * nginx-only image's docker/nginx.conf and vercel.json. Neither config can
 * import the shared values, so these tests read both files and compare.
 */
import fs from 'fs';
import path from 'path';

import { FRAME_DENY_HEADERS, FRAME_DENY_PATHS, isFrameDenyPath } from './app-paths';

const ROOT = path.join(__dirname, '..');

type VercelConfig = { headers?: { source: string; headers: { key: string; value: string }[] }[] };

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as VercelConfig;
const nginx = fs.readFileSync(path.join(ROOT, 'docker', 'nginx.conf'), 'utf8');

/** The body of nginx's `location ^~ <prefix> { ... }` block (no nested blocks). */
function nginxPrefixLocation(prefix: string): string | undefined {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  return new RegExp(`location \\^~ ${escaped} \\{([^}]*)\\}`).exec(nginx)?.[1];
}

describe.each(FRAME_DENY_PATHS)('anti-framing headers for %s', (base) => {
  it('match FRAME_DENY_HEADERS in vercel.json', () => {
    const rule = vercel.headers?.find(({ source }) => source === `${base}/(.*)`);

    expect(rule).toBeDefined();
    expect(Object.fromEntries(rule!.headers.map(({ key, value }) => [key, value]))).toEqual(FRAME_DENY_HEADERS);
  });

  it('match FRAME_DENY_HEADERS in the nginx-only image and still serve the SPA shell', () => {
    const block = nginxPrefixLocation(`${base}/`);

    expect(block).toBeDefined();

    const headers = Object.fromEntries(
      Array.from(block!.matchAll(/add_header\s+(\S+)\s+"([^"]*)"\s+always;/g), ([, key, value]) => [key, value])
    );

    expect(headers).toEqual(FRAME_DENY_HEADERS);
    // `try_files` would jump to `location /` for the shell and drop these headers.
    expect(block).toMatch(/^\s*rewrite \^ \/index\.html break;$/m);
    expect(block).not.toContain('try_files');
  });
});

describe('isFrameDenyPath', () => {
  it.each([
    ['/oauth', true],
    ['/oauth/mcp/authorize', true],
    ['/oauth/mcp/setup', true],
    // The SPA decodes each segment before matching, so these render the same page.
    ['/%6Fauth/mcp/authorize', true],
    ['/%6fauth/mcp/setup', true],
    ['/oauth/%6Dcp/authorize', true],
    ['/oauthors/page', false],
    ['/app/oauth', false],
    // An encoded '/' stays inside its segment, as in React Router.
    ['/oauth%2Fmcp%2Fauthorize', false],
    // Malformed encoding: the SPA keeps the raw path, so this is not /oauth.
    ['/%E0%A4%A/oauth', false],
  ])('%s is %p', (pathname, expected) => {
    expect(isFrameDenyPath(pathname)).toBe(expected);
  });
});
