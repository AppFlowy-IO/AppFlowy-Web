import { APIRequestContext, expect, request as playwrightRequest } from '@playwright/test';
import { createBdd, DataTable } from 'playwright-bdd';

import { TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

/**
 * LDAP sign-in completes entirely server-side, so these steps exercise the
 * endpoint directly. Dialog behavior is covered by component tests; these
 * scenarios validate the directory authentication and session contract.
 */
const LDAP_LOGIN_PATH = '/api/auth/ldap/login';

function createLdapApiContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: TestConfig.apiUrl,
  });
}

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
    api: await createLdapApiContext(),
    collected: [],
  };
});

After(async () => {
  await state?.api.dispose();
});

async function ldapSignIn(
  api: APIRequestContext,
  username: string,
  password: string
): Promise<LdapResult> {
  const response = await api.post(LDAP_LOGIN_PATH, {
    data: { username, password },
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

/**
 * Proving a connection exists costs a real sign-in: the endpoint deliberately
 * answers "no connection configured" and "wrong password" identically, so
 * nothing cheaper distinguishes them.
 *
 * That makes the probe too expensive to repeat per scenario. Under
 * `fullyParallel` it would also mean one concurrent sign-in as the same user
 * per scenario, which is worth avoiding on its own. So it runs once per worker
 * and every scenario in that worker awaits the same result.
 */
const PROBE_ACCOUNT = { username: 'alice', password: 'alice-secret-pw' };

let connectionProbe: Promise<LdapResult> | undefined;

function probeLdapConnection(): Promise<LdapResult> {
  connectionProbe ??= (async () => {
    // Its own context: the probe outlives the scenario that triggered it,
    // whose `state.api` is disposed in `After`.
    const api = await createLdapApiContext();

    try {
      return await ldapSignIn(api, PROBE_ACCOUNT.username, PROBE_ACCOUNT.password);
    } finally {
      await api.dispose();
    }
  })();

  return connectionProbe;
}

Given('an LDAP connection is configured for the workspace', async ({}) => {
  // Seeded out of band by AppFlowy-Cloud-Premium: `just seed-auth-fixtures`
  // starts the directory, and an admin creates the connection pointing at it.
  // Fail with the fix rather than letting every scenario fail on its assertion.
  const probe = await probeLdapConnection();

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
    state.last = await ldapSignIn(state.api, username, password);
  }
);

When('I collect the rejection for each of these sign-ins', async ({}, table: DataTable) => {
  state.collected = [];

  for (const row of table.hashes()) {
    const result = await ldapSignIn(state.api, row.username, row.password);

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

  const rejectionTuples = state.collected.map((result, index) => {
    expect(typeof result.code, `rejection ${index + 1} must contain a numeric envelope code`).toBe('number');
    expect(Number.isFinite(result.code), `rejection ${index + 1} must contain a finite envelope code`).toBe(true);
    expect(result.code, `rejection ${index + 1} must have a nonzero envelope code`).not.toBe(0);
    expect(typeof result.message, `rejection ${index + 1} must contain an envelope message`).toBe('string');

    return [result.status, result.code, result.message] as const;
  });
  const [expectedTuple, ...remainingTuples] = rejectionTuples;

  for (const tuple of remainingTuples) {
    expect(
      tuple,
      `rejections must be indistinguishable or the endpoint enumerates the directory; saw: ${rejectionTuples
        .map((value) => JSON.stringify(value))
        .join(' | ')}`
    ).toEqual(expectedTuple);
  }
});
