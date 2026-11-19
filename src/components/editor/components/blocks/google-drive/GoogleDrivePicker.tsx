import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DriveFile, getDriveFile } from '@/application/integrations/google-drive';
import { openGoogleDrivePicker } from '@/application/integrations/google-drive-picker';
import { Button } from '@/components/ui/button';

import './google-drive-picker.scss';

export function GoogleDrivePicker({
  workspaceId,
  connectionId,
  onSelect,
  onClose,
}: {
  workspaceId: string;
  connectionId: string;
  onSelect: (file: DriveFile) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const handlers = useRef({ onSelect, onClose });

  useEffect(() => {
    handlers.current = { onSelect, onClose };
  }, [onSelect, onClose]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    setStatus('loading');
    void openGoogleDrivePicker({
      workspaceId,
      connectionId,
      signal,
      onCancel: () => handlers.current.onClose(),
      onSelect: (file) => {
        setStatus('loading');
        // Picker grants access to the selected file. Fetch full metadata through
        // the server, retaining the Picker result if metadata is unavailable.
        void getDriveFile(workspaceId, connectionId, file.id, signal)
          .catch(() => file)
          .then((metadata) => {
            if (!signal.aborted) handlers.current.onSelect(metadata.id === file.id ? { ...file, ...metadata } : file);
          });
      },
    })
      .then(() => {
        if (!signal.aborted) setStatus('ready');
      })
      .catch(() => {
        // SDK/HTTP errors can contain credentials. Show only the translated fallback.
        if (!signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [workspaceId, connectionId, retry]);

  return (
    <div data-google-drive-native-picker data-testid='google-drive-native-picker'>
      {status !== 'ready' && (
        <div className='flex flex-col gap-2 border-t border-border-primary p-3'>
          <p role={status === 'error' ? 'alert' : 'status'} className='text-text-secondary'>
            {t(status === 'error' ? 'document.plugins.googleDrive.loadFailed' : 'settings.connections.loading')}
          </p>
          <div className='flex gap-2'>
            {status === 'error' && (
              <Button variant='outline' onClick={() => setRetry((value) => value + 1)}>
                {t('settings.connections.retry')}
              </Button>
            )}
            <Button variant='ghost' onClick={onClose}>
              {t('button.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
