import { APIRequestContext, expect, request as playwrightRequest } from '@playwright/test';
import { createBdd, DataTable } from 'playwright-bdd';

import { TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

/**
 * LDAP sign-in completes entirely server-side, so these steps exercise the
 * endpoint directly rather than a browser form. The web login UI has no LDAP
 * entry point yet; when it gains one, the scenarios stay as written and only
 * the "sign in" step needs to drive the form instead.
 */
const LDAP_LOGIN_PATH = '/web-api/ldap-login';

type LdapResult = {
  status: number;
  code?: number;
  message?: string;
  accessToken?: string;
};

type LdapState = {
  api: APIRequestContext;
  last?: LdapResult;
  collected: LdapResult[];
};

let state: LdapState;

Before(async () => {
  state = {
    api: await playwrightRequest.newContext({ baseURL: TestConfig.apiUrl }),
    collected: [],
  };
});

After(async () => {
  await state?.api.dispose();
});

async function ldapSignIn(username: string, password: string): Promise<LdapResult> {
  const response = await state.api.post(LDAP_LOGIN_PATH, {
    data: { username, password },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });

  // The endpoint answers inside AppFlowy's `{ code, message, data }` envelope,
  // so a rejected credential is a 200 with a non-zero code rather than a 4xx.
  let body: { code?: number; message?: string; data?: { access_token?: string } } = {};

  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return {
    status: response.status(),
    code: body.code,
    message: body.message,
    accessToken: body.data?.access_token,
  };
}

Given('an LDAP connection is configured for the workspace', async ({}) => {
  // Seeded out of band by AppFlowy-Cloud-Premium: `just seed-auth-fixtures`
  // starts the directory, and an admin creates the connection pointing at it.
  // Fail with the fix rather than letting every scenario fail on its assertion.
  const probe = await ldapSignIn('alice', 'alice-secret-pw');

  expect(
    probe.status,
    `LDAP login endpoint unreachable at ${TestConfig.apiUrl}${LDAP_LOGIN_PATH}. ` +
      'Is AppFlowy Cloud running?'
  ).toBeLessThan(500);

  expect(
    probe.code,
    'No usable LDAP connection. In AppFlowy-Cloud-Premium run `just seed-auth-fixtures`, ' +
      'then add an LDAP connection in the admin console pointing at ldap://localhost:1389.'
  ).toBe(0);
});

When(
  'I sign in with LDAP username {string} and password {string}',
  async ({}, username: string, password: string) => {
    state.last = await ldapSignIn(username, password);
  }
);

When('I collect the rejection for each of these sign-ins', async ({}, table: DataTable) => {
  state.collected = [];

  for (const row of table.hashes()) {
    const result = await ldapSignIn(row.username, row.password);

    expect(result.code, `expected ${row.username} to be rejected`).not.toBe(0);
    state.collected.push(result);
  }
});

Then('the LDAP sign-in succeeds', async ({}) => {
  expect(state.last?.code, `sign-in failed: ${state.last?.message}`).toBe(0);
  expect(state.last?.accessToken, 'expected an access token').toBeTruthy();
});

Then('the LDAP sign-in is rejected', async ({}) => {
  expect(state.last?.code).not.toBe(0);
  expect(state.last?.accessToken).toBeFalsy();
});

Then('the session belongs to {string}', async ({}, email: string) => {
  const token = state.last?.accessToken;

  expect(token, 'expected an access token to inspect').toBeTruthy();

  // The JWT payload carries the provisioned identity; email is the key AppFlowy
  // joins LDAP users on, so it proves the right directory entry was used.
  const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64').toString('utf8'));

  expect(payload.email).toBe(email);
});

Then('every rejection reports the same message', async ({}) => {
  expect(state.collected.length).toBeGreaterThan(1);

  const messages = new Set(state.collected.map((result) => result.message));

  expect(
    messages.size,
    `rejections must be indistinguishable or the endpoint enumerates the directory; saw: ${[
      ...messages,
    ].join(' | ')}`
  ).toBe(1);
});
