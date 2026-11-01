import { useTranslation } from 'react-i18next';

import type { McpSnippetId } from '@/application/mcp/setup';
import type { McpSetupAppId } from '@/application/mcp/setupApps';

import { type McpSetupCopy, SetupNote, SetupSnippet, SetupSteps, SetupText } from './McpSetupParts';

export interface McpSetupAppStepsProps {
  app: McpSetupAppId;
  snippets: Record<McpSnippetId, string>;
  onCopy: McpSetupCopy;
}

/**
 * The steps of one gallery card. Menu paths follow each vendor's documentation
 * as of 2026-11 (doc/MCP.md lists the sources); re-check them with vendor releases.
 */
export function McpSetupAppSteps({ app, snippets, onCopy }: McpSetupAppStepsProps) {
  const { t } = useTranslation();
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
          <SetupText muted text={t('mcp.setup.claude.note')} />
          <SetupNote
            title={t('mcp.setup.claude.teamTitle')}
            text={t('mcp.setup.claude.teamNote')}
            testId='mcp-setup-team-note'
          />
        </>
      );
    case 'chatgpt':
      return (
        <>
          <SetupSteps
            items={[t('mcp.setup.chatgpt.step1'), t('mcp.setup.chatgpt.step2'), t('mcp.setup.chatgpt.step3')]}
          />
          <SetupText muted text={t('mcp.setup.chatgpt.note')} />
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
    case 'cursor':
      return (
        <>
          <SetupText text={t('mcp.setup.cursor.afterInstall')} testId='mcp-setup-cursor-after-install' />
          <SetupText text={t('mcp.setup.cursor.manual')} />
          {snippet('cursor-json')}
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
    case 'gemini':
      return (
        <>
          <SetupText text={t('mcp.setup.gemini.step1')} />
          {snippet('gemini')}
          <SetupText text={t('mcp.setup.gemini.step2')} />
        </>
      );
    case 'windsurf':
      return (
        <>
          <SetupText text={t('mcp.setup.windsurf.step1')} />
          {snippet('server-url-json')}
          <SetupText text={t('mcp.setup.windsurf.step2')} />
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
