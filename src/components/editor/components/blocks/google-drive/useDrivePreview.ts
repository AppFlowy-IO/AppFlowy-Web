import { useCallback, useEffect, useRef, useState } from 'react';

import { DrivePreviewSnapshot, subscribeDrivePreview } from '@/application/integrations/drive-preview-cache';
import { getTokenParsed } from '@/application/session/token';

/** Authenticated thumbnails are session data and must never be saved in shared documents. */
export function useDrivePreview(
  workspaceId: string | undefined,
  fileId: string | undefined,
  email?: string,
  selectedAt?: number
) {
  const userId = getTokenParsed()?.user.id;
  const [reloadVersion, setReloadVersion] = useState(0);
  const [preview, setPreview] = useState<DrivePreviewSnapshot & { key: string }>();
  const subscription = useRef<ReturnType<typeof subscribeDrivePreview>>();
  // A deliberate reselection must retry an inaccessible file even when its ID
  // and account are unchanged. Caption/focus updates keep this key stable.
  const key = JSON.stringify([workspaceId, fileId, email, userId, selectedAt]);

  useEffect(() => {
    if (!workspaceId || !fileId || !userId) return;
    const current = subscribeDrivePreview(workspaceId, fileId, userId, email, (snapshot) => {
      setPreview({ key, ...snapshot });
    });

    subscription.current = current;
    return () => {
      subscription.current = undefined;
      current.unsubscribe();
    };
  }, [workspaceId, fileId, email, userId, key]);

  const reload = useCallback(() => {
    if (subscription.current) subscription.current.reload();
    else setReloadVersion((current) => current + 1);
  }, []);

  return {
    thumbnail: preview?.key === key ? preview.thumbnail : undefined,
    metadata: preview?.key === key ? preview.metadata : undefined,
    status:
      preview?.key === key ? preview.status : fileId ? (!workspaceId || !userId ? 'reconnect' : 'loading') : undefined,
    version: `${key}:${preview?.version ?? 0}:${reloadVersion}`,
    reload,
  };
}
