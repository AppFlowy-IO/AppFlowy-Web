import { fireEvent, render, screen } from '@testing-library/react';

import { McpClientAvatar } from '../McpClientAvatar';
import { McpClientIdentity } from '../McpClientIdentity';
import { McpScopeBadge } from '../McpScopeBadge';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const claude = {
  client_name: 'Claude',
  client_host: 'claude.ai',
  client_kind: 'cimd' as const,
  loopback_only: false,
  logo_uri: 'https://claude.ai/logo.png',
  // Named by its own client ID document, not by the catalog.
  app_name: null,
  verified_app: false,
  identity_verified: false,
};

describe('McpClientIdentity', () => {
  it('shows a verified CIMD client with its host', () => {
    render(<McpClientIdentity client={claude} />);

    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('Claude');
    expect(screen.getByTestId('mcp-client-identity-host').textContent).toBe('claude.ai');
    expect(screen.getByTestId('mcp-client-verified-badge').textContent).toBe('settings.mcp.verified');
    expect(screen.queryByTestId('mcp-client-unverified-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-local-badge')).toBeNull();
  });

  it('marks a self-registered local app as not verified and running on this computer', () => {
    render(
      <McpClientIdentity
        client={{
          client_name: null,
          client_host: 'localhost',
          client_kind: 'dcr',
          loopback_only: true,
          logo_uri: null,
          app_name: null,
          verified_app: false,
          identity_verified: false,
        }}
      />
    );

    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('localhost');
    expect(screen.queryByTestId('mcp-client-identity-host')).toBeNull();
    expect(screen.getByTestId('mcp-client-unverified-badge').textContent).toBe('settings.mcp.unverified');
    expect(screen.getByTestId('mcp-client-unverified-badge').getAttribute('tabindex')).toBe('0');
    expect(screen.getByTestId('mcp-client-local-badge').textContent).toBe('settings.mcp.localApp');
  });

  it('names a recognized web app from the catalog and marks it verified', () => {
    render(
      <McpClientIdentity
        client={{
          client_name: 'claude-connector',
          client_host: 'claude.ai',
          client_kind: 'dcr',
          loopback_only: false,
          logo_uri: null,
          app_name: 'Claude',
          verified_app: true,
          identity_verified: true,
        }}
      />
    );

    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('Claude');
    expect(screen.getByTestId('mcp-client-identity-host').textContent).toBe('claude.ai');
    expect(screen.getByTestId('mcp-client-verified-app-badge').textContent).toBe('settings.mcp.verifiedApp');
    expect(screen.getByTestId('mcp-client-verified-app-badge').getAttribute('tabindex')).toBe('0');
    expect(screen.queryByTestId('mcp-client-native-app-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-unverified-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-verified-badge')).toBeNull();
  });

  it('names a recognized app that runs on the computer from the catalog, without calling it verified', () => {
    // Any program on the computer can register Cursor's callbacks or claim Claude Code's document.
    const { rerender } = render(
      <McpClientIdentity
        client={{
          client_name: 'cursor-vscode-mcp',
          client_host: 'www.cursor.com',
          client_kind: 'dcr',
          loopback_only: false,
          logo_uri: null,
          app_name: 'Cursor',
          verified_app: true,
          identity_verified: false,
        }}
      />
    );

    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('Cursor');
    expect(screen.getByTestId('mcp-client-identity-host').textContent).toBe('www.cursor.com');
    expect(screen.getByTestId('mcp-client-native-app-badge').textContent).toBe('settings.mcp.localApp');
    expect(screen.getByTestId('mcp-client-native-app-badge').getAttribute('tabindex')).toBe('0');
    expect(screen.queryByTestId('mcp-client-verified-app-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-unverified-badge')).toBeNull();

    // A loopback-only one says so once, and never gets a verified badge either.
    rerender(
      <McpClientIdentity
        client={{
          client_name: 'Claude Code',
          client_host: 'claude.ai',
          client_kind: 'cimd',
          loopback_only: true,
          logo_uri: null,
          app_name: 'Claude Code',
          verified_app: true,
          identity_verified: false,
        }}
      />
    );
    expect(screen.getByTestId('mcp-client-native-app-badge')).toBeTruthy();
    expect(screen.queryByTestId('mcp-client-local-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-verified-app-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-verified-badge')).toBeNull();
  });

  it('ignores a catalog name the server did not verify', () => {
    render(
      <McpClientIdentity
        client={{
          client_name: 'Totally Cursor',
          client_host: 'evil.example',
          client_kind: 'dcr',
          loopback_only: false,
          logo_uri: null,
          app_name: 'Cursor',
          verified_app: false,
          identity_verified: false,
        }}
      />
    );

    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('Totally Cursor');
    expect(screen.getByTestId('mcp-client-unverified-badge')).toBeTruthy();
    expect(screen.queryByTestId('mcp-client-verified-app-badge')).toBeNull();
  });

  it('shows only the publisher in the publisher variant: the host, and a verified app only when proven', () => {
    // A catalog app on the user's computer: no catalog name, no "Runs on your computer" here.
    const claudeCode = {
      client_name: 'Claude Code',
      client_host: 'claude.ai',
      client_kind: 'cimd' as const,
      loopback_only: true,
      logo_uri: null,
      app_name: 'Claude Code',
      verified_app: true,
      identity_verified: false,
    };
    const { rerender } = render(<McpClientIdentity variant='publisher' client={claudeCode} />);

    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('claude.ai');
    expect(screen.queryByTestId('mcp-client-identity-host')).toBeNull();
    expect(screen.getByTestId('mcp-client-verified-badge')).toBeTruthy();
    expect(screen.queryByTestId('mcp-client-native-app-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-local-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-verified-app-badge')).toBeNull();

    rerender(<McpClientIdentity variant='publisher' client={{ ...claudeCode, client_kind: 'dcr' }} />);
    expect(screen.getByTestId('mcp-client-unverified-badge')).toBeTruthy();
    expect(screen.queryByTestId('mcp-client-native-app-badge')).toBeNull();

    rerender(
      <McpClientIdentity
        variant='publisher'
        client={{ ...claudeCode, loopback_only: false, app_name: 'Claude', identity_verified: true }}
      />
    );
    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('claude.ai');
    expect(screen.getByTestId('mcp-client-verified-app-badge')).toBeTruthy();
  });

  it('names an unknown client without badges', () => {
    render(<McpClientIdentity client={null} />);

    expect(screen.getByTestId('mcp-client-identity-name').textContent).toBe('settings.mcp.unknownApp');
    expect(screen.queryByTestId('mcp-client-verified-badge')).toBeNull();
    expect(screen.queryByTestId('mcp-client-unverified-badge')).toBeNull();
  });
});

