import { expect, test } from '@playwright/test';

import { parseExactUid, permitsAppSocket, permitsBrowserWrite } from '../../support/space-group-permission-lifecycle';

// These exercise fixture boundaries without credentials, a browser or a server.
const scope = { cloud: 'http://127.0.0.1:33111', auth: 'http://127.0.0.1:33110', workspace: 'owned', pages: ['primary', 'direct', 'second'] };

test('@offline preserves i64 membership identity while leaving ordinary values intact', () => {
  expect(parseExactUid('{"uid":1234567890123456789,"level":30}')).toEqual({ uid: '1234567890123456789', level: 30 });
});

test('@offline permits only recent visits to one owned document', () => {
  const url = new URL(`${scope.cloud}/api/workspace/owned/add-recent-pages`);

  expect(permitsBrowserWrite(url, 'POST', '{"recent_view_ids":["primary"]}', scope)).toBe(true);
  for (const body of ['{}', '{"recent_view_ids":["unrelated"]}', '{"recent_view_ids":["primary","direct"]}', 'invalid']) {
    expect(permitsBrowserWrite(url, 'POST', body, scope)).toBe(false);
  }

  expect(permitsBrowserWrite(new URL(`${scope.cloud}/api/workspace/foreign/add-recent-pages`), 'POST', '{"recent_view_ids":["primary"]}', scope)).toBe(false);
});

test('@offline blocks permission, content and preference mutations from the browser', () => {
  for (const path of ['/api/workspace/owned/spaces/space/group/group', '/api/workspace/owned/page-view/primary/update-name', '/api/user/update']) {
    expect(permitsBrowserWrite(new URL(scope.cloud + path), 'POST', '{}', scope)).toBe(false);
  }

  expect(permitsBrowserWrite(new URL(scope.cloud + '/api/workspace/owned/open'), 'PUT', '{}', scope)).toBe(false);
  expect(permitsBrowserWrite(new URL(scope.auth + '/token?grant_type=password'), 'POST', '{}', scope)).toBe(false);
  expect(permitsBrowserWrite(new URL(scope.auth + '/token?grant_type=refresh_token'), 'POST', '{}', scope)).toBe(true);
});

test('@offline binds websocket transport to the exact actor, workspace, origin and unexpired token', () => {
  const actor = { uuid: 'subject', token: `header.${Buffer.from(JSON.stringify({ sub: 'subject', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature` };
  const url = new URL(`ws://127.0.0.1:33111/ws/v2/owned/?token=${actor.token}`);

  expect(permitsAppSocket(url, scope.cloud, scope.workspace, actor)).toBe(true);
  for (const change of [
    (value: URL) => { value.pathname = '/ws/v2/other/'; },
    (value: URL) => { value.port = '33112'; },
    (value: URL) => { value.searchParams.append('token', actor.token); },
    (value: URL) => { value.searchParams.set('token', actor.token + 'changed'); },
  ]) {
    const altered = new URL(url);

    change(altered);
    expect(permitsAppSocket(altered, scope.cloud, scope.workspace, actor)).toBe(false);
  }

  expect(permitsAppSocket(url, scope.cloud, scope.workspace, { ...actor, uuid: 'other' })).toBe(false);
  const expired = { uuid: actor.uuid, token: `header.${Buffer.from(JSON.stringify({ sub: actor.uuid, exp: 1 })).toString('base64url')}.signature` };

  expect(permitsAppSocket(new URL(`ws://127.0.0.1:33111/ws/v2/owned/?token=${expired.token}`), scope.cloud, scope.workspace, expired)).toBe(false);
});
