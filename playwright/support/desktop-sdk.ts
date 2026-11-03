import { spawn } from 'node:child_process';

import type { PersistedDatabaseRowTemplate } from '../../src/application/database-yjs/template/types';
import { TestConfig } from './test-config';

export interface DesktopTemplateRequest {
  email: string;
  view_id: string;
  template_id?: string;
  name: string;
  action: 'author' | 'save';
  expected_database_blocks: number;
}

export interface DesktopTemplateResult {
  workspace_id: string;
  view_id: string;
  database_id: string;
  template: PersistedDatabaseRowTemplate;
  created: { row_id: string; document_id: string; blocks: Array<{ database_id: string; view_ids: string[] }> };
}

/** Keep native sync alive until the independent Web client observes its real output. */
export async function withDesktopTemplate(
  input: DesktopTemplateRequest,
  observe: (result: DesktopTemplateResult) => Promise<void>
): Promise<DesktopTemplateResult> {
  const executable = process.env.APPFLOWY_DESKTOP_INTEROP_BIN;

  if (!executable) throw new Error('Build the Desktop row_template_interop example and set APPFLOWY_DESKTOP_INTEROP_BIN');
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], env: {
    ...process.env,
    af_cloud_test_base_url: process.env.APPFLOWY_DESKTOP_API_URL ?? TestConfig.apiUrl,
    af_cloud_test_gotrue_url: process.env.APPFLOWY_DESKTOP_GOTRUE_URL ?? TestConfig.gotrueUrl,
    af_cloud_test_ws_url: process.env.APPFLOWY_DESKTOP_WS_URL ?? TestConfig.wsUrl,
  } });
  const exit = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Desktop SDK exited ${code ?? signal}`)));
  });
  // Retain rejection until awaited, including failures before the result arrives.
  void exit.catch(() => undefined);
  let output = '';
  let diagnostics = '';

  child.stderr.on('data', (data: Buffer) => { diagnostics = (diagnostics + data.toString()).slice(-8192); });
  const result = new Promise<DesktopTemplateResult>((resolve, reject) => {
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      const line = output.match(/^APPFLOWY_INTEROP_RESULT=(.+)\r?\n/m)?.[1];

      if (line) {
        try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
      }
      if (output.length > 8 * 1024 * 1024) reject(new Error('Desktop SDK output exceeded its budget'));
    });
    // Native diagnostics can contain authentication URLs. Surface only the exit
    // status and keep test protocol output separate from those diagnostics.
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(
      `Desktop SDK exited ${code ?? signal} before publishing a result: ${diagnostics.replace(/(?:https?|wss?):\/\/[^\s]+/g, '[redacted URL]')}`
    )));
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 90000);

  console.info('Desktop SDK input:', JSON.stringify(input));
  child.stdin.write(`${JSON.stringify(input)}\n`);
  try {
    const value = await result;

    await observe(value);
    child.stdin.end('observed\n');
    await exit;
    return value;
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
}
