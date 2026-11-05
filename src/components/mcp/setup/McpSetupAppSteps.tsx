import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { CHATGPT_PLUGINS_URL, type McpSnippetId } from '@/application/mcp/setup';
import type { McpSetupAppId } from '@/application/mcp/setupApps';

import { ExternalAction, type McpSetupCopy, SetupNote, SetupSnippet, SetupSteps, SetupText } from './McpSetupParts';

export interface McpSetupAppStepsProps {
  app: McpSetupAppId;
  snippets: Record<McpSnippetId, string>;
  onCopy: McpSetupCopy;
  /**
   * Claude's Add custom connector link for a whole organization
   * (`buildClaudeOrganizationConnectorUrl`). Given, the Team and Enterprise
   * note offers it; Settings passes it to workspace owners only.
   */
  organizationConnectorUrl?: string;
}

/**
 * The steps of one gallery card. Menu paths follow each vendor's documentation
 * as of 2026-11 (Claude's connector links and ChatGPT's plugins page as of
 * 2026-11-05). doc/MCP.md (Setup guide) summarizes them; the source list is in
 * research outside this repo. Re-check them against the vendors' current
 * documentation with their releases.
 * The `JSX.Element` return type makes a gallery app without a case a compile error.
 */
export function McpSetupAppSteps({
  app,
  snippets,
  onCopy,
  organizationConnectorUrl,
}: McpSetupAppStepsProps): JSX.Element {
  const { t } = useTranslation();
  const organizationHintId = useId();
  const snippet = (id: McpSnippetId) => <SetupSnippet id={id} text={snippets[id]} onCopy={onCopy} />;

  switch (app) {
    case 'claude':
      return (
        <>
          <SetupSteps
            items={[
              t('mcp.setup.claude.step1'),
              t('mcp.setup.claude.step2'),
              t('mcp.setup.claude.step3'),
              t('mcp.setup.claude.step4'),
            ]}
          />
          <SetupText muted text={t('mcp.setup.claude.manual')} />
          <SetupText muted text={t('mcp.setup.claude.note')} />
          <SetupNote
            title={t('mcp.setup.claude.teamTitle')}
            text={t('mcp.setup.claude.teamNote')}
            testId='mcp-setup-team-note'
          >
            {organizationConnectorUrl ? (
              <>
                <ExternalAction
                  href={organizationConnectorUrl}
                  describedBy={organizationHintId}
                  testId='mcp-add-to-claude-organization'
                >
                  {t('mcp.setup.claude.organizationAction')}
                </ExternalAction>
                <span id={organizationHintId} className='text-xs leading-[18px] text-text-primary'>
                  {t('mcp.setup.claude.organizationHint')}
                </span>
              </>
            ) : null}
          </SetupNote>
        </>
      );
    case 'chatgpt':
      // ChatGPT has no link that fills the server in: the card copies the URL, this opens the page.
      return (
        <>
          <div>
            <ExternalAction href={CHATGPT_PLUGINS_URL} testId='mcp-open-chatgpt-plugins'>
              {t('mcp.setup.chatgpt.openPlugins')}
            </ExternalAction>
          </div>
          <SetupSteps
            items={[
              t('mcp.setup.chatgpt.step1'),
              t('mcp.setup.chatgpt.step2'),
              t('mcp.setup.chatgpt.step3'),
              t('mcp.setup.chatgpt.step4'),
            ]}
          />
          <SetupNote
            title={t('mcp.setup.chatgpt.teamTitle')}
            text={t('mcp.setup.chatgpt.teamNote')}
            testId='mcp-setup-team-note'
          />
        </>
      );
    case 'claude-code':
      return (
        <>
          <SetupText text={t('mcp.setup.claudeCode.step1')} />
          {snippet('claude-code')}
          <SetupText muted text={t('mcp.setup.claudeCode.scope')} testId='mcp-setup-claude-code-scope' />
          <SetupText text={t('mcp.setup.claudeCode.step2')} />
          <SetupText muted text={t('mcp.setup.claudeCode.reconnect')} />
        </>
      );
    case 'codex':
      return (
        <>
          <SetupText text={t('mcp.setup.codex.step1')} />
          {snippet('codex')}
          <SetupText text={t('mcp.setup.codex.step2')} />
          {snippet('codex-login')}
          <SetupText text={t('mcp.setup.codex.config')} />
          {snippet('codex-toml')}
          <SetupText muted text={t('mcp.setup.codex.app')} />
        </>
      );
    case 'vscode':
      return (
        <>
          <SetupText text={t('mcp.setup.vscode.signIn')} />
          <SetupText text={t('mcp.setup.vscode.cli')} />
          {snippet('vscode-cli')}
        </>
      );
    case 'other':
      return (
        <>
          <SetupText text={t('mcp.setup.other.remote')} />
          {snippet('remote-json')}
          <SetupText text={t('mcp.setup.other.stdio')} />
          {snippet('mcp-remote-json')}
        </>
      );
  }
}
