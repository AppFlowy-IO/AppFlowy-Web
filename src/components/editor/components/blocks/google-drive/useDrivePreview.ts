import { useEffect, useRef, useState } from 'react';

import { subscribeDrivePreview } from '@/application/integrations/drive-preview-cache';
import { getTokenParsed } from '@/application/session/token';

/** Authenticated thumbnails are session data and must never be saved in shared documents. */
export function useDrivePreview(workspaceId: string | undefined, fileId: string | undefined, email?: string) {
  const userId = getTokenParsed()?.user.id;
  const [reloadVersion, setReloadVersion] = useState(0);
  const [preview, setPreview] = useState<{ key: string; thumbnail?: string; version: number }>();
  const subscription = useRef<ReturnType<typeof subscribeDrivePreview>>();
  const key = JSON.stringify([workspaceId, fileId, email, userId]);

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

  return {
    thumbnail: preview?.key === key ? preview.thumbnail : undefined,
    version: `${key}:${preview?.version ?? 0}:${reloadVersion}`,
    reload: () => {
      if (subscription.current) subscription.current.reload();
      else setReloadVersion((current) => current + 1);
    },
  };
}
