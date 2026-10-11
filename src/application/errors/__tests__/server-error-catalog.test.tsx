import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import i18next, { TFunction } from 'i18next';
import { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import { WEB_CLIENT_VERSION } from '@/application/compatibility/client-version';
import { ERROR_CODE } from '@/application/constants';
import { handleAPIResponseError } from '@/application/services/js-services/http/core';
import { ElementFallbackRender } from '@/components/error/ElementFallbackRender';
import { isViewGoneError } from '@/components/editor/components/blocks/database/utils/databaseBlockUtils';
import { useServerErrorCatalog } from '@/components/main/hooks/useServerErrorCatalog';
import { getLandingPageErrorContent } from '@/components/_shared/landing-page/errorContent';
import { getErrorMessage } from '@/utils/errors';
import { updateServerInfo } from '@/utils/server-info';

import { getErrorDiagnostic, userFriendlyErrorMessage } from '../error-message';
import localCatalog from '../shared-error-catalog.json';
import {
  ERROR_CATALOG_MAX_BYTES,
  ERROR_CATALOG_REFRESH_MS,
  ERROR_CATALOG_TIMEOUT_MS,
  getServerErrorCatalog,
  retainServerErrorCatalog,
} from '../server-error-catalog';

const serverUrl = 'https://test.appflowy.cloud';
const originalFetch = global.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
let releases: Array<() => void>;
let previousLocale: { language: string; resolvedLanguage: string | undefined; isInitialized: boolean };

function catalogEnvelope(message = 'Wait for the current server export to finish.', locale = 'en') {
  return {
    code: 0,
    data: {
      schema_version: 1, locale,
      reasons: { EXPORT_BUSY: message, FUTURE_REASON: 'The server explains this new failure.' },
      codes: { '1073': 'EXPORT_BUSY', '9001': 'EXPORT_BUSY', '9002': 'FUTURE_REASON' },
    },
  };
}

function responseBody(chunks: Uint8Array[], status = 200, contentLength?: string) {
  const cancel = jest.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  });
  const response = {
    status, body,
    headers: { get: (name: string) => name === 'content-length' ? contentLength ?? null : null },
  } as unknown as Response;

  return { response, cancel };
}

function jsonResponse(value: unknown, status = 200): Response {
  return responseBody([new TextEncoder().encode(JSON.stringify(value))], status).response;
}

function retain(locale = 'en', url = serverUrl): () => void {
  const release = retainServerErrorCatalog(url, locale);

  releases.push(release);
  return release;
}

async function settle(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function revalidate(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
    window.dispatchEvent(new Event('focus'));
  });
  await settle();
}

beforeAll(() => {
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
  global.TextEncoder = TextEncoder as typeof global.TextEncoder;
});

beforeEach(() => {
  jest.useFakeTimers();
  releases = [];
  fetchMock.mockReset().mockResolvedValue(jsonResponse(catalogEnvelope()));
  global.fetch = fetchMock;
  previousLocale = { language: i18next.language, resolvedLanguage: i18next.resolvedLanguage, isInitialized: i18next.isInitialized };
  Object.assign(i18next, { language: 'en', resolvedLanguage: 'en' });
  updateServerInfo(serverUrl, { status: 'loading' });
});

afterEach(() => {
  cleanup();
  releases.forEach((release) => release());
  expect(jest.getTimerCount()).toBe(0);
  Object.assign(i18next, previousLocale);
  updateServerInfo(serverUrl, { status: 'loading' });
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('requests the standalone public endpoint with actual version and no credentials or storage', async () => {
  jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage access denied', 'SecurityError');
  });
  retain('en-US', `${serverUrl}/cloud`);
  await settle();
  const [request, options] = fetchMock.mock.calls[0];
  const url = new URL(String(request));

  expect(url.origin + url.pathname).toBe(`${serverUrl}/cloud/api/error-messages`);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    schema_version: '1', platform: 'web', client_version: WEB_CLIENT_VERSION, locale: 'en-us',
  });
  expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
  expect(getServerErrorCatalog('en-US', `${serverUrl}/cloud`)?.reasons.EXPORT_BUSY).toContain('current server export');
});

