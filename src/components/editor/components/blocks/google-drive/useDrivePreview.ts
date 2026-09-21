import { useEffect, useState } from 'react';

import { onConnectionsChanged } from '@/application/integrations/connection-events';
import { getDriveFile } from '@/application/integrations/google-drive';
import { listConnections } from '@/application/services/domains/integration';

/** Authenticated thumbnails are session data and must never be saved in shared documents. */
export function useDrivePreview(workspaceId: string | undefined, fileId: string | undefined, email?: string) {
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<{ key: string; url: string }>();
  const key = JSON.stringify([workspaceId, fileId, email, version]);

  useEffect(() => {
    if (!workspaceId) return;
    return onConnectionsChanged(workspaceId, () => setVersion((current) => current + 1));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !fileId) return;
    const controller = new AbortController();

    void (async () => {
      const connections = (await listConnections(workspaceId, controller.signal))
        .filter((connection) => connection.provider === 'google-drive')
        .sort(
          (first, second) => Number(second.account_identifier === email) - Number(first.account_identifier === email)
        );

      for (const connection of connections) {
        if (controller.signal.aborted) return;
        const file = await getDriveFile(workspaceId, connection.id, fileId, controller.signal).catch(() => undefined);
        const url = file?.thumbnailLink;

        if (url && !file?.trashed && !controller.signal.aborted) {
          const parsed = new URL(url);

          if (
            parsed.protocol === 'https:' &&
            (parsed.hostname.endsWith('.googleusercontent.com') || parsed.hostname === 'drive.google.com')
          ) {
            setPreview({ key, url });
          }

          return;
        }
      }
    })().catch(() => {
      /* The original Google preview remains available on permission/network failures. */
    });
    return () => controller.abort();
  }, [workspaceId, fileId, email, key]);

  return {
    thumbnail: preview?.key === key ? preview.url : undefined,
    version,
    reload: () => setVersion((current) => current + 1),
  };
}
