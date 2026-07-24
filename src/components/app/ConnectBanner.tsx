import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import { ReactComponent as CloudOffIcon } from '@/assets/icons/cloud_off.svg';
import type { AppEventEmitter } from '@/components/app/contexts/AppEventEmitterContext';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

import { useEventEmitter } from './app.hooks';

// WebSocket readyState enum
const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

function getStoredWebSocketReadyState(eventEmitter: AppEventEmitter) {
  const { webSocketReadyState } = eventEmitter;

  return typeof webSocketReadyState === 'number' ? webSocketReadyState : undefined;
}

export function ConnectBanner() {
  const eventEmitter = useEventEmitter();
  const { t } = useTranslation();

  // Subscribe to WebSocket status via the event emitter, which caches the
  // latest readyState (see AppSyncLayer). useSyncExternalStore reads that
  // cached snapshot on mount, so a banner that mounts after the socket already
  // opened reflects the current state instead of waiting for the next event.
  const subscribe = useCallback(
    (onChange: () => void) => {
      eventEmitter.on(APP_EVENTS.WEBSOCKET_STATUS, onChange);

      return () => {
        eventEmitter.off(APP_EVENTS.WEBSOCKET_STATUS, onChange);
      };
    },
    [eventEmitter]
  );

  const getSnapshot = useCallback(
    () => getStoredWebSocketReadyState(eventEmitter) ?? READY_STATE.CONNECTING,
    [eventEmitter]
  );

  const readyState = useSyncExternalStore(subscribe, getSnapshot);

  // Manual reconnect
  const handleReconnect = useCallback(() => {
    eventEmitter.emit(APP_EVENTS.RECONNECT_WEBSOCKET);
  }, [eventEmitter]);

  const isLoading = readyState === READY_STATE.CONNECTING || readyState === READY_STATE.CLOSING;
  const isClosed = readyState === READY_STATE.CLOSED;
  const isOpen = readyState === READY_STATE.OPEN;

  // Hide the banner when the connection is open and stable
  if (isOpen) {
    return (
      <div
        className='fixed left-0 right-0 top-0 z-50 overflow-hidden transition-all duration-300 ease-in-out'
        style={{ height: 0 }}
      />
    );
  }

  // Show the banner when connecting or closed
  if (!isLoading && !isClosed) {
    return null;
  }

  return (
    <div
      data-testid='connect-banner'
      className='absolute left-0 top-[48px] z-50 w-full bg-surface-container-layer-01 transition-all duration-300 ease-in-out'
    >
      <div className='flex h-[52px] items-center px-4 py-3'>
        <div className='flex items-center space-x-2'>
          {isLoading && (
            <>
              <Progress variant={'primary'} />
              <span data-testid='connect-banner-connecting' className='text-sm text-text-secondary'>
                {t('connecting')}
              </span>
            </>
          )}
          {isClosed && (
            <>
              <CloudOffIcon className='h-5 w-5 text-text-tertiary' />
              <span data-testid='connect-banner-disconnected' className='text-sm text-text-secondary'>
                {t('disconnected')}
              </span>
              <Button
                data-testid='connect-banner-reconnect'
                variant='outline'
                size='sm'
                className='ml-2'
                onClick={handleReconnect}
              >
                {t('reconnect')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
