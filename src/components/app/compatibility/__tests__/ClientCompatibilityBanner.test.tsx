import { fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import inc from 'semver/functions/inc';

import en from '@/@types/translations/en.json';
import policy from '@/application/compatibility/web-server-compatibility.json';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';

import { ClientCompatibilityProvider } from '../ClientCompatibility';
import { ClientCompatibilityBanner } from '../ClientCompatibilityBanner';

const i18n = createInstance();

// Jest injects no build version, so the banner reports the policy's reviewed version. Derive the
// fixtures from the policy so advancing it for a release does not break these tests.
const CLIENT = policy.reviewed_through_client_version;
const NEWER_CLIENT = inc(CLIENT, 'patch')!;
const NEWEST_CLIENT = inc(NEWER_CLIENT, 'patch')!;
const REQUIRED_SERVER = policy.rows[policy.rows.length - 1].min_server;

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
});

function app(info?: Partial<ServerInfo>, serverUrl = 'https://server', pageKey = 'page-a') {
  return (
    <I18nextProvider i18n={i18n}>
      <ClientCompatibilityProvider serverInfo={info && { enable_page_history: true, ...info }} serverUrl={serverUrl}>
        <ClientCompatibilityBanner key={pageKey} />
        <input aria-label='Page title' />
      </ClientCompatibilityProvider>
    </I18nextProvider>
  );
}

describe('compatibility banner', () => {
  it('shows server versions, leaves editing available, and stays dismissed across navigation and refreshes', () => {
    const view = render(app({ version: '0.17.0' }));

    expect(screen.getByRole('status').textContent).toContain(`AppFlowy Web ${CLIENT} requires server ${REQUIRED_SERVER}`);
    expect(screen.getByRole('status').textContent).toContain('Your server is 0.17.0');
    expect(screen.queryByRole('button', { name: 'Reload web app' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Still editable' } });
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Still editable');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss compatibility warning' }));
    view.rerender(app({ version: '0.17.1' }, 'https://server/', 'page-b'));
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(app(undefined));
    view.rerender(app({ version: '0.17.1' }));
    expect(screen.queryByRole('status')).toBeNull();
    view.unmount();

    render(app({ version: '0.17.1' }));
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('offers reload only when the required web client can work with the server', () => {
    const view = render(app({ version: REQUIRED_SERVER, min_web_client_version: NEWER_CLIENT }));

    expect(screen.getByRole('status').textContent).toContain(`requires AppFlowy Web ${NEWER_CLIENT}`);
    expect(screen.getByRole('button', { name: 'Reload web app' })).toBeTruthy();
    view.rerender(app({ version: '0.17.0', min_web_client_version: NEWER_CLIENT }));
    expect(screen.getByRole('status').textContent).toContain('update both');
    expect(screen.queryByRole('button', { name: 'Reload web app' })).toBeNull();
  });

  it('hides unknown data, restores confirmed demands, and clears old dismissals on compatibility', () => {
    const view = render(app({ version: '0.17.0' }));

    view.rerender(app(undefined));
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(app({ version: '0.17.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss compatibility warning' }));
    view.rerender(app({ version: REQUIRED_SERVER }));
    view.rerender(app({ version: '0.17.0' }));
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('reopens for a new demand or server and ignores native-client minimums', () => {
    const view = render(app({ version: REQUIRED_SERVER, min_web_client_version: NEWER_CLIENT }));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss compatibility warning' }));
    view.rerender(app({ version: REQUIRED_SERVER, min_web_client_version: NEWEST_CLIENT }));
    expect(screen.getByRole('status').textContent).toContain(NEWEST_CLIENT);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss compatibility warning' }));
    view.rerender(app({ version: REQUIRED_SERVER, min_web_client_version: NEWEST_CLIENT }, 'https://other-server'));
    expect(screen.getByRole('status')).toBeTruthy();
    view.rerender(app({ version: REQUIRED_SERVER, ...{ min_client_version: '0.19.0' } }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
