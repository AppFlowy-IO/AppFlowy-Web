/** @jest-environment node */
import crypto from 'node:crypto';

import { exchangeAuthorizationCode, getJson, pkcePair, startCallbackServer } from './mcp-oauth-helpers';

import type { APIRequestContext } from '@playwright/test';

jest.mock('@playwright/test', () => ({ expect: (actual: unknown) => expect(actual) }));

const reply = (status: number, body: unknown) => ({
  status: () => status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('startCallbackServer', () => {
  it('hands the redirect query to the waiting test and answers other paths with 404', async () => {
    const callback = await startCallbackServer();

    try {
      expect((await fetch(new URL('/other', callback.redirectUri))).status).toBe(404);
      const redirect = new URL(callback.redirectUri);

      redirect.search = new URLSearchParams({ code: 'the-code', state: 'the-state', iss: 'http://mcp' }).toString();
      expect((await fetch(redirect)).status).toBe(200);
      await expect(callback.waitForCallback(1000)).resolves.toEqual({
        code: 'the-code',
        error: null,
        state: 'the-state',
        iss: 'http://mcp',
      });
    } finally {
      await callback.close();
    }
  });

  it('fails the wait when no redirect arrives, and reports a failed close', async () => {
    const callback = await startCallbackServer();

    await expect(callback.waitForCallback(10)).rejects.toThrow('Timed out waiting for the MCP OAuth callback');
    await callback.close();
    await expect(callback.close()).rejects.toThrow();
  });
});

describe('pkcePair', () => {
  it('derives the S256 challenge from the verifier', () => {
    const { verifier, challenge } = pkcePair();

    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
  });
});

describe('getJson', () => {
  it('fails on a metadata document that is not served instead of passing on without it', async () => {
    const request = { get: jest.fn().mockResolvedValue(reply(404, { error: 'not_found' })) };

    await expect(
      getJson(request as unknown as APIRequestContext, 'http://mcp/.well-known/oauth-protected-resource')
    ).rejects.toThrow();
  });

  it('returns a served document', async () => {
    const request = { get: jest.fn().mockResolvedValue(reply(200, { resource: 'http://mcp/mcp' })) };

    await expect(getJson(request as unknown as APIRequestContext, 'http://mcp/.well-known/x')).resolves.toEqual({
      resource: 'http://mcp/mcp',
    });
  });
});

describe('exchangeAuthorizationCode', () => {
  const params = {
    code: 'the-code',
    verifier: 'the-verifier',
    clientId: 'the-client',
    redirectUri: 'http://127.0.0.1:1/callback',
    resource: 'http://mcp/mcp',
  };

  it('sends the code, verifier and resource as a form and returns the tokens', async () => {
    const tokens = { access_token: 'a', token_type: 'Bearer', refresh_token: 'r', workspace_id: 'w' };
    const post = jest.fn().mockResolvedValue(reply(200, tokens));

    await expect(
      exchangeAuthorizationCode({ post } as unknown as APIRequestContext, 'http://mcp/token', params)
    ).resolves.toEqual(tokens);
    expect(post).toHaveBeenCalledWith('http://mcp/token', {
      form: {
        grant_type: 'authorization_code',
        code: 'the-code',
        code_verifier: 'the-verifier',
        client_id: 'the-client',
        redirect_uri: 'http://127.0.0.1:1/callback',
        resource: 'http://mcp/mcp',
      },
      failOnStatusCode: false,
    });
  });

  it('fails when the token endpoint refuses the code', async () => {
    const post = jest.fn().mockResolvedValue(reply(400, { error: 'invalid_grant' }));

    await expect(
      exchangeAuthorizationCode({ post } as unknown as APIRequestContext, 'http://mcp/token', params)
    ).rejects.toThrow();
  });
});
