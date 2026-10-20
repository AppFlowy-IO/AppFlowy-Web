import axios, { AxiosHeaders, AxiosRequestConfig } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import i18next from 'i18next';
import { TextDecoder, TextEncoder } from 'util';

import { ServerInfoState, updateServerInfo } from '@/utils/server-info';

import { verifyToken } from '../cloud-auth';
import { clearHttpResponseCaches, executeAPIRequest, getAxios, initAPIService } from '../core';
import { getViewPdfBlob } from '../export-api';
import { forgotPassword } from '../gotrue';
import { uploadImportFile } from '../import-api';
import { publishCollabs } from '../publish-api';

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(() => null),
  invalidToken: jest.fn(),
  saveGoTrueAuth: jest.fn(() => true),
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
  isLocalDevelopment: () => false,
}));

const baseURL = 'https://cloud.example.com/cloud';
const header = 'X-AppFlowy-Error-Schema';
const mediaRange = 'application/json; appflowy-error-schema=1';

// Match the intended origin and endpoint while allowing protocol query parameters.
function matchRequestUrl(url: string, requestBaseURL = baseURL): RegExp {
  const uri = axios.getUri({ url, baseURL: requestBaseURL });

  return new RegExp(`^${uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`);
}

function advertisedSchema(request: AxiosRequestConfig): string | undefined {
  return request.headers?.get?.('Accept')?.toString().split(',').some((value) => value.trim() === mediaRange) ? '1' : undefined;
}
const capable = {
  status: 'available',
  info: { enable_page_history: true, supported_error_schema_version: 1 },
} as ServerInfoState;