describe('McpClientAvatar', () => {
  it('loads only http(s) logos without a referrer and falls back to the initial on error', () => {
    const { container } = render(<McpClientAvatar client={claude} />);
    const image = container.querySelector('img');

    expect(image?.getAttribute('src')).toBe('https://claude.ai/logo.png');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('mcp-client-avatar').textContent).toBe('C');
  });

  it('never loads a script URL as a logo', () => {
    const { container } = render(
      <McpClientAvatar
        client={{
          client_name: null,
          client_host: 'evil.example',
          logo_uri: 'javascript:alert(1)',
          app_name: null,
          verified_app: false,
        }}
      />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('mcp-client-avatar').textContent).toBe('E');
  });
});

describe('McpScopeBadge', () => {
  it.each([
    [null, 'read', 'settings.mcp.scopeRead'],
    ['read', 'read', 'settings.mcp.scopeRead'],
    ['read write', 'write', 'settings.mcp.scopeWrite'],
    ['read write admin', 'full', 'settings.mcp.scopeFull'],
  ])('labels %p as %s', (scope, level, label) => {
    render(<McpScopeBadge scope={scope} />);

    expect(screen.getByTestId('mcp-scope-badge').getAttribute('data-level')).toBe(level);
    expect(screen.getByTestId('mcp-scope-badge').textContent).toBe(label);
  });
});
