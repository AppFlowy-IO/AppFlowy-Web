import { act, fireEvent, render, screen, within } from '@testing-library/react';

import translations from '@/@types/translations/en.json';
import {
  buildCodexConfigToml,
  buildCursorInstallUrl,
  buildServerUrlJson,
  buildVsCodeInstallUrl,
} from '@/application/mcp/setup';
import { MCP_SETUP_APPS, type McpSetupConnection } from '@/application/mcp/setupApps';
import { buildMcpSetupPrompt } from '@/application/mcp/setupPrompt';
import { notify } from '@/components/_shared/notify';
import { copyTextToClipboard } from '@/utils/copy';

import { McpSetupGuide } from '../McpSetupGuide';

const SERVER_URL = 'https://mcp.example.com/mcp';

// Real i18next over en.json, so a name that loses RAW_INTERPOLATION shows escaped here as in the app.
jest.mock('react-i18next', () => {
  const { mcpTestT } = jest.requireActual('@/components/mcp/__tests__/mcpTestI18n');

  return { useTranslation: () => ({ t: mcpTestT }) };
});
jest.mock('@/utils/copy', () => ({ copyTextToClipboard: jest.fn() }));
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn(), error: jest.fn() } }));

const setup = translations.mcp.setup;
const copy = jest.mocked(copyTextToClipboard);

function card(app: string) {
  return screen.getByTestId(`mcp-setup-app-card-${app}`);
}

function toggle(app: string) {
  fireEvent.click(screen.getByTestId(`mcp-client-tab-${app}`));
}

async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

function openPanels() {
  return MCP_SETUP_APPS.filter((app) => screen.queryByTestId(`mcp-client-panel-${app}`));
}

function verified(appId: string, clientId = `https://${appId}.example/client.json`): McpSetupConnection {
  return { client_id: clientId, client_name: appId, app_id: appId, app_name: appId, verified_app: true };
}

// jsdom cannot navigate: keep clicks on vendor links and deeplinks from logging "Not implemented".
function preventNavigation(event: MouseEvent) {
  if ((event.target as Element | null)?.closest('a[href]')) event.preventDefault();
}

