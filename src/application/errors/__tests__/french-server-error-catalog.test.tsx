import { act, cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import enTranslations from '@/@types/translations/en.json';
import { WEB_CLIENT_VERSION } from '@/application/compatibility/client-version';
import { getAxios, initAPIService } from '@/application/services/js-services/http/core';
import { ElementFallbackRender } from '@/components/error/ElementFallbackRender';
import { useServerErrorCatalog } from '@/components/main/hooks/useServerErrorCatalog';
import { useAppLanguage } from '@/components/main/useAppLanguage';
import { updateServerInfo } from '@/utils/server-info';

const serverUrl = 'https://test.appflowy.cloud';
const frenchMessage = 'D’autres exportations sont en cours. Attendez que l’une d’elles se termine.';
const englishMessage = 'Wait for the current server export to finish.';
const error = Object.freeze({ code: 1073, message: 'private export diagnostic', retryAfterSecs: 17 });
const originalFetch = global.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

function catalogResponse(locale: string): Response {
  const french = locale.split('-')[0] === 'fr';
  const body = new TextEncoder().encode(JSON.stringify({
    code: 0,
    data: {
      schema_version: 1,
      locale: french ? 'fr' : 'en',
      reasons: { EXPORT_BUSY: french ? frenchMessage : englishMessage },
      codes: { '1073': 'EXPORT_BUSY' },
    },
  }));

  return {
    status: 200,
    headers: { get: (name: string) => name === 'etag' ? `W/"${french ? 'fr' : 'en'}"` : null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }),
  } as unknown as Response;
}

function App({ savedLanguage, failure = error }: { savedLanguage?: string; failure?: unknown }) {
  useAppLanguage(savedLanguage);
  useServerErrorCatalog(serverUrl);
  return <ElementFallbackRender error={failure} resetErrorBoundary={jest.fn()} />;
}

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

beforeAll(() => {
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
  global.TextEncoder = TextEncoder as typeof global.TextEncoder;
});

beforeEach(async () => {
  jest.useFakeTimers();
  // Deliberately omit French UI resources: the app may fall back to English
  // while the server has a complete translation for the selected language.
  await i18next.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: enTranslations } } });
  jest.spyOn(window.navigator, 'language', 'get').mockReturnValue('de-DE');
  fetchMock.mockReset().mockImplementation(async (request) => {
    return catalogResponse(new URL(String(request)).searchParams.get('locale') ?? 'en');
  });
  global.fetch = fetchMock;
  updateServerInfo(serverUrl, { status: 'loading' });
});

afterEach(() => {
  cleanup();
  expect(jest.getTimerCount()).toBe(0);
  global.fetch = originalFetch;
  updateServerInfo(serverUrl, { status: 'loading' });
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each(['fr', 'fr-FR', 'fr-CA'])(
  'requests and displays French for the saved %s preference even with English UI fallback', async (locale) => {
    render(<I18nextProvider i18n={i18next}><App savedLanguage={locale} /></I18nextProvider>);
    await settle();

    expect(i18next.language).toBe(locale);
    expect(i18next.resolvedLanguage).toBe('en');
    const [request, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const url = new URL(String(request));

    expect(url.origin + url.pathname).toBe(`${serverUrl}/api/error-messages`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      schema_version: '1', platform: 'web', client_version: WEB_CLIENT_VERSION, locale: locale.toLowerCase(),
    });
    expect(options?.credentials).toBe('omit');
    expect(screen.getByRole('alert').textContent).toContain(frenchMessage);
    expect(screen.queryByText(/private export diagnostic/)).toBeNull();
    expect(error).toEqual({ code: 1073, message: 'private export diagnostic', retryAfterSecs: 17 });

    initAPIService({ baseURL: serverUrl, gotrueURL: `${serverUrl}/gotrue`, wsURL: 'wss://test.appflowy.cloud/ws' });
    const response = await getAxios()!.get('/api/workspace', {
      adapter: async (config) => ({ config, status: 200, statusText: 'OK', data: {}, headers: {} }),
    });

    expect(response.config.headers.get('Accept-Language')).toBe(locale);
  },
);

it('uses the French catalog when the original error contains English per-response metadata', async () => {
  const metadata = Object.freeze({
    schema_version: 1, reason: 'EXPORT_BUSY', message: 'English per-response guidance.', locale: 'en',
  });
  const failure = Object.freeze({ ...error, user_error: metadata });

  render(<I18nextProvider i18n={i18next}><App savedLanguage='fr-FR' failure={failure} /></I18nextProvider>);
  await settle();
  expect(screen.getByRole('alert').textContent).toContain(frenchMessage);
  expect(screen.queryByText(metadata.message)).toBeNull();
  expect(failure.user_error).toBe(metadata);
  expect(failure.retryAfterSecs).toBe(17);
});

it('switches a visible error with the selected language without reusing another locale’s ETag', async () => {
  render(<I18nextProvider i18n={i18next}><App savedLanguage='fr-FR' /></I18nextProvider>);
  await settle();
  expect(screen.getByRole('alert').textContent).toContain(frenchMessage);

  for (const [locale, message] of [['en', englishMessage], ['fr-CA', frenchMessage]]) {
    fetchMock.mockClear();
    await act(async () => { await i18next.changeLanguage(locale); });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request, options] = fetchMock.mock.calls[0];

    expect(new URL(String(request)).searchParams.get('locale')).toBe(locale.toLowerCase());
    expect(options?.headers).toEqual({ Accept: 'application/json' });
    expect(screen.getByRole('alert').textContent).toContain(message);
  }
});