it('updates an existing React fallback when server wording changes without changing the bundled catalog or error', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage access denied', 'SecurityError');
  });
  const originalCopy = localCatalog.reasons.EXPORT_BUSY;
  const error = Object.freeze({ code: 1073, message: 'private export diagnostic', retryAfterSecs: 17 });

  retain();
  await settle();
  render(<ElementFallbackRender error={error} resetErrorBoundary={jest.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('Wait for the current server export to finish.');

  fetchMock.mockResolvedValue(jsonResponse(catalogEnvelope('This server now allows only one export at a time.')));
  await revalidate();
  expect(screen.getByRole('alert').textContent).toContain('This server now allows only one export at a time.');
  expect(screen.queryByText(/private export diagnostic/)).toBeNull();
  expect(localCatalog.reasons.EXPORT_BUSY).toBe(originalCopy);
  expect(error).toEqual({ code: 1073, message: 'private export diagnostic', retryAfterSecs: 17 });
});

it('keeps server quota instructions without appending conflicting Pro or administrator remedies', async () => {
  const message = 'This server has paused uploads while storage is maintained. Please try later.';

  fetchMock.mockResolvedValue(jsonResponse({
    code: 0,
    data: {
      schema_version: 1, locale: 'en', reasons: { STORAGE_MAINTENANCE: message },
      codes: { [String(ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED)]: 'STORAGE_MAINTENANCE' },
    },
  }));
  retain();
  await settle();
  const error = { code: ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED, message: 'private storage diagnostic' };

  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: false } });
  expect(getErrorMessage(error)).toBe(message);
  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: true } });
  const t = ((_key: string, fallback: string) => fallback) as TFunction;

  expect(getLandingPageErrorContent(error, t).description).toBe(message);
});

it('does not append an old quota remedy when a server code remapping uses an app translation', async () => {
  const envelope = catalogEnvelope();

  fetchMock.mockResolvedValue(jsonResponse({
    ...envelope,
    data: { ...envelope.data, codes: { [String(ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED)]: 'EXPORT_BUSY' } },
  }));
  retain('de');
  await settle();
  Object.assign(i18next, { language: 'de', resolvedLanguage: 'de', isInitialized: true });
  jest.spyOn(i18next, 't').mockImplementation(((key: string, options: { defaultValue: string }) =>
    key === 'userError.EXPORT_BUSY' ? 'Andere Exporte werden ausgeführt.' : options.defaultValue) as TFunction);
  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: false } });

  expect(getErrorMessage({ code: ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED })).toBe('Andere Exporte werden ausgeführt.');
});

it('resolves new Cloud codes and preserves stronger per-response metadata', async () => {
  retain();
  await settle();
  expect(userFriendlyErrorMessage({ code: 9001 })).toBe('Wait for the current server export to finish.');
  expect(userFriendlyErrorMessage({ code: 9002 })).toBe('The server explains this new failure.');
  expect(userFriendlyErrorMessage({ code: 1073, user_error: {
    schema_version: 1, reason: 'EXPORT_BUSY', message: 'This particular export needs more time.', locale: 'en',
  } })).toBe('This particular export needs more time.');
});

it.each(['http', 'gotrue', 'transport', 'client'] as const)('does not apply Cloud code mappings to the %s namespace', async (sourceDomain) => {
  retain();
  await settle();
  const message = userFriendlyErrorMessage({ code: 9001, sourceDomain, message: 'private diagnostic' });

  expect(message).not.toContain('current server export');
  expect(message).not.toContain('private diagnostic');
});

it('uses language-independent new-code mappings while retaining app translations until server copy matches', async () => {
  retain('de-DE');
  await settle();
  const t = ((key: string, options: { defaultValue: string }) =>
    key === 'userError.EXPORT_BUSY' ? 'Andere Exporte werden ausgeführt.' : options.defaultValue) as TFunction;

  expect(userFriendlyErrorMessage({ code: 9001 }, { locale: 'de-DE', t })).toBe('Andere Exporte werden ausgeführt.');
  expect(userFriendlyErrorMessage({ code: 9002 }, { locale: 'de-DE', t })).not.toContain('The server explains');
  fetchMock.mockResolvedValue(jsonResponse(catalogEnvelope('Warte auf den Export dieses Servers.', 'de')));
  await revalidate();
  expect(userFriendlyErrorMessage({ code: 9001 }, { locale: 'de-DE', t })).toBe('Warte auf den Export dieses Servers.');
});