describe('McpSetupGuide', () => {
  beforeAll(() => document.addEventListener('click', preventNavigation, true));
  afterAll(() => document.removeEventListener('click', preventNavigation, true));

  beforeEach(() => {
    jest.clearAllMocks();
    copy.mockResolvedValue(undefined);
  });

  describe('server URL', () => {
    it('shows the server URL and copies it', async () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      expect(screen.getByTestId<HTMLInputElement>('mcp-endpoint-value').value).toBe(SERVER_URL);
      expect(screen.getByTestId<HTMLInputElement>('mcp-endpoint-value').readOnly).toBe(true);
      await click('mcp-copy-endpoint');
      expect(copy).toHaveBeenCalledWith(SERVER_URL);
      expect(notify.success).toHaveBeenCalledWith(setup.copied);
    });

    it('reports a copy failure', async () => {
      copy.mockRejectedValueOnce(new Error('denied'));
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      await click('mcp-copy-endpoint');
      expect(notify.error).toHaveBeenCalledWith(translations.message.copy.fail);
      expect(notify.success).not.toHaveBeenCalled();
    });
  });

  describe('setup prompt', () => {
    it('copies a prompt for this server and this deployment’s setup page', async () => {
      render(<McpSetupGuide serverUrl='https://canonical.example.com/mcp' />);

      expect(screen.getByText(setup.promptHint)).toBeTruthy();
      await click('mcp-copy-setup-prompt');
      expect(copy).toHaveBeenCalledWith(
        buildMcpSetupPrompt('https://canonical.example.com/mcp', {
          setupPageUrl: `${window.location.origin}/oauth/mcp/setup`,
        })
      );
      expect(notify.success).toHaveBeenCalledWith(setup.promptCopied);
    });
  });

  describe('gallery', () => {
    it('shows a card per app with its name and description, none expanded', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      const gallery = screen.getByTestId('mcp-setup-gallery');
      const cards = within(gallery).getAllByTestId(/^mcp-setup-app-card-/);

      expect(cards.map((element) => element.getAttribute('data-testid'))).toEqual(
        MCP_SETUP_APPS.map((app) => `mcp-setup-app-card-${app}`)
      );
      expect(within(card('claude')).getByText(setup.claude.name)).toBeTruthy();
      expect(within(card('claude')).getByText(setup.claude.description)).toBeTruthy();
      expect(within(card('windsurf')).getByText('Windsurf / Antigravity')).toBeTruthy();
      expect(within(card('other')).getByText(setup.other.name)).toBeTruthy();
      expect(openPanels()).toEqual([]);
      MCP_SETUP_APPS.forEach((app) => {
        expect(screen.getByTestId(`mcp-client-tab-${app}`).getAttribute('aria-expanded')).toBe('false');
      });
    });

    it.each(MCP_SETUP_APPS)('gives the %s card a primary action and steps', (app) => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      const actions = Array.from(card(app).querySelectorAll('a[href], button')).filter(
        (element) => element !== screen.getByTestId(`mcp-client-tab-${app}`)
      );

      expect(actions).toHaveLength(1);
      toggle(app);
      // The title, then the steps.
      expect(screen.getByTestId(`mcp-client-panel-${app}`).childElementCount).toBeGreaterThan(1);
    });

    it('expands one card’s steps at a time, right after that card, and collapses them again', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      toggle('codex');
      const button = screen.getByTestId('mcp-client-tab-codex');
      const panel = screen.getByTestId('mcp-client-panel-codex');

      expect(openPanels()).toEqual(['codex']);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.getAttribute('role')).toBe('region');
      expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Set up Codex');
      // The steps follow their card, so a dense grid opens them under the card's row.
      expect(card('codex').nextElementSibling).toBe(panel);
      expect(card('codex').getAttribute('data-selected')).toBe('true');

      toggle('cursor');
      expect(openPanels()).toEqual(['cursor']);
      expect(screen.getByTestId('mcp-client-tab-codex').getAttribute('aria-expanded')).toBe('false');

      toggle('cursor');
      expect(openPanels()).toEqual([]);
    });

    it('titles the steps with the app’s name as written', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      toggle('windsurf');
      const panel = screen.getByTestId('mcp-client-panel-windsurf');

      // Without RAW_INTERPOLATION, i18next would show the slash as `&#x2F;`.
      expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
        'Set up Windsurf / Antigravity'
      );
    });

    it('opens Claude’s connectors in a new tab and shows the steps, including Team and Enterprise', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      const link = screen.getByTestId('mcp-open-claude-connectors');

      expect(link.getAttribute('href')).toBe('https://claude.ai/customize/connectors');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      fireEvent.click(link);

      const panel = screen.getByTestId('mcp-client-panel-claude');

      expect(
        within(panel)
          .getAllByRole('listitem')
          .map((item) => item.textContent)
      ).toEqual([setup.claude.step1, setup.claude.step2, setup.claude.step3, setup.claude.step4]);
      expect(setup.claude.step1).toContain('Customize → Connectors');
      expect(setup.claude.step3).toContain("Use Claude's published identity (Recommended)");
      const team = within(panel).getByTestId('mcp-setup-team-note');

      expect(team.textContent).toContain(setup.claude.teamTitle);
      expect(team.textContent).toContain('Organization settings → Connectors → Add → Custom → Web');
    });

    it('opens ChatGPT and explains plans and Business, Enterprise and Edu workspaces', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      const link = screen.getByTestId('mcp-open-chatgpt');

      expect(link.getAttribute('href')).toBe('https://chatgpt.com/#settings');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      fireEvent.click(link);

      const panel = screen.getByTestId('mcp-client-panel-chatgpt');

      expect(within(panel).getByText(setup.chatgpt.note)).toBeTruthy();
      expect(within(panel).getByTestId('mcp-setup-team-note').textContent).toContain(setup.chatgpt.teamTitle);
    });

    it('installs in Cursor and VS Code through deeplinks, then explains signing in', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      const cursor = screen.getByTestId('mcp-install-cursor');

      expect(cursor.getAttribute('href')).toBe(buildCursorInstallUrl(SERVER_URL));
      expect(cursor.getAttribute('href')).toContain('name=appflowy&');
      fireEvent.click(cursor);
      expect(screen.getByTestId('mcp-setup-cursor-after-install').textContent).toBe(
        "After installing, open Cursor's MCP settings, find appflowy and select Connect (or Needs login) to sign in."
      );
      expect(screen.getByTestId('mcp-snippet-cursor-json').textContent).toContain(`"url": "${SERVER_URL}"`);

      const vscode = screen.getByTestId('mcp-install-vscode');

      expect(vscode.getAttribute('href')).toBe(buildVsCodeInstallUrl(SERVER_URL));
      fireEvent.click(vscode);
      expect(openPanels()).toEqual(['vscode']);
      expect(screen.getByTestId('mcp-snippet-vscode-cli').textContent).toBe(
        `code --add-mcp '{"name":"appflowy","type":"http","url":"${SERVER_URL}"}'`
      );
    });

    it.each([
      ['claude-code', `claude mcp add --transport http appflowy ${SERVER_URL}`],
      ['codex', `codex mcp add appflowy --url ${SERVER_URL}`],
      ['gemini', `gemini mcp add --transport http appflowy ${SERVER_URL}`],
      ['windsurf', buildServerUrlJson(SERVER_URL)],
      ['other', SERVER_URL],
    ])('copies %s’s setup from its card and opens the steps', async (app, text) => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      await click(`mcp-setup-app-action-${app}`);
      expect(copy).toHaveBeenCalledWith(text);
      expect(notify.success).toHaveBeenCalledWith(setup.copied);
      expect(openPanels()).toEqual([app]);
    });

    it.each([
      ['claude-code', 'claude-code', `claude mcp add --transport http appflowy ${SERVER_URL}`],
      ['codex', 'codex', `codex mcp add appflowy --url ${SERVER_URL}`],
      ['codex', 'codex-login', 'codex mcp login appflowy'],
      ['codex', 'codex-toml', buildCodexConfigToml(SERVER_URL)],
      ['gemini', 'gemini', `gemini mcp add --transport http appflowy ${SERVER_URL}`],
      ['windsurf', 'server-url-json', buildServerUrlJson(SERVER_URL)],
    ])('copies the %s snippet %s from the steps', async (app, snippet, text) => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      toggle(app);
      expect(screen.getByTestId(`mcp-snippet-${snippet}`).textContent).toBe(text);
      await click(`mcp-copy-snippet-${snippet}`);
      expect(copy).toHaveBeenCalledWith(text);
    });

    it('explains Claude Code’s scopes and how to sign in again', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      toggle('claude-code');
      const scope = screen.getByTestId('mcp-setup-claude-code-scope');

      expect(scope.textContent).toBe(
        'Add --scope user to use AppFlowy in every project, or --scope project to share it with your team through .mcp.json (each teammate still signs in).'
      );
      expect(Array.from(scope.querySelectorAll('code')).map((code) => code.textContent)).toEqual([
        '--scope user',
        '--scope project',
        '.mcp.json',
      ]);
      expect(screen.getByTestId('mcp-client-panel-claude-code').textContent).toContain(
        'To sign in again later, run /mcp, choose appflowy and select Re-authenticate.'
      );
    });

    it('offers the Codex config.toml and app paths', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      toggle('codex');
      const panel = screen.getByTestId('mcp-client-panel-codex');

      expect(panel.textContent).toContain('~/.codex/config.toml');
      expect(panel.textContent).toContain('.codex/config.toml in a project');
      expect(panel.textContent).toContain(setup.codex.app);
    });

    it('offers remote and mcp-remote configurations for other apps', async () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      toggle('other');
      expect(screen.getByTestId('mcp-snippet-remote-json').textContent).toContain(`"url": "${SERVER_URL}"`);
      await click('mcp-copy-snippet-mcp-remote-json');
      expect(copy.mock.calls[0][0]).toContain('"mcp-remote"');
    });
  });

  describe('connected apps', () => {
    it('shows nothing about connections when they are unknown or empty', () => {
      const { rerender } = render(<McpSetupGuide serverUrl={SERVER_URL} />);

      expect(screen.queryByTestId('mcp-setup-connected-apps')).toBeNull();
      expect(screen.queryByTestId(/^mcp-setup-app-connected-/)).toBeNull();

      rerender(<McpSetupGuide serverUrl={SERVER_URL} connections={[]} />);
      expect(screen.queryByTestId('mcp-setup-connected-apps')).toBeNull();
    });

    it('counts connected apps and badges the cards of recognized ones', () => {
      render(
        <McpSetupGuide
          serverUrl={SERVER_URL}
          connections={[
            verified('cursor', 'dcr-laptop'),
            verified('cursor', 'dcr-desktop'),
            verified('claude-code', 'https://claude.ai/oauth/claude-code-client-metadata'),
            { client_id: 'dcr-gemini', client_name: 'Gemini CLI MCP Client', client_host: 'localhost' },
            verified('raycast'),
          ]}
        />
      );

      expect(screen.getByTestId('mcp-setup-connected-apps-label').textContent).toBe('Connected apps (4)');
      expect(screen.getAllByTestId('mcp-setup-connected-app').map((chip) => chip.textContent)).toEqual([
        'Claude Code',
        'Cursor',
        'Gemini CLI MCP Client',
        'raycast',
      ]);
      expect(MCP_SETUP_APPS.filter((app) => screen.queryByTestId(`mcp-setup-app-connected-${app}`))).toEqual([
        'claude-code',
        'cursor',
      ]);
      expect(screen.getByTestId('mcp-setup-app-connected-cursor').textContent).toBe(setup.connected);
      expect(card('cursor').getAttribute('data-connected')).toBe('true');
      // Self-registered apps are never recognized, whatever they call themselves.
      expect(card('gemini').getAttribute('data-connected')).toBe('false');

      const button = screen.getByTestId('mcp-client-tab-cursor');
      const describedBy = (button.getAttribute('aria-describedby') ?? '').split(' ');

      expect(describedBy).toContain(screen.getByTestId('mcp-setup-app-connected-cursor').id);
    });

    it('does not badge a card for a client that only claims the app’s name', () => {
      render(
        <McpSetupGuide
          serverUrl={SERVER_URL}
          connections={[{ client_id: 'dcr-1', client_name: 'Claude', app_id: null, verified_app: false }]}
        />
      );

      expect(screen.getByTestId('mcp-setup-connected-apps-label').textContent).toBe('Connected apps (1)');
      expect(screen.queryByTestId('mcp-setup-app-connected-claude')).toBeNull();
    });
  });

  describe('having trouble', () => {
    it('starts collapsed and answers reconnecting, approval and one workspace per connection', () => {
      render(<McpSetupGuide serverUrl={SERVER_URL} />);

      const toggleButton = screen.getByTestId('mcp-setup-troubleshooting-toggle');

      expect(toggleButton.textContent).toBe(setup.trouble.title);
      expect(toggleButton.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('mcp-setup-troubleshooting-content')).toBeNull();

      fireEvent.click(toggleButton);
      const content = screen.getByTestId('mcp-setup-troubleshooting-content');

      expect(toggleButton.getAttribute('aria-expanded')).toBe('true');
      expect(toggleButton.getAttribute('aria-controls')).toBe(content.id);
      expect(within(screen.getByTestId('mcp-setup-trouble-reconnect')).getAllByRole('listitem')).toHaveLength(7);
      expect(screen.getByTestId('mcp-setup-trouble-approval').textContent).toContain(setup.trouble.approvalTitle);
      expect(screen.getByTestId('mcp-setup-trouble-workspace').textContent).toContain(
        'add AppFlowy a second time under another name, such as appflowy-work'
      );
      expect(screen.getByTestId('mcp-setup-trouble-path').textContent).toContain('PATH');
      expect(screen.getByTestId('mcp-setup-trouble-blocked').textContent).toContain(setup.trouble.blockedTitle);
      expect(screen.getByTestId('mcp-setup-trouble-read-only').textContent).toContain('Create and add');

      fireEvent.click(toggleButton);
      expect(screen.queryByTestId('mcp-setup-troubleshooting-content')).toBeNull();
    });
  });
});