describe('Cloud error capability negotiation through real Axios requests', () => {
  const mock = new MockAdapter(axios);

  beforeAll(() => {
    global.TextDecoder = TextDecoder as typeof global.TextDecoder;
    global.TextEncoder = TextEncoder as typeof global.TextEncoder;
    initAPIService({ baseURL, gotrueURL: 'https://auth.example.com/gotrue', wsURL: 'wss://cloud.example.com/ws' });
  });

  beforeEach(() => {
    mock.reset();
    clearHttpResponseCaches();
    updateServerInfo(baseURL, capable);
    i18next.language = 'en';
  });

  afterEach(() => {
    for (const request of [...mock.history.get, ...mock.history.post, ...mock.history.put]) {
      expect(request.headers?.get?.(header)).toBeUndefined();
    }
  });

  afterAll(() => mock.restore());

  it.each([
    { status: 'loading' },
    { status: 'unavailable' },
    { status: 'unsupported' },
    { status: 'available', info: { enable_page_history: true } },
    { status: 'available', info: { enable_page_history: true, supported_error_schema_version: 2 } },
    { status: 'available', info: { enable_page_history: true, supported_error_schema_version: '1' } },
  ])('keeps legacy servers usable without changing Accept: %j', async (state) => {
    updateServerInfo(baseURL, state as ServerInfoState);
    mock.onGet(matchRequestUrl('/api/user/verify/token')).reply(200, { code: 0, data: { is_new: false } });

    await expect(verifyToken('token')).resolves.toEqual({ is_new: false });
    expect(advertisedSchema(mock.history.get[0])).toBeUndefined();
    expect(mock.history.get[0].headers?.get?.('Accept')).toBe('application/json, text/plain, */*');
  });

  it.each([
    'application/pdf',
    'application/octet-stream, application/json',
    'application/pdf; profile="example,a", application/octet-stream',
  ])('preserves existing Accept media ranges and adds only one offer: %s', async (accept) => {
    mock.onGet(matchRequestUrl('/api/workspace')).reply(200, { code: 0, data: {} });
    await getAxios()?.get('/api/workspace', { headers: { Accept: `${accept}, ${mediaRange}, ${mediaRange}` } });
    expect(mock.history.get[0].headers?.get?.('Accept')).toBe(`${accept}, ${mediaRange}`);
    expect(new TextEncoder().encode(String(mock.history.get[0].headers?.get?.('Accept'))).length).toBeLessThanOrEqual(128);
  });

  it('keeps long and explicitly disabled Accept headers unchanged', async () => {
    mock.onGet(matchRequestUrl('/api/workspace')).reply(200, { code: 0, data: {} });
    const accept = `application/pdf; profile=${'a'.repeat(95)}`;

    await getAxios()?.get('/api/workspace', { headers: { Accept: accept } });
    expect(mock.history.get[0].headers?.get?.('Accept')).toBe(accept);
    await getAxios()?.get('/api/workspace', { headers: { Accept: false } });
    expect(mock.history.get[1].headers?.get?.('Accept')).toBe(false);
    await getAxios()?.get('/api/workspace', { headers: { Accept: ['application/pdf', 'application/octet-stream'] } });
    expect(mock.history.get[2].headers?.get?.('Accept')).toEqual(['application/pdf', 'application/octet-stream']);
  });

  it('opts in after discovery and removes stale offers after server rollback', async () => {
    mock.onGet(matchRequestUrl('/api/user/verify/token')).reply(200, { code: 0, data: { is_new: false } });
    await verifyToken('token');
    expect(advertisedSchema(mock.history.get[0])).toBe('1');

    updateServerInfo(baseURL, { status: 'available', info: { enable_page_history: true } });
    await getAxios()?.get('/api/user/verify/token', { headers: new AxiosHeaders({ [header]: '1', Accept: `application/pdf, ${mediaRange}` }) });
    expect(advertisedSchema(mock.history.get[1])).toBeUndefined();
    expect(mock.history.get[1].headers?.get?.('Accept')).toBe('application/pdf');
    expect(mock.history.get[1].headers?.get?.(header)).toBeUndefined();
  });

  it('does not reuse capability state from another server', async () => {
    updateServerInfo('https://other.example.com', capable);
    mock.onGet(matchRequestUrl('/api/user/verify/token')).reply(200, { code: 0, data: { is_new: false } });
    await verifyToken('token');
    expect(advertisedSchema(mock.history.get[0])).toBeUndefined();
  });

  it.each([
    ['/api/server-info', undefined, undefined],
    ['/api/server-info/auth-providers', undefined, undefined],
    ['/gotrue/token', undefined, undefined],
    ['/billing/subscription', undefined, undefined],
    ['https://storage.example.com/api/object?X-Amz-Signature=example', undefined, undefined],
    ['/api/workspace', 'https://other.example.com', undefined],
    ['https://cloud.example.com/api/workspace', undefined, undefined],
    ['https://cloud.example.com/cloud/api/workspace', undefined, '1'],
    ['/api/workspace', undefined, '1'],
  ])('scopes opt-in to Cloud APIs: %s (base %s)', async (url, overrideBaseURL, expected) => {
    mock.onGet(matchRequestUrl(url, overrideBaseURL)).reply(200, { code: 0, data: {} });
    await getAxios()?.get(url, overrideBaseURL ? { baseURL: overrideBaseURL } : undefined);
    expect(advertisedSchema(mock.history.get[0])).toBe(expected);
  });

  it('never adds the capability to GoTrue password or signed upload requests', async () => {
    mock.onPost('/recover').reply(200, {});
    await forgotPassword({ email: 'test@example.com', redirectTo: 'https://web.example.com' });
    const signedURL = 'https://storage.example.com/file?X-Amz-Signature=example';

    mock.onPut(signedURL).reply(200);
    await uploadImportFile(signedURL, new File(['zip'], 'import.zip'), jest.fn());
    expect(advertisedSchema(mock.history.post[0])).toBeUndefined();
    expect(advertisedSchema(mock.history.put[0])).toBeUndefined();
  });

  it.each([
    { schema_version: 1, reason: 'PERMISSION_DENIED', message: 'Ask your workspace owner.', locale: 'en' },
    { schema_version: 2, reason: 'PERMISSION_DENIED', message: 'Do not show future metadata.', locale: 'en' },
    { schema_version: 1, reason: 42, message: ['invalid'] },
    null,
    'not metadata',
    [1, 2, 3],
  ])('keeps failure identity and subsequent requests usable for %j', async (user_error) => {
    const payload = { code: 1012, message: 'private permission diagnostic', retry_after_secs: 11, user_error };

    mock.onPost(matchRequestUrl('/api/workspace')).reply(403, payload, { 'retry-after': '7', 'x-request-id': 'permission-123' });
    const request = executeAPIRequest(() => getAxios()?.post('/api/workspace'));

    await expect(request).rejects.toMatchObject({
      code: 1012, diagnosticMessage: payload.message, httpStatus: 403,
      requestId: 'permission-123', retryAfterSecs: 7, user_error,
    });
    const error = await request.catch((value: { message: string }) => value);

    if (user_error && !Array.isArray(user_error) && typeof user_error === 'object' && user_error.schema_version === 1 && typeof user_error.reason === 'string') {
      expect(error).toMatchObject({ message: expect.stringContaining('Ask your workspace owner.') });
    } else {
      expect(error).toMatchObject({ message: expect.stringContaining('permission') });
      expect(error).not.toMatchObject({ message: expect.stringContaining('Do not show future metadata.') });
    }

    expect(mock.history.post).toHaveLength(1);
    expect(advertisedSchema(mock.history.post[0])).toBe('1');
    mock.onPost(matchRequestUrl('/api/workspace')).reply(200, { code: 0, data: { recovered: true } });
    await expect(executeAPIRequest(() => getAxios()?.post('/api/workspace'))).resolves.toEqual({ recovered: true });
  });

  it('opts binary publishing and downloads in while preserving fallback and retry details', async () => {
    const payload = {
      code: 1073, message: 'private export diagnostic', retry_after_secs: 3,
      user_error: { schema_version: 99, reason: 'FUTURE', message: 'Do not show.' },
    };

    mock.onPost(matchRequestUrl('/api/workspace/workspace/publish')).reply(200, payload);
    await expect(publishCollabs('workspace', [])).rejects.toMatchObject({ code: 1073, retryAfterSecs: 3 });
    expect(advertisedSchema(mock.history.post[0])).toBe('1');
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

    blob.text = async () => JSON.stringify(payload);
    mock.onPost(matchRequestUrl('/api/export/view/workspace/view/pdf')).reply(503, blob, {
      'content-type': 'application/json', 'retry-after': '7', 'x-request-id': 'export-123',
    });
    await expect(getViewPdfBlob('workspace', 'view')).rejects.toMatchObject({
      code: 1073, diagnosticMessage: payload.message, httpStatus: 503, retryAfterSecs: 7, requestId: 'export-123',
    });
    expect(advertisedSchema(mock.history.post[1])).toBe('1');
    expect(mock.history.post).toHaveLength(2);
  });
});
