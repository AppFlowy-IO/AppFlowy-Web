import type { McpSetupAppId } from '@/application/mcp/setupApps';

/** Each gallery card's object under `mcp.setup` in the translations (`name`, `description`, steps). */
export const SETUP_APP_TEXT_KEYS = {
  claude: 'claude',
  chatgpt: 'chatgpt',
  'claude-code': 'claudeCode',
  codex: 'codex',
  vscode: 'vscode',
  other: 'other',
} as const satisfies Record<McpSetupAppId, string>;