it('keeps specific legacy Cloud diagnoses ahead of the full catalog generic code mapping', async () => {
  fetchMock.mockResolvedValue(jsonResponse({
    code: 0,
    data: {
      schema_version: 1, locale: 'en', reasons: localCatalog.reasons,
      codes: Object.fromEntries(Object.entries(localCatalog.codes).filter(([code]) => code !== '0').map(([code, info]) => [code, info.reason])),
    },
  }));
  retain();
  await settle();
  expect(getServerErrorCatalog('en')).toBeDefined();
  expect(userFriendlyErrorMessage({ code: 1008, message: 'space must keep at least one explicit owner' })).toBe(localCatalog.reasons.SPACE_OWNER_REQUIRED);
  expect(userFriendlyErrorMessage({ code: 1017, message: 'af_inline_comment violates af_inline_comment_oid_fkey' })).toBe(localCatalog.reasons.COMMENT_DOCUMENT_SYNC_REQUIRED);
  expect(userFriendlyErrorMessage({ code: 1003, message: 'Invalid login credentials' })).toBe(localCatalog.reasons.SIGN_IN_CREDENTIALS);
});

it('preserves HTTP identity and diagnostic-driven recovery when catalog copy mentions something else', async () => {
  fetchMock.mockResolvedValue(jsonResponse({
    code: 0,
    data: { schema_version: 1, locale: 'en', reasons: { REQUEST_PROBLEM: 'Contact the page owner.' }, codes: { '-1': 'REQUEST_PROBLEM' } },
  }));
  retain();
  await settle();
  const error = handleAPIResponseError({
    status: 400, headers: { 'retry-after': '7', 'x-request-id': 'view-123' },
    data: { code: -1, message: 'View not found', retry_after_secs: 11 },
  });

  expect(error).toMatchObject({ code: -1, httpStatus: 400, retryAfterSecs: 7, requestId: 'view-123', message: 'Contact the page owner.' });
  expect(getErrorDiagnostic(error)).toBe('View not found');
  expect(isViewGoneError(error)).toBe(true);
});

it.each([204, 404, 500])('clears loaded copy and leaves rendering usable when the catalog responds %s', async (status) => {
  retain();
  await settle();
  render(<ElementFallbackRender error={{ code: 1073 }} resetErrorBoundary={jest.fn()} />);
  fetchMock.mockResolvedValue(jsonResponse(undefined, status));
  await revalidate();
  expect(getServerErrorCatalog('en')).toBeUndefined();
  expect(screen.getByRole('alert').textContent).toContain(localCatalog.reasons.EXPORT_BUSY);
});

it('treats an offline catalog fetch as an optional failure', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network unavailable'));
  retain();
  await settle();
  expect(getServerErrorCatalog('en')).toBeUndefined();
  expect(userFriendlyErrorMessage({ code: 1073 })).toBe(localCatalog.reasons.EXPORT_BUSY);
});

it.each([
  { schema_version: 2 },
  { locale: 'en\nUS' },
  { reasons: {} },
  { reasons: { EXPORT_BUSY: 'a'.repeat(1025) } },
  { reasons: { EXPORT_BUSY: 'bad\ncopy' } },
  { reasons: { 'invalid-reason': 'Copy' } },
  { reasons: Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`REASON_${index}`, 'Copy'])) },
  { codes: { '0': 'EXPORT_BUSY' } },
  { codes: { '2147483648': 'EXPORT_BUSY' } },
  { codes: { '01': 'EXPORT_BUSY' } },
  { codes: { '1073': 'MISSING_REASON' } },
  { codes: Object.fromEntries(Array.from({ length: 513 }, (_, index) => [String(index + 1), 'EXPORT_BUSY'])) },
])('rejects an invalid optional catalog without affecting normal errors: %j', async (changes) => {
  const envelope = catalogEnvelope();

  fetchMock.mockResolvedValue(jsonResponse({ ...envelope, data: { ...envelope.data, ...changes } }));
  retain();
  await settle();
  expect(getServerErrorCatalog('en')).toBeUndefined();
  expect(userFriendlyErrorMessage({ code: 1073 })).toBe(localCatalog.reasons.EXPORT_BUSY);
});

it.each([true, false])('cancels oversized catalog responses with declared length=%s', async (declared) => {
  const { response, cancel } = responseBody([
    new Uint8Array(ERROR_CATALOG_MAX_BYTES).fill(32),
    new TextEncoder().encode('{}'),
    new Uint8Array(100),
  ], 200, declared ? String(ERROR_CATALOG_MAX_BYTES + 1) : undefined);

  fetchMock.mockResolvedValue(response);
  retain();
  await settle();
  expect(cancel).toHaveBeenCalled();
  expect(getServerErrorCatalog('en')).toBeUndefined();
});

