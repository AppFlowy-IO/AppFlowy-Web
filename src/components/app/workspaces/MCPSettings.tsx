import { PlugZap, ShieldCheck, Unplug, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { McpService } from '@/application/services/domains';
import type {
  McpApprovedClient,
  McpConnectionSummary,
  McpWorkspaceAdminSettings,
} from '@/application/services/domains/mcp';
import { NormalModal } from '@/components/_shared/modal';
import { HIDDEN_BUTTON_PROPS, MODAL_CLASSES } from '@/components/app/workspaces/modal-props';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

const MCP_SETTINGS_PAPER_PROPS = { sx: { width: 720, minHeight: 560 } } as const;

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { error_description?: string; error?: string; message?: string } } })
      .response;
    const data = response?.data;

    return data?.error_description || data?.message || data?.error || 'Request failed';
  }

  return error instanceof Error ? error.message : String(error);
}

function clientLabel(client: Pick<McpApprovedClient, 'client_id' | 'client_name'>): string {
  return client.client_name?.trim() || client.client_id;
}

function formatConnectedAt(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Unknown';

  return new Date(value * 1000).toLocaleString();
}

export function MCPSettings({
  open,
  onClose,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<McpWorkspaceAdminSettings | null>(null);
  const [connections, setConnections] = useState<McpConnectionSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approvedClients = settings?.approved_clients ?? [];
  const connectionsByClient = useMemo(() => {
    return connections.reduce<Record<string, number>>((acc, connection) => {
      acc[connection.client_id] = (acc[connection.client_id] ?? 0) + 1;
      return acc;
    }, {});
  }, [connections]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [settings, connections] = await Promise.all([
        McpService.getWorkspaceSettings(workspaceId),
        McpService.listConnections(workspaceId),
      ]);

      setSettings(settings);
      setConnections(connections.connections);
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const updatePolicy = useCallback(
    async (checked: boolean) => {
      if (!workspaceId || !settings) return;
      setSaving(true);
      setError(null);
      try {
        const next = await McpService.updateWorkspaceSettings(workspaceId, checked);

        setSettings(next);
      } catch (error) {
        setError(getErrorMessage(error));
      } finally {
        setSaving(false);
      }
    },
    [settings, workspaceId]
  );

  const approveClient = useCallback(async () => {
    if (!workspaceId) return;
    const trimmed = clientId.trim();

    if (!trimmed) return;
    setActionKey('approve');
    setError(null);
    try {
      await McpService.approveClient(workspaceId, trimmed);
      setClientId('');
      await load();
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setActionKey(null);
    }
  }, [clientId, load, workspaceId]);

  const revokeClient = useCallback(
    async (client: McpApprovedClient) => {
      if (!workspaceId) return;
      setActionKey(`revoke:${client.client_id}`);
      setError(null);
      try {
        await McpService.revokeClientApproval(workspaceId, client.client_id);
        await load();
      } catch (error) {
        setError(getErrorMessage(error));
      } finally {
        setActionKey(null);
      }
    },
    [load, workspaceId]
  );

  const disconnect = useCallback(
    async (connection: McpConnectionSummary) => {
      if (!workspaceId) return;
      const key = `disconnect:${connection.client_id}:${connection.user_uuid}`;

      setActionKey(key);
      setError(null);
      try {
        await McpService.disconnectConnections(workspaceId, {
          client_id: connection.client_id,
          user_uuid: connection.user_uuid,
        });
        await load();
      } catch (error) {
        setError(getErrorMessage(error));
      } finally {
        setActionKey(null);
      }
    },
    [load, workspaceId]
  );

  return (
    <NormalModal
      open={open}
      onClose={onClose}
      title={<div style={{ textAlign: 'left' }}>{t('settings.mcp.title', { defaultValue: 'MCP connectors' })}</div>}
      classes={MODAL_CLASSES}
      disableAutoFocus
      disableEnforceFocus
      PaperProps={MCP_SETTINGS_PAPER_PROPS}
      okButtonProps={HIDDEN_BUTTON_PROPS}
      cancelButtonProps={HIDDEN_BUTTON_PROPS}
    >
      <div className='flex min-h-0 w-full flex-col gap-5 py-2 text-text-primary'>
        <div className='flex items-start justify-between gap-4 rounded-400 border border-border-primary p-4'>
          <div className='flex min-w-0 gap-3'>
            <ShieldCheck className='mt-0.5 h-5 w-5 shrink-0 text-icon-primary' />
            <div className='min-w-0'>
              <div className='text-sm font-medium'>
                {t('settings.mcp.blockUnapproved', { defaultValue: 'Block unapproved clients' })}
              </div>
              <div className='mt-1 text-xs leading-relaxed text-text-secondary'>
                {t('settings.mcp.blockUnapprovedDescription', {
                  defaultValue:
                    'When enabled, users can only connect MCP clients that a workspace owner has approved.',
                })}
              </div>
            </div>
          </div>
          <Switch
            checked={!settings?.allow_unapproved_clients}
            disabled={loading || saving || !settings}
            onCheckedChange={(checked) => void updatePolicy(!checked)}
          />
        </div>

        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2 text-sm font-medium'>
            <PlugZap className='h-4 w-4' />
            {t('settings.mcp.approveClient', { defaultValue: 'Approve client' })}
          </div>
          <div className='flex gap-2'>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={t('settings.mcp.clientIdPlaceholder', { defaultValue: 'MCP client ID' })}
            />
            <Button onClick={approveClient} disabled={!clientId.trim() || actionKey === 'approve'}>
              {actionKey === 'approve'
                ? t('button.loading', { defaultValue: 'Saving...' })
                : t('button.add', { defaultValue: 'Add' })}
            </Button>
          </div>
        </div>

        {error && (
          <div className='rounded-300 border border-border-error-thick bg-fill-error-select px-3 py-2 text-sm text-text-error'>
            {error}
          </div>
        )}

        <section className='flex flex-col gap-2'>
          <div className='text-sm font-medium'>
            {t('settings.mcp.approvedClients', { defaultValue: 'Approved clients' })}
          </div>
          <div className='max-h-[180px] overflow-y-auto rounded-400 border border-border-primary'>
            {loading ? (
              <div className='px-3 py-6 text-center text-sm text-text-secondary'>
                {t('button.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : approvedClients.length === 0 ? (
              <div className='px-3 py-6 text-center text-sm text-text-secondary'>
                {t('settings.mcp.noApprovedClients', { defaultValue: 'No approved MCP clients.' })}
              </div>
            ) : (
              approvedClients.map((client) => (
                <div
                  key={client.client_id}
                  className='flex items-center gap-3 border-b border-border-primary px-3 py-3 last:border-b-0'
                >
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium'>{clientLabel(client)}</div>
                    <div className='truncate font-mono text-[11px] text-text-secondary'>{client.client_id}</div>
                    <div className='text-xs text-text-secondary'>
                      {connectionsByClient[client.client_id] ?? 0}{' '}
                      {t('settings.mcp.activeConnections', { defaultValue: 'active connections' })}
                    </div>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => void revokeClient(client)}
                    disabled={actionKey === `revoke:${client.client_id}`}
                  >
                    <X className='h-4 w-4' />
                    {t('button.revoke', { defaultValue: 'Revoke' })}
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className='flex flex-col gap-2'>
          <div className='text-sm font-medium'>
            {t('settings.mcp.connectedUsers', { defaultValue: 'Connected users' })}
          </div>
          <div className='max-h-[180px] overflow-y-auto rounded-400 border border-border-primary'>
            {loading ? (
              <div className='px-3 py-6 text-center text-sm text-text-secondary'>
                {t('button.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : connections.length === 0 ? (
              <div className='px-3 py-6 text-center text-sm text-text-secondary'>
                {t('settings.mcp.noConnections', { defaultValue: 'No active MCP connections.' })}
              </div>
            ) : (
              connections.map((connection) => {
                const key = `disconnect:${connection.client_id}:${connection.user_uuid}`;

                return (
                  <div
                    key={key}
                    className='flex items-center gap-3 border-b border-border-primary px-3 py-3 last:border-b-0'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-mono text-xs'>{connection.user_uuid}</div>
                      <div className='truncate font-mono text-[11px] text-text-secondary'>{connection.client_id}</div>
                      <div className='text-xs text-text-secondary'>{formatConnectedAt(connection.connected_at)}</div>
                    </div>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => void disconnect(connection)}
                      disabled={actionKey === key}
                    >
                      <Unplug className='h-4 w-4' />
                      {t('button.disconnect', { defaultValue: 'Disconnect' })}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </NormalModal>
  );
}

export default MCPSettings;
