import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { McpMyConnection } from '@/application/services/domains/mcp';
import { ConfirmModal } from '@/components/_shared/modal/ConfirmModal';
import { RAW_INTERPOLATION } from '@/components/mcp/rawInterpolation';
import { Button } from '@/components/ui/button';

import { mcpClientName, mcpConnectionKey, mcpDeviceLabel, mcpOthersKeepWorking } from './format';
import {
  ConnectionDetails,
  DisconnectDescription,
  EmptyState,
  PanelClientIdentity,
  PanelScopeBadge,
  PanelSection,
  ROW_CLASS,
  RowList,
  SectionError,
  SectionLoading,
} from './McpPanelParts';

import type { McpConnectionsOverview } from './useMcpConnectionsOverview';
import type { MyMcpConnectionsState } from './useMyMcpConnections';

export interface McpMyConnectionsProps {
  state: MyMcpConnectionsState;
  /** Disconnects after the user confirmed; resolves true on success. */
  onDisconnect: (connection: McpMyConnection) => Promise<boolean>;
  /** The caller's connections in every workspace, for "N apps across M workspaces". */
  overview?: McpConnectionsOverview;
}

/** "Your connections": the AI apps that can act as the caller in this workspace, one row per device. */
export function McpMyConnections({ state, onDisconnect, overview }: McpMyConnectionsProps) {
  const { t } = useTranslation();
  const { connections, loaded, failed, reload, disconnecting } = state;
  // The target outlives `confirming` so the dialog keeps its text while it fades out.
  const [target, setTarget] = useState<McpMyConnection>();
  const [confirming, setConfirming] = useState(false);
  const targetName = target ? mcpClientName(target, t) : '';
  const othersKeepWorking = target !== undefined && mcpOthersKeepWorking(target, connections);

  return (
    <PanelSection
      title={t('settings.mcp.myConnectionsTitle')}
      description={t('settings.mcp.myConnectionsDescription')}
      testId='mcp-my-connections'
    >
      {overview && overview.connectionCount > 0 && (
        <p className='text-sm text-text-secondary' data-testid='mcp-all-connections-summary'>
          {t('settings.mcp.allConnectionsSummary', {
            apps: t('settings.mcp.appCount', { count: overview.appCount }),
            workspaces: t('settings.mcp.workspaceCount', { count: overview.workspaceCount }),
          })}
        </p>
      )}
      {failed ? (
        <SectionError onRetry={() => void reload()} testId='mcp-my-connections-error' />
      ) : !loaded ? (
        <SectionLoading />
      ) : connections.length === 0 ? (
        <EmptyState testId='mcp-my-connections-empty'>{t('settings.mcp.myConnectionsEmpty')}</EmptyState>
      ) : (
        <RowList>
          {connections.map((connection, index) => (
            <li
              key={mcpConnectionKey(connection)}
              className={ROW_CLASS}
              data-testid='mcp-my-connection-row'
              data-client-id={connection.client_id}
              data-family-id={connection.family_id ?? undefined}
            >
              <PanelClientIdentity client={connection} className='flex-1'>
                <ConnectionDetails connection={connection} testIdPrefix='mcp-my-connection' />
              </PanelClientIdentity>
              <div className='flex shrink-0 items-center gap-3'>
                <PanelScopeBadge scope={connection.scope} />
                <Button
                  variant='outline'
                  disabled={Boolean(disconnecting)}
                  onClick={() => {
                    setTarget(connection);
                    setConfirming(true);
                  }}
                  data-testid={`mcp-my-disconnect-${index}`}
                >
                  {t('settings.mcp.disconnect')}
                </Button>
              </div>
            </li>
          ))}
        </RowList>
      )}

      <ConfirmModal
        open={confirming}
        title={t('settings.mcp.disconnectTitle', { name: targetName, ...RAW_INTERPOLATION })}
        description={
          <DisconnectDescription
            main={t('settings.mcp.disconnectDescription', { name: targetName, ...RAW_INTERPOLATION })}
            device={target ? mcpDeviceLabel(target) : undefined}
            othersKeepWorking={othersKeepWorking}
          />
        }
        confirmText={t('settings.mcp.disconnect')}
        loading={Boolean(disconnecting)}
        dialogTestId='mcp-disconnect-dialog'
        confirmTestId='mcp-confirm-disconnect'
        onClose={() => {
          if (!disconnecting) setConfirming(false);
        }}
        onConfirm={() => {
          if (!target) return;
          void onDisconnect(target).then((success) => {
            if (success) setConfirming(false);
          });
        }}
      />
    </PanelSection>
  );
}