it('rejects malformed JSON and UTF-8 within the size cap', async () => {
  fetchMock.mockResolvedValue(responseBody([new TextEncoder().encode('{broken')]).response);
  retain();
  await settle();
  expect(getServerErrorCatalog('en')).toBeUndefined();
  fetchMock.mockResolvedValue(responseBody([new Uint8Array([0xff])]).response);
  await revalidate();
  expect(getServerErrorCatalog('en')).toBeUndefined();
});

it('accepts an exactly bounded catalog with UTF-8 characters split across stream chunks', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(catalogEnvelope('Wärte auf den Export.')));
  const split = bytes.findIndex((byte) => byte >= 128) + 1;
  const padding = new Uint8Array(ERROR_CATALOG_MAX_BYTES - bytes.byteLength).fill(32);

  fetchMock.mockResolvedValue(responseBody([bytes.slice(0, split), bytes.slice(split), padding], 200, String(ERROR_CATALOG_MAX_BYTES)).response);
  retain();
  await settle();
  expect(getServerErrorCatalog('en')?.reasons.EXPORT_BUSY).toBe('Wärte auf den Export.');
});

it('deduplicates owners, refreshes on schedule, and removes timers and event work on final disposal', async () => {
  const releaseFirst = retain();
  const releaseSecond = retain();

  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  releaseFirst();
  fetchMock.mockResolvedValue(jsonResponse(catalogEnvelope('Refreshed copy')));
  await act(async () => { await jest.advanceTimersByTimeAsync(ERROR_CATALOG_REFRESH_MS); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(getServerErrorCatalog('en')?.reasons.EXPORT_BUSY).toBe('Refreshed copy');
  releaseSecond();
  expect(getServerErrorCatalog('en')).toBeUndefined();
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('focus'));
  await act(async () => { await jest.advanceTimersByTimeAsync(ERROR_CATALOG_REFRESH_MS); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  { locale: 'de', url: serverUrl },
  { locale: 'en', url: 'https://other.example.com' },
])('does not publish a late response from a previous server or locale: %j', async ({ locale, url }) => {
  let resolveOld!: (response: Response) => void;

  fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  const releaseOld = retain();
  const oldSignal = fetchMock.mock.calls[0][1]?.signal;

  fetchMock.mockResolvedValue(jsonResponse(catalogEnvelope('New configuration copy.', locale)));
  retain(locale, url);
  await settle();
  expect(oldSignal?.aborted).toBe(true);
  resolveOld(jsonResponse(catalogEnvelope('Stale copy.')));
  await settle();
  releaseOld();
  expect(getServerErrorCatalog(locale, url)?.reasons.EXPORT_BUSY).toBe('New configuration copy.');
  expect(getServerErrorCatalog('en', url === serverUrl ? serverUrl : 'https://unrelated.example.com')).toBeUndefined();
});

it('aborts a stalled request at the deadline and remains usable for the next refresh', async () => {
  fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  retain();
  const signal = fetchMock.mock.calls[0][1]?.signal;

  await act(async () => { await jest.advanceTimersByTimeAsync(ERROR_CATALOG_TIMEOUT_MS); });
  expect(signal?.aborted).toBe(true);
  expect(getServerErrorCatalog('en')).toBeUndefined();
  await revalidate();
  expect(getServerErrorCatalog('en')).toBeDefined();
});

it('cancels a response body that stalls after headers at the same request deadline', async () => {
  const cancel = jest.fn();
  const response = {
    status: 200, headers: { get: () => null }, body: new ReadableStream({ cancel }),
  } as unknown as Response;

  fetchMock.mockResolvedValueOnce(response);
  retain();
  await settle();
  await act(async () => { await jest.advanceTimersByTimeAsync(ERROR_CATALOG_TIMEOUT_MS); });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(getServerErrorCatalog('en')).toBeUndefined();
  await revalidate();
  expect(getServerErrorCatalog('en')).toBeDefined();
});

it('starts the public owner without authentication and switches locale when the app language changes', async () => {
  const i18n = i18next.createInstance();

  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} }, de: { translation: {} } } });
  const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
  const { unmount } = renderHook(() => useServerErrorCatalog(serverUrl), { wrapper });

  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getServerErrorCatalog('en')).toBeDefined();
  fetchMock.mockResolvedValue(jsonResponse(catalogEnvelope('Deutsche Meldung', 'de')));
  await act(async () => { await i18n.changeLanguage('de'); });
  await settle();
  expect(getServerErrorCatalog('en')).toBeUndefined();
  expect(getServerErrorCatalog('de')?.reasons.EXPORT_BUSY).toBe('Deutsche Meldung');
  unmount();
});
